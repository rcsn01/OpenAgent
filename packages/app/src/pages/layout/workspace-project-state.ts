import { createEffect, createMemo, untrack, type Accessor } from "solid-js"
import { getFilename } from "@openagent/core/util/path"
import { produce } from "solid-js/store"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout, type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { pathKey } from "@/utils/path-key"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { effectiveWorkspaceOrder, sortedRootSessions } from "./helpers"

type LayoutStore = {
  workspaceName: Record<string, string>
  workspaceBranchName: Record<string, Record<string, string>>
  workspaceExpanded: Record<string, boolean>
  workspaceOrder: Record<string, string[]>
  lastProjectSession: Record<string, { directory: string; id: string; at: number } | undefined>
}

export function createWorkspaceProjectState(input: {
  store: LayoutStore
  setStore: (...args: unknown[]) => void
  pageReady: Accessor<boolean>
  layoutReady: Accessor<boolean>
  currentDir: Accessor<string | undefined>
  currentSessionID: Accessor<string | undefined>
  scrollToSession: (sessionID: string, sessionKey: string) => void
}) {
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const notification = useNotification()

  const currentProject = createMemo(() => {
    const directory = input.currentDir()
    if (!directory) return
    const key = pathKey(directory)

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.some((item) => pathKey(item) === key))
    if (sandbox) return sandbox

    const direct = projects.find((p) => pathKey(p.worktree) === key)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
    const direct = input.store.workspaceName[key] ?? input.store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return input.store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = pathKey(directory)
    input.setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!input.store.workspaceBranchName[projectId]) {
      input.setStore("workspaceBranchName", projectId, {})
    }
    input.setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)

  function projectRoot(directory: string) {
    const key = pathKey(directory)
    const project = layout.projects
      .list()
      .find((item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
    if (project) return project.worktree

    const known = Object.entries(input.store.workspaceOrder).find(
      ([root, dirs]) => pathKey(root) === key || dirs.some((item) => pathKey(item) === key),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  function activeProjectRoot(directory: string) {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    input.setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string) {
    if (!input.store.lastProjectSession[root]) return
    input.setStore(
      "lastProjectSession",
      produce((draft: LayoutStore["lastProjectSession"]) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => input.store.workspaceExpanded[directory])
    if (expanded === false) {
      input.setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => input.scrollToSession(id, `${directory}:${id}`))
    return root
  }

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  const workspaceIds = (project: LocalProject | undefined) => {
    if (!project) return []
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = pathKey(active?.worktree ?? "") === pathKey(project.worktree) ? input.currentDir() : undefined
    const extra =
      directory && pathKey(directory) !== pathKey(local) && !dirs.some((item) => pathKey(item) === pathKey(directory))
        ? directory
        : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const ordered = effectiveWorkspaceOrder(local, dirs, input.store.workspaceOrder[project.worktree])
    if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
    if (!extra) return ordered
    if (pending) return ordered
    return [...ordered, extra]
  }

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]

    const activeDir = input.currentDir()
    return workspaceIds(project).filter((directory) => {
      const expanded = input.store.workspaceExpanded[directory] ?? directory === project.worktree
      const active = !!activeDir && pathKey(directory) === pathKey(activeDir)
      return expanded || active
    })
  })

  createEffect(() => {
    if (!input.pageReady()) return
    if (!input.layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(input.store.workspaceExpanded)) {
      if (!expanded) continue
      const key = pathKey(directory)
      const project = projects.find(
        (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      input.setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: true })
      const dirSessions = sortedRootSessions(dirStore, now)
      result.push(...dirSessions)
    }
    return result
  })

  return {
    currentProject,
    currentSessions,
    workspaceName,
    setWorkspaceName,
    workspaceLabel,
    workspaceSetting,
    workspaceIds,
    visibleSessionDirs,
    projectRoot,
    activeProjectRoot,
    rememberSessionRoute,
    clearLastProjectSession,
    syncSessionRoute,
  }
}
