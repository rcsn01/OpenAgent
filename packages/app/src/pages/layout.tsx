import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { useAppRoute } from "@/context/app-route"
import { useLayout, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/core/util/path"
import { Session, type Message } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals, getTerminalServerScope } from "@/context/terminal"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetchInflight,
  clearSessionPrefetch,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import { playSoundById } from "@/utils/sound"
import { setNavigate } from "@/utils/notification-click"
import { Worktree as WorktreeState } from "@/utils/worktree"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis, getDraggableId } from "@/utils/solid-dnd"
import { DebugBar } from "@/components/debug-bar"
import { PanelHeader, TitlebarLeadingControls, TitlebarThemeSync } from "@/components/titlebar"
import { DialogAutomations } from "@/components/dialog-automations"
import { useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"
import { pathKey } from "@/utils/path-key"
import {
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  latestRootSession,
  sortedRootSessions,
} from "./layout/helpers"
import { createInlineEditorController } from "./layout/inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./layout/sidebar-workspace"
import { SidebarHub } from "./layout/sidebar-hub"
import { ProjectActionsMenu } from "./layout/project-actions-menu"
import { useLayoutDeepLinks } from "./layout/deep-link-handler"
import { LayoutHeaderSlotsContext } from "./layout/header-slots"
import { createWorkspaceProjectState } from "./layout/workspace-project-state"
import { WorkspaceRightPanelHost } from "./layout/workspace-right-panel-host"
import {
  MIN_WORKSPACE_RIGHT_PANEL_WIDTH,
  WORKSPACE_PANEL_DIVIDER_WIDTH,
  WorkspacePanelsContext,
  type WorkspaceRightPanel,
} from "@/context/workspace-panels"

const MIN_SIDEBAR_WIDTH = 160
const SIDEBAR_TRANSITION_MS = 300

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined
  let dialogRun = 0
  let dialogDead = false

  const appRoute = useAppRoute()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  setNavigate(navigate)
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const availableThemeEntries = createMemo(() => theme.ids().map((id) => [id, theme.themes()[id]] as const))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const macDesktop = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const desktopTitlebarInset = createMemo(() => {
    if (!macDesktop()) return undefined
    return `${40 / (platform.webviewZoom?.() ?? 1)}px`
  })
  const currentDir = createMemo(() => appRoute.directory())
  const currentSessionID = createMemo(() => appRoute.sessionID())
  const currentConsoleState = createMemo(() => {
    const directory = currentDir()
    if (!directory) return
    return globalSync.child(directory, { bootstrap: false })[0].console_state
  })

  const [state, setState] = createStore({
    autoselect: appRoute.kind() === "none",
    busyWorkspaces: {} as Record<string, boolean>,
    scrollSessionKey: undefined as string | undefined,
    sortNow: Date.now(),
    sizing: false,
  })

  const editor = createInlineEditorController()
  const projectEditorId = (project: LocalProject) => `project:${pathKey(project.worktree)}`
  const setBusy = (directory: string, value: boolean) => {
    const key = pathKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[pathKey(directory)]
  const sortNow = () => state.sortNow
  let sizet: number | undefined
  let sidebarCloseTimer: ReturnType<typeof setTimeout> | undefined
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet !== undefined) clearTimeout(sizet)
    if (sidebarCloseTimer !== undefined) clearTimeout(sidebarCloseTimer)
  })

  onMount(() => {
    const stop = () => setState("sizing", false)
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)

    const desktopMedia = window.matchMedia("(min-width: 1280px)")
    setDesktopPanels(desktopMedia.matches)
    makeEventListener(desktopMedia, "change", (event) => setDesktopPanels(event.matches))
  })

  const sidebarHovering = createMemo(() => false)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened())
  const clearHoverProjectSoon = () => {}
  const [workspaceRightPanelSlot, setWorkspaceRightPanelSlot] = createSignal<WorkspaceRightPanel>()
  const workspacePanels = {
    setRightPanel: (panel: WorkspaceRightPanel) => setWorkspaceRightPanelSlot(panel),
    clearRightPanel: () => setWorkspaceRightPanelSlot(undefined),
  }
  const [mainHeaderCenter, setMainHeaderCenter] = createSignal<JSX.Element>()
  const [mainHeaderTrailing, setMainHeaderTrailing] = createSignal<JSX.Element>()
  const headerSlots = {
    setMainCenter: (slot: JSX.Element | undefined) => setMainHeaderCenter(() => slot),
    setMainTrailing: (slot: JSX.Element | undefined) => setMainHeaderTrailing(() => slot),
  }
  const [desktopPanels, setDesktopPanels] = createSignal(
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1280px)").matches,
  )
  const [sidebarClosing, setSidebarClosing] = createSignal(false)

  createEffect(
    on(
      () => [layout.sidebar.opened(), desktopPanels()] as const,
      ([opened, desktop], previous) => {
        if (sidebarCloseTimer !== undefined) {
          clearTimeout(sidebarCloseTimer)
          sidebarCloseTimer = undefined
        }

        if (opened || !desktop) {
          setSidebarClosing(false)
          return
        }

        if (!previous?.[0]) {
          setSidebarClosing(false)
          return
        }

        setSidebarClosing(true)
        sidebarCloseTimer = setTimeout(() => {
          setSidebarClosing(false)
          sidebarCloseTimer = undefined
        }, SIDEBAR_TRANSITION_MS)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!state.autoselect) return
    if (appRoute.kind() === "none") return
    setState("autoselect", false)
  })

  const editorOpen = editor.editorOpen
  const openEditor = editor.openEditor
  const closeEditor = editor.closeEditor
  const setEditor = editor.setEditor
  const InlineEditor = editor.InlineEditor

  const clearSidebarHoverState = () => {
    return
  }

  const navigateWithSidebarReset = (href: string, options?: { replace?: boolean }) => {
    clearSidebarHoverState()
    navigate(href, { replace: options?.replace })
    layout.mobileSidebar.hide()
  }

  function cycleTheme(direction = 1) {
    const ids = availableThemeEntries().map(([id]) => id)
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
    const nextThemeId = ids[nextIndex]
    theme.setTheme(nextThemeId)
    showToast({
      title: language.t("toast.theme.title"),
      description: theme.name(nextThemeId),
    })
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({
      title: language.t("toast.scheme.title"),
      description: colorSchemeLabel(next),
    })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  const useUpdatePolling = () =>
    onMount(() => {
      if (!platform.checkUpdate || !platform.updateAndRestart) return

      let toastId: number | undefined
      let interval: ReturnType<typeof setInterval> | undefined

      const pollUpdate = () =>
        platform.checkUpdate!().then(({ updateAvailable, version }) => {
          if (!updateAvailable) return
          if (toastId !== undefined) return
          toastId = showToast({
            persistent: true,
            icon: "download",
            title: language.t("toast.update.title"),
            description: language.t("toast.update.description", { version: version ?? "" }),
            actions: [
              {
                label: language.t("toast.update.action.installRestart"),
                onClick: async () => {
                  await platform.updateAndRestart!()
                },
              },
              {
                label: language.t("toast.update.action.notYet"),
                onClick: "dismiss",
              },
            ],
          })
        })

      createEffect(() => {
        if (!settings.ready()) return

        if (!settings.updates.startup()) {
          if (interval === undefined) return
          clearInterval(interval)
          interval = undefined
          return
        }

        if (interval !== undefined) return
        void pollUpdate()
        interval = setInterval(pollUpdate, 10 * 60 * 1000)
      })

      onCleanup(() => {
        if (interval === undefined) return
        clearInterval(interval)
      })
    })

  const useSDKNotificationToasts = () =>
    onMount(() => {
      const toastBySession = new Map<string, number>()
      const alertedAtBySession = new Map<string, number>()
      const cooldownMs = 5000

      const dismissSessionAlert = (sessionKey: string) => {
        const toastId = toastBySession.get(sessionKey)
        if (toastId === undefined) return
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }

      const unsub = globalSDK.event.listen((e) => {
        if (e.details?.type === "worktree.ready") {
          setBusy(e.name, false)
          WorktreeState.ready(e.name)
          return
        }

        if (e.details?.type === "worktree.failed") {
          setBusy(e.name, false)
          WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
          return
        }

        if (
          e.details?.type === "question.replied" ||
          e.details?.type === "question.rejected" ||
          e.details?.type === "permission.replied"
        ) {
          const props = e.details.properties as { sessionID: string }
          const sessionKey = `${e.name}:${props.sessionID}`
          dismissSessionAlert(sessionKey)
          return
        }

        if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
        const title =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.title")
            : language.t("notification.question.title")
        const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
        const directory = e.name
        const props = e.details.properties
        if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

        const [store] = globalSync.child(directory, { bootstrap: false })
        const session = store.session.find((s) => s.id === props.sessionID)
        const sessionKey = `${directory}:${props.sessionID}`

        const sessionTitle = session?.title ?? language.t("command.session.new")
        const projectName = getFilename(directory)
        const description =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.description", { sessionTitle, projectName })
            : language.t("notification.question.description", { sessionTitle, projectName })
        const href = `/${base64Encode(directory)}/session/${props.sessionID}`

        const now = Date.now()
        const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
        if (now - lastAlerted < cooldownMs) return
        alertedAtBySession.set(sessionKey, now)

        if (e.details.type === "permission.asked") {
          if (settings.sounds.permissionsEnabled()) {
            void playSoundById(settings.sounds.permissions())
          }
          if (settings.notifications.permissions()) {
            void platform.notify(title, description, href)
          }
        }

        if (e.details.type === "question.asked") {
          if (settings.notifications.agent()) {
            void platform.notify(title, description, href)
          }
        }

        const currentSession = currentSessionID()
        if (pathKey(directory) === pathKey(currentDir()) && props.sessionID === currentSession) return
        if (pathKey(directory) === pathKey(currentDir()) && session?.parentID === currentSession) return

        dismissSessionAlert(sessionKey)

        const toastId = showToast({
          persistent: true,
          icon,
          title,
          description,
          actions: [
            {
              label: language.t("notification.action.goToSession"),
              onClick: () => navigate(href),
            },
            {
              label: language.t("common.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        toastBySession.set(sessionKey, toastId)
      })
      onCleanup(unsub)

      createEffect(() => {
        const currentSession = currentSessionID()
        if (!currentDir() || !currentSession) return
        const sessionKey = `${currentDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(currentDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${currentDir()}:${child.id}`)
        }
      })
    })

  useUpdatePolling()
  useSDKNotificationToasts()

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const workspaceState = createWorkspaceProjectState({
    store,
    setStore,
    pageReady,
    layoutReady,
    currentDir,
    currentSessionID,
    scrollToSession,
  })
  const currentProject = workspaceState.currentProject
  const currentSessions = workspaceState.currentSessions
  const workspaceName = workspaceState.workspaceName
  const setWorkspaceName = workspaceState.setWorkspaceName
  const workspaceLabel = workspaceState.workspaceLabel
  const workspaceSetting = workspaceState.workspaceSetting
  const workspaceIds = workspaceState.workspaceIds
  const visibleSessionDirs = workspaceState.visibleSessionDirs
  const projectRoot = workspaceState.projectRoot
  const activeProjectRoot = workspaceState.activeProjectRoot
  const rememberSessionRoute = workspaceState.rememberSessionRoute
  const clearLastProjectSession = workspaceState.clearLastProjectSession
  const syncSessionRoute = workspaceState.syncSessionRoute

  const [autoselecting] = createResource(async () => {
    await ready.promise
    await layout.ready.promise
    if (!untrack(() => state.autoselect)) return

    const list = layout.projects.list()
    const last = server.projects.last()

    if (list.length === 0) {
      if (!last) return
      await openProject(last, true, { replace: true })
    } else {
      const next = list.find((project) => project.worktree === last) ?? list[0]
      if (!next) return
      await openProject(next.worktree, true, { replace: true })
    }
  })

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  const prefetchChunk = 200
  const prefetchConcurrency = 2
  const prefetchPendingLimit = 10
  const span = 4
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()

  const PREFETCH_MAX_SESSIONS_PER_DIR = 10
  const prefetchedByDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve: currentSessionID() && pathKey(directory) === pathKey(currentDir()) ? [currentSessionID()!] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(visibleSessionDirs())
    for (const directory of prefetchedByDir.keys()) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
  })

  createEffect(() => {
    appRoute.slug()
    currentSessionID()
    globalSDK.url

    prefetchToken.value += 1
    clearSessionPrefetchInflight()
    prefetchQueues.clear()
  })

  createEffect(() => {
    const visible = new Set(visibleSessionDirs())
    for (const [directory, q] of prefetchQueues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) prefetchQueues.delete(directory)
    }
  })

  const queueFor = (directory: string) => {
    const existing = prefetchQueues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    prefetchQueues.set(directory, created)
    return created
  }

  const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (current.length === 0) {
      return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const map = new Map<string, T>()
    for (const item of current) {
      map.set(item.id, item)
    }
    for (const item of incoming) {
      map.set(item.id, item)
    }
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
          .then((messages) => {
            if (prefetchToken.value !== token) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
            const meta = {
              limit: sorted.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pumpPrefetch = (directory: string) => {
    const q = queueFor(directory)
    if (q.running >= prefetchConcurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const token = prefetchToken.value

    void prefetchMessages(directory, sessionID, token).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pumpPrefetch(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: prefetchChunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > prefetchPendingLimit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pumpPrefetch(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const index = currentSessionID() ? sessions.findIndex((s) => s.id === currentSessionID()) : 0
    if (index === -1) return

    if (!currentSessionID()) {
      const first = sessions[index]
      if (first) prefetchSession(first, "high")
    }

    warm(sessions, index)
  })

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = currentSessionID() ? sessions.findIndex((s) => s.id === currentSessionID()) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    prefetchSession(session, "high")
    warm(sessions, targetIndex)

    navigateToSession(session)
  }

  function navigateProjectByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const current = currentProject()?.worktree
    const fallback = currentDir() ? projectRoot(currentDir()) : undefined
    const active = current ?? fallback
    const index = active ? projects.findIndex((project) => project.worktree === active) : -1

    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return

    // warm up child store to prevent flicker
    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateToProjectIndex(index: number) {
    const projects = layout.projects.list()
    const target = projects[index]
    if (!target) return

    globalSync.child(target.worktree)
    void openProject(target.worktree)
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = currentSessionID() ? sessions.findIndex((s) => s.id === currentSessionID()) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetchSession(session, "high")
      warm(sessions, index)

      navigateToSession(session)
      return
    }
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === currentSessionID()) {
      if (nextSession) {
        navigateWithSidebarReset(appRoute.href(nextSession.id))
      } else {
        navigateWithSidebarReset(appRoute.href())
      }
    }
  }

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      ...Array.from({ length: 9 }, (_, i) => {
        const index = i
        const number = index + 1
        return {
          id: `project.${number}`,
          category: language.t("command.category.project"),
          title: `Open Project {number}`,
          keybind: `mod+${number}`,
          disabled: layout.projects.list().length <= index,
          hidden: true,
          onSelect: () => navigateToProjectIndex(index),
        }
      }),
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        slash: { name: "connect" },
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.list",
        title: "Sessions",
        category: language.t("command.category.session"),
        slash: { name: "sessions", aliases: ["resume", "continue"] },
        disabled: currentSessions().length === 0,
        onSelect: () => openSessionList(),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !currentDir() || !currentSessionID(),
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === currentSessionID())
          if (session) void archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: { name: "workspace" },
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "status.open",
        title: "Status",
        category: language.t("command.category.view"),
        slash: { name: "status" },
        disabled: !currentDir(),
        onSelect: () => openStatus(),
      },
      {
        id: "plugin.manager",
        title: "Plugins",
        category: language.t("command.category.settings"),
        slash: { name: "plugins" },
        disabled: !currentDir(),
        onSelect: () => openPluginsManager(),
      },
      {
        id: "plugin.install",
        title: "Install plugin",
        category: language.t("command.category.settings"),
        slash: { name: "install-plugin" },
        disabled: !currentDir(),
        onSelect: () => openInstallPlugin(),
      },
      {
        id: "theme.list",
        title: "Themes",
        category: language.t("command.category.theme"),
        slash: { name: "themes" },
        onSelect: () => openThemeList(),
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    for (const [id] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: theme.name(id) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    if ((currentConsoleState()?.switchableOrgCount ?? 0) > 1) {
      commands.push({
        id: "org.switch",
        title: "Switch org",
        category: language.t("command.category.provider"),
        slash: { name: "org", aliases: ["orgs", "switch-org"] },
        onSelect: () => openConsoleOrg(),
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    commands.push({
      id: "help.open",
      title: "Help",
      category: language.t("command.category.view"),
      slash: { name: "help" },
      onSelect: () => openHelp(),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    return commands
  })

  function connectProvider() {
    const run = ++dialogRun
    void import("@/components/dialog-select-provider").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  function openServer() {
    const run = ++dialogRun
    void import("@/components/dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />)
    })
  }

  function openSettings() {
    const run = ++dialogRun
    void import("@/components/dialog-settings").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSettings />)
    })
  }

  function sidebarDialogDirectory() {
    if (currentDir()) return currentDir()
    return currentProject()?.worktree || layout.projects.list()[0]?.worktree
  }

  function openSessionList() {
    const run = ++dialogRun
    void import("@/components/dialog-session-list").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => (
        <x.DialogSessionList
          title="Search sessions"
          placeholder="Search sessions"
          sessions={searchableSessions()}
          currentID={currentSessionID()}
          subtitle={sessionSearchSubtitle}
          onSelect={navigateToSession}
        />
      ))
    })
  }

  function openThemeList() {
    const run = ++dialogRun
    void import("@/components/dialog-theme-list").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogThemeList />)
    })
  }

  function openStatus() {
    const run = ++dialogRun
    void import("@/components/dialog-status").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogStatus />)
    })
  }

  function openHelp() {
    const run = ++dialogRun
    void import("@/components/dialog-help").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogHelp />)
    })
  }

  function openConsoleOrg() {
    if (!currentDir()) return
    const run = ++dialogRun
    void import("@/components/dialog-console-org").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogConsoleOrg />)
    })
  }

  function openPluginsManager() {
    const directory = sidebarDialogDirectory()
    if (!directory) {
      showToast({
        title: "Open a project first",
        description: "Plugins are managed per workspace.",
      })
      return
    }
    const run = ++dialogRun
    void import("@/components/dialog-plugins").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogPlugins directory={directory} />)
    })
  }

  function openInstallPlugin() {
    const directory = sidebarDialogDirectory()
    if (!directory) {
      showToast({
        title: "Open a project first",
        description: "Plugins are managed per workspace.",
      })
      return
    }
    const run = ++dialogRun
    void import("@/components/dialog-install-plugin").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogInstallPlugin directory={directory} />)
    })
  }

  async function navigateToProject(directory: string | undefined, options?: { replace?: boolean }) {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    let dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const canOpen = (value: string | undefined) => {
      if (!value) return false
      return dirs.some((item) => pathKey(item) === pathKey(value))
    }
    const refreshDirs = async (target?: string) => {
      if (!target || target === root || canOpen(target)) return canOpen(target)
      const listed = await globalSDK.client.worktree
        .list({ directory: root })
        .then((x) => x.data ?? [])
        .catch(() => [] as string[])
      dirs = effectiveWorkspaceOrder(root, [root, ...listed], store.workspaceOrder[root])
      return canOpen(target)
    }
    const openSession = async (target: { directory: string; id: string }) => {
      if (!canOpen(target.directory)) return false
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      if (data.session.some((item) => item.id === target.id)) {
        setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
        navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`, options)
        return true
      }
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!resolved?.directory) return false
      if (!canOpen(resolved.directory)) return false
      setStore("lastProjectSession", root, { directory: resolved.directory, id: resolved.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(resolved.directory)}/session/${resolved.id}`, options)
      return true
    }

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      await refreshDirs(projectSession.directory)
      const opened = await openSession(projectSession)
      if (opened) return
      clearLastProjectSession(root)
    }

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest && (await openSession(latest))) {
      return
    }

    const fetched = latestRootSession(
      await Promise.all(
        dirs.map(async (item) => ({
          path: { directory: item },
          session: await globalSDK.client.session
            .list({ directory: item })
            .then((x) => x.data ?? [])
            .catch(() => []),
        })),
      ),
      Date.now(),
    )
    if (fetched && (await openSession(fetched))) {
      return
    }

    navigateWithSidebarReset(`/${base64Encode(root)}/session`, options)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function openProject(directory: string, navigate = true, options?: { replace?: boolean }) {
    layout.projects.open(directory)
    if (navigate) return navigateToProject(directory, options)
  }

  useLayoutDeepLinks({
    isLocalServer: server.isLocal,
    openProject,
    navigateWithSidebarReset,
  })

  async function renameProject(project: LocalProject, next: string) {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = (directory: string, next: string, projectId?: string, branch?: string) => {
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === next) return
    setWorkspaceName(directory, next, projectId, branch)
  }

  function closeProject(directory: string) {
    const list = layout.projects.list()
    const key = pathKey(directory)
    const index = list.findIndex((x) => pathKey(x.worktree) === key)
    const active = pathKey(currentProject()?.worktree ?? "") === key
    if (index === -1) return

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (list.length === 1) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    const next = list[index + 1] ?? list[index - 1]

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function toggleProjectWorkspaces(project: LocalProject) {
    const enabled = layout.sidebar.workspaces(project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(project.worktree)
      return
    }
    if (project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(project.worktree)
  }

  const showEditProjectDialog = (project: LocalProject) => {
    const run = ++dialogRun
    void import("@/components/dialog-edit-project").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  function openProjectNewChat(project: LocalProject) {
    navigateWithSidebarReset(`/${base64Encode(project.worktree)}/session`)
  }

  function toggleProjectPin(project: LocalProject) {
    layout.projects.setPinned(project.worktree, !project.pinned)
  }

  function requestProjectRename(project: LocalProject) {
    editor.openEditor(projectEditorId(project), displayName(project))
  }

  async function openProjectDirectory(project: LocalProject) {
    if (!platform.openPath || !server.isLocal()) return
    await platform.openPath(project.worktree).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
    })
  }

  async function createProjectWorktree(project: LocalProject) {
    layout.sidebar.setWorkspaces(project.worktree, true)
    await createWorkspace(project)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          void openProject(directory, false)
        }
        void navigateToProject(result[0])
      } else if (result) {
        void openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      const run = ++dialogRun
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogDead || dialogRun !== run) return
        dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = pathKey(current)
    const deletedKey = pathKey(directory)
    const shouldLeave = leaveDeletedWorkspace || currentKey === deletedKey
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    if (pathKey(store.lastProjectSession[root]?.directory ?? "") === pathKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = pathKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => pathKey(item) === nextKey)

    if (nextCurrent && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
      getTerminalServerScope(server.current, server.key),
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  function DialogDeleteWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [data, setData] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
    })

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setData({ status: "ready", dirty })
        })
        .catch(() => {
          setData({ status: "error", dirty: false })
        })
    })

    const handleDelete = () => {
      const leaveDeletedWorkspace = pathKey(currentDir()) === pathKey(props.directory)
      if (leaveDeletedWorkspace) {
        navigateWithSidebarReset(`/${base64Encode(props.root)}/session`)
      }
      dialog.close()
      void deleteWorkspace(props.root, props.directory, leaveDeletedWorkspace)
    }

    const description = () => {
      if (data.status === "loading") return language.t("workspace.status.checking")
      if (data.status === "error") return language.t("workspace.status.error")
      if (!data.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    return (
      <Dialog title={language.t("workspace.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.delete.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
              {language.t("workspace.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogResetWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
      sessions: [] as Session[],
    })

    const refresh = async () => {
      const sessions = await globalSDK.client.session
        .list({ directory: props.directory })
        .then((x) => x.data ?? [])
        .catch(() => [])
      const active = sessions.filter((session) => session.time.archived === undefined)
      setState({ sessions: active })
    }

    onMount(() => {
      globalSDK.client.file
        .status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          const dirty = files.length > 0
          setState({ status: "ready", dirty })
          void refresh()
        })
        .catch(() => {
          setState({ status: "error", dirty: false })
        })
    })

    const handleReset = () => {
      dialog.close()
      void resetWorkspace(props.root, props.directory)
    }

    const archivedCount = () => state.sessions.length

    const description = () => {
      if (state.status === "loading") return language.t("workspace.status.checking")
      if (state.status === "error") return language.t("workspace.status.error")
      if (!state.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }

    const archivedLabel = () => {
      const count = archivedCount()
      if (count === 0) return language.t("workspace.reset.archived.none")
      if (count === 1) return language.t("workspace.reset.archived.one")
      return language.t("workspace.reset.archived.many", { count })
    }

    return (
      <Dialog title={language.t("workspace.reset.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.reset.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">
              {description()} {archivedLabel()} {language.t("workspace.reset.note")}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
              {language.t("workspace.reset.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const activeRoute = {
    session: "",
    sessionProject: "",
    directory: "",
  }

  createEffect(
    on(
      () => {
        return [pageReady(), appRoute.slug(), currentSessionID(), currentProject()?.worktree, currentDir()] as const
      },
      ([ready, slug, id, root, dir]) => {
        if (!ready || !slug || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        const session = `${slug}/${id}`

        if (!root) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = ""
          return
        }

        if (server.projects.last() !== root) server.projects.touch(root)

        const changed = session !== activeRoute.session || dir !== activeRoute.directory
        if (changed) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = syncSessionRoute(dir, id, root)
          return
        }

        if (root === activeRoute.sessionProject) return
        activeRoute.directory = dir
        activeRoute.sessionProject = rememberSessionRoute(dir, id, root)
      },
    ),
  )

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
  })

  const side = createMemo(() => Math.max(layout.sidebar.width(), MIN_SIDEBAR_WIDTH))
  const panel = createMemo(() => Math.max(side() - 64, 0))

  const loadedSessionDirs = new Set<string>()

  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }

        const next = new Set(dirs)
        for (const directory of next) {
          if (loadedSessionDirs.has(directory)) continue
          void globalSync.project.loadSessions(directory)
        }

        loadedSessionDirs.clear()
        for (const directory of next) {
          loadedSessionDirs.add(directory)
        }
      },
      { defer: true },
    ),
  )

  function projectSessions(project: LocalProject) {
    return workspaceIds(project)
      .flatMap((directory) => sortedRootSessions(globalSync.child(directory, { bootstrap: false })[0], sortNow()))
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
  }

  const projectSessionDirectories = (project: LocalProject) =>
    [...new Map(workspaceIds(project).map((directory) => [pathKey(directory), directory])).values()]

  function projectHasMoreSessions(project: LocalProject) {
    return projectSessionDirectories(project).some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      const count = sortedRootSessions(store, sortNow()).length
      return store.sessionTotal > count
    })
  }

  async function loadMoreProjectSessions(project: LocalProject) {
    const directories = projectSessionDirectories(project).filter((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      const count = sortedRootSessions(store, sortNow()).length
      return store.sessionTotal > count
    })
    if (directories.length === 0) return

    await Promise.all(
      directories.map(async (directory) => {
        const [, setStore] = globalSync.child(directory, { bootstrap: false })
        setStore("limit", (limit) => (limit ?? 0) + 5)
        await globalSync.project.loadSessions(directory)
      }),
    )
  }

  const listProjectRootSessions = (project: LocalProject) =>
    Promise.all(
      projectSessionDirectories(project).map((directory) =>
        globalSDK.client.session.list({ directory, roots: true }).then((x) => x.data ?? []),
      ),
    ).then((items) => items.flat().filter((session) => session.time.archived === undefined))

  async function archiveProjectChats(project: LocalProject, sessions: Session[]) {
    const archivedAt = Date.now()
    await Promise.all(
      sessions.map((session) =>
        globalSDK.client.session.update({
          sessionID: session.id,
          directory: session.directory,
          time: { archived: archivedAt },
        }),
      ),
    )

    const grouped = sessions.reduce(
      (result, session) => result.set(session.directory, (result.get(session.directory) ?? new Set<string>()).add(session.id)),
      new Map<string, Set<string>>(),
    )

    for (const [directory, ids] of grouped) {
      const [, setStore] = globalSync.child(directory, { bootstrap: false })
      setStore(
        produce((draft) => {
          draft.session = (draft.session ?? []).filter((session) => !ids.has(session.id))
        }),
      )
    }

    const activeArchived = sessions.some(
      (session) => session.id === currentSessionID() && pathKey(session.directory) === pathKey(currentDir()),
    )
    if (activeArchived) navigateWithSidebarReset(`/${base64Encode(project.worktree)}/session`)

    showToast({
      title: language.t("sidebar.project.archiveSuccessTitle"),
      description:
        sessions.length === 1
          ? language.t("sidebar.project.archiveSuccessDescription.one")
          : language.t("sidebar.project.archiveSuccessDescription.many", { count: sessions.length }),
    })
  }

  function DialogArchiveProjectChats(props: { project: LocalProject; sessions: Session[] }) {
    const count = createMemo(() => props.sessions.length)
    const description = createMemo(() =>
      count() === 1
        ? language.t("sidebar.project.archiveConfirmDescription.one", { name: displayName(props.project) })
        : language.t("sidebar.project.archiveConfirmDescription.many", {
            name: displayName(props.project),
            count: count(),
          }),
    )

    const handleArchive = () => {
      dialog.close()
      void archiveProjectChats(props.project, props.sessions).catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
    }

    return (
      <Dialog title={language.t("sidebar.project.archiveConfirmTitle")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleArchive}>
              {language.t("common.archive")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  async function showArchiveProjectChatsDialog(project: LocalProject) {
    const sessions = await listProjectRootSessions(project).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(err, language.t("common.requestFailed")),
      })
      return undefined
    })

    if (!sessions) return
    if (sessions.length === 0) {
      showToast({
        title: language.t("sidebar.project.noneToArchiveTitle"),
        description: language.t("sidebar.project.noneToArchiveDescription"),
      })
      return
    }

    dialog.show(() => <DialogArchiveProjectChats project={project} sessions={sessions} />)
  }

  const searchableSessions = createMemo(() =>
    layout.projects
      .list()
      .flatMap((project) => projectSessions(project))
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)),
  )

  const sessionSearchSubtitle = (session: Session) => {
    const root = projectRoot(session.directory)
    const project = layout.projects.list().find((item) => pathKey(item.worktree) === pathKey(root))
    const projectName = project ? displayName(project) : getFilename(root)
    if (pathKey(root) === pathKey(session.directory)) return projectName
    return `${projectName} • ${getFilename(session.directory)}`
  }

  createEffect(() => {
    if (!layout.sidebar.opened() && !layout.mobileSidebar.opened()) return
    for (const project of layout.projects.list()) {
      for (const directory of workspaceIds(project)) {
        void globalSync.project.loadSessions(directory)
      }
    }
  })

  function openSidebarNewChat() {
    const directory = currentDir() || currentProject()?.worktree || layout.projects.list()[0]?.worktree
    if (!directory) {
      void chooseProject()
      return
    }
    navigateWithSidebarReset(`/${base64Encode(directory)}/session`)
  }

  function openAutomations() {
    clearSidebarHoverState()
    const directory = currentDir() || currentProject()?.worktree || layout.projects.list()[0]?.worktree
    if (!directory) {
      void chooseProject()
      return
    }
    navigate(`/${base64Encode(directory)}/automations`)
    layout.mobileSidebar.hide()
  }

  const sidebarProject = createMemo(() => {
    if (layout.sidebar.opened()) return currentProject()
    return currentProject()
  })

  function handleWorkspaceDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }

  function handleWorkspaceDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = sidebarProject()
    if (!project) return

    const ids = workspaceIds(project)
    const fromIndex = ids.findIndex((dir) => dir === draggable.id.toString())
    const toIndex = ids.findIndex((dir) => dir === droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1) return
    if (fromIndex === toIndex) return

    const result = ids.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setStore(
      "workspaceOrder",
      project.worktree,
      result.filter((directory) => pathKey(directory) !== pathKey(project.worktree)),
    )
  }

  function handleWorkspaceDragEnd() {
    setStore("activeWorkspace", undefined)
  }

  const createWorkspace = async (project: LocalProject) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, created.branch ?? getFilename(created.directory), project.id, created.branch)

    const local = project.worktree
    const key = pathKey(created.directory)
    const root = pathKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = pathKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarHovering,
    clearHoverProjectSoon,
    prefetchSession,
    archiveSession,
    workspaceName,
    renameWorkspace,
    editorOpen,
    openEditor,
    closeEditor,
    setEditor,
    InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value),
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} />),
    setScrollContainerRef: (el, mobile) => {
      if (!mobile) scrollContainerRef = el
    },
  }

  const SidebarPanel = (panelProps: {
    project: Accessor<LocalProject | undefined>
    mobile?: boolean
    merged?: boolean
  }) => {
    const project = panelProps.project
    const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? layout.sidebar.opened()))
    const hover = createMemo(() => !panelProps.mobile && panelProps.merged === false && !layout.sidebar.opened())
    const empty = createMemo(() => appRoute.kind() === "none" && layout.projects.list().length === 0)
    const projectName = createMemo(() => {
      const item = project()
      if (!item) return ""
      return item.name || getFilename(item.worktree)
    })
    const projectId = createMemo(() => project()?.id ?? "")
    const worktree = createMemo(() => project()?.worktree ?? "")
    const slug = createMemo(() => {
      const dir = worktree()
      if (!dir) return ""
      return base64Encode(dir)
    })
    const workspaces = createMemo(() => {
      const item = project()
      if (!item) return [] as string[]
      return workspaceIds(item)
    })
    const workspacesEnabled = createMemo(() => {
      const item = project()
      if (!item) return false
      if (item.vcs !== "git") return false
      return layout.sidebar.workspaces(item.worktree)()
    })
    const canToggle = createMemo(() => project()?.vcs === "git")
    const unseenCount = createMemo(() =>
      workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
    )
    const clearNotifications = () => {
      for (const directory of workspaces()) notification.project.markViewed(directory)
    }
    const homedir = createMemo(() => globalSync.data.path.home)

    return (
      <div
        classList={{
          "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
          "border border-b-0 border-border-weak-base": !merged(),
          "border-l border-t border-border-weaker-base": merged(),
          "bg-background-base": merged() || hover(),
          "bg-background-stronger": !merged() && !hover(),
          "flex-1 min-w-0": panelProps.mobile,
          "max-w-full overflow-hidden": panelProps.mobile,
        }}
        style={{
          width: panelProps.mobile ? undefined : `${panel()}px`,
        }}
      >
        <Show
          when={project()}
          fallback={
            <Show when={empty()}>
              <div class="flex-1 min-h-0 -mt-4 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium text-text-strong">{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={chooseProject}>
                    {language.t("command.project.open")}
                  </Button>
                </div>
              </div>
            </Show>
          }
          keyed
        >
          {(project) => (
            <>
              <div class="shrink-0 pl-1 py-1">
                <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
                  <div class="flex flex-col min-w-0">
	                    <InlineEditor
	                      id={projectEditorId(project)}
	                      value={projectName}
	                      onSave={(next) => {
	                        void renameProject(project, next)
                      }}
                      class="text-14-medium text-text-strong truncate"
                      displayClass="text-14-medium text-text-strong truncate"
                      stopPropagation
                    />

                    <Tooltip
                      placement="bottom"
                      gutter={2}
                      value={worktree()}
                      class="shrink-0"
                      contentStyle={{
                        "max-width": "640px",
                        transform: "translate3d(52px, 0, 0)",
                      }}
                    >
                      <span class="text-12-regular text-text-base truncate select-text">
                        {worktree().replace(homedir(), "~")}
                      </span>
                    </Tooltip>
                  </div>

	                  <ProjectActionsMenu
	                    project={() => project}
                    hoverOnly={!panelProps.mobile && !merged()}
                    sidebarHovering={sidebarHovering}
                    triggerClass="size-6"
                    triggerDataAction="project-menu"
                    triggerDataProject={slug()}
                    onTogglePin={toggleProjectPin}
                    onOpenDirectory={openProjectDirectory}
                    onCreateWorktree={createProjectWorktree}
                    onEdit={showEditProjectDialog}
                    onToggleWorkspaces={toggleProjectWorkspaces}
                    workspacesEnabled={workspacesEnabled}
                    canToggleWorkspaces={canToggle}
                    unseenCount={unseenCount}
                    onClearNotifications={clearNotifications}
                    onRequestRename={requestProjectRename}
                    onArchiveChats={showArchiveProjectChatsDialog}
                    onRemove={(item) => closeProject(item.worktree)}
                  />
                </div>
              </div>

              <div class="flex-1 min-h-0 flex flex-col">
                <Show
                  when={workspacesEnabled()}
                  fallback={
                    <>
                      <div class="shrink-0 py-4">
                        <Button
                          size="large"
                          icon="new-session"
                          class="w-full"
                          onClick={() => {
                            const dir = worktree()
                            if (!dir) return
                            navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
                          }}
                        >
                          {language.t("command.session.new")}
                        </Button>
                      </div>
                      <div class="flex-1 min-h-0">
                        <LocalWorkspace
                          ctx={workspaceSidebarCtx}
                          project={project}
                          sortNow={sortNow}
                          mobile={panelProps.mobile}
                        />
                      </div>
                    </>
                  }
                >
                  <>
                    <div class="shrink-0 py-4">
                      <Button
                        size="large"
                        icon="plus-small"
                        class="w-full"
                        onClick={() => {
                          void createWorkspace(project)
                        }}
                      >
                        {language.t("workspace.new")}
                      </Button>
                    </div>
                    <div class="relative flex-1 min-h-0">
                      <DragDropProvider
                        onDragStart={handleWorkspaceDragStart}
                        onDragEnd={handleWorkspaceDragEnd}
                        onDragOver={handleWorkspaceDragOver}
                        collisionDetector={closestCenter}
                      >
                        <DragDropSensors />
                        <ConstrainDragXAxis />
                        <div
                          ref={(el) => {
                            if (!panelProps.mobile) scrollContainerRef = el
                          }}
                          class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                        >
                          <SortableProvider ids={workspaces()}>
                            <For each={workspaces()}>
                              {(directory) => (
                                <SortableWorkspace
                                  ctx={workspaceSidebarCtx}
                                  directory={directory}
                                  project={project}
                                  sortNow={sortNow}
                                  mobile={panelProps.mobile}
                                />
                              )}
                            </For>
                          </SortableProvider>
                        </div>
                        <DragOverlay>
                          <WorkspaceDragOverlay
                            sidebarProject={sidebarProject}
                            activeWorkspace={() => store.activeWorkspace}
                            workspaceLabel={workspaceLabel}
                          />
                        </DragOverlay>
                      </DragDropProvider>
                    </div>
                  </>
                </Show>
              </div>
            </>
          )}
        </Show>

        <div
          class="shrink-0 px-3 py-3"
          classList={{
            hidden: store.gettingStartedDismissed || !(providers.all().length > 0 && providers.paid().length === 0),
          }}
        >
          <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
            <div class="p-3 flex flex-col gap-6">
              <div class="flex flex-col gap-2">
                <div class="text-14-medium text-text-strong">{language.t("sidebar.gettingStarted.title")}</div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line1")}
                </div>
                <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                  {language.t("sidebar.gettingStarted.line2")}
                </div>
              </div>
              <div data-component="getting-started-actions">
                <Button size="large" icon="plus-small" onClick={connectProvider}>
                  {language.t("command.provider.connect")}
                </Button>
                <Button size="large" variant="ghost" onClick={() => setStore("gettingStartedDismissed", true)}>
                  {language.t("toast.update.action.notYet")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const projects = () => layout.projects.list()
  const sidebarContent = (mobile?: boolean) => {
    if (mobile || layout.sidebar.opened()) {
      return (
        <SidebarHub
          projects={projects}
          currentDir={currentDir}
          currentSessionID={currentSessionID}
          getProjectSessions={projectSessions}
          onOpenProject={(project) => void navigateToProject(project.worktree)}
          onOpenProjectNewChat={openProjectNewChat}
          onToggleProjectPin={toggleProjectPin}
          onOpenProjectDirectory={(project) => void openProjectDirectory(project)}
          onCreateProjectWorktree={(project) => void createProjectWorktree(project)}
          onRequestProjectRename={requestProjectRename}
          onRenameProject={(project, next) => {
            void renameProject(project, next)
          }}
          onArchiveProjectChats={(project) => void showArchiveProjectChatsDialog(project)}
          onRemoveProject={(project) => closeProject(project.worktree)}
          onOpenSession={navigateToSession}
          hasMoreProjectSessions={projectHasMoreSessions}
          onLoadMoreProjectSessions={loadMoreProjectSessions}
          onNewChat={openSidebarNewChat}
          onSearch={openSessionList}
          onPlugins={openPluginsManager}
          onAutomations={openAutomations}
          onSettings={openSettings}
          onStartProject={() => void chooseProject()}
          onOpenProjectChooser={() => void chooseProject()}
          editorOpen={editor.editorOpen}
          InlineEditor={editor.InlineEditor}
        />
      )
    }

    return null
  }

  const workspaceRightPanel = createMemo(() => workspaceRightPanelSlot())
  const workspaceRightPanelOpen = createMemo(() => workspaceRightPanel()?.open() ?? false)
  const workspaceRightPanelResizing = createMemo(() => workspaceRightPanel()?.resizing?.() ?? false)
  const workspaceRightPanelTargetWidth = createMemo(() => {
    const panel = workspaceRightPanel()
    if (!panel) return MIN_WORKSPACE_RIGHT_PANEL_WIDTH
    return Math.max(MIN_WORKSPACE_RIGHT_PANEL_WIDTH, panel.targetWidth())
  })
  const workspaceRightPanelVisibleWidth = createMemo(() =>
    workspaceRightPanelOpen() ? workspaceRightPanelTargetWidth() : 0,
  )
  const workspaceRightDividerWidth = createMemo(() =>
    workspaceRightPanel() ? WORKSPACE_PANEL_DIVIDER_WIDTH : 0,
  )
  const leftPanelOpen = createMemo(() => desktopPanels() && layout.sidebar.opened())
  const leftPanelChromeVisible = createMemo(() => desktopPanels() && (layout.sidebar.opened() || sidebarClosing()))
  const mainHeaderControlsVisible = createMemo(() => !leftPanelOpen())
  const workspaceSidebarVisibleWidth = createMemo(() => (leftPanelOpen() ? side() : 0))

  return (
    <LayoutHeaderSlotsContext.Provider value={headerSlots}>
      <WorkspacePanelsContext.Provider value={workspacePanels}>
        <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex overflow-hidden select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
          <TitlebarThemeSync />
          {autoselecting() ?? ""}
          <div
            class="hidden xl:block h-full min-h-0 min-w-0 shrink-0 overflow-hidden bg-background-base"
            classList={{
              "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
                !state.sizing,
            }}
            style={{
              width: `${workspaceSidebarVisibleWidth()}px`,
            }}
          >
            <div class="flex h-full min-h-0 min-w-0 flex-col bg-background-base" style={{ width: `${side()}px` }}>
              <PanelHeader
                class="bg-background-base"
                reserveTrafficLights={leftPanelChromeVisible()}
                left={
                  <div
                    classList={{
                      "transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
                        true,
                      "opacity-100": layout.sidebar.opened(),
                      "opacity-0": !layout.sidebar.opened(),
                    }}
                  >
                    <TitlebarLeadingControls
                      showSidebarToggle={true}
                      showNewSession={false}
                      showNavigation={true}
                      showMobileToggle={false}
                      showChannelBadge={false}
                    />
                  </div>
                }
              />
              <div class="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                <nav
                  aria-label={language.t("sidebar.nav.projectsAndSessions")}
                  data-component="sidebar-nav-desktop"
                  class="absolute inset-y-0 left-0 z-10 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  classList={{
                    "opacity-100 pointer-events-auto": layout.sidebar.opened(),
                    "opacity-0 pointer-events-none": !layout.sidebar.opened(),
                  }}
                  style={{ width: `${side()}px` }}
                  inert={!layout.sidebar.opened()}
                >
                  <div class="@container box-border w-full h-full contain-strict flex flex-col bg-background-base">
                    {sidebarContent(true)}
                  </div>
                </nav>
                <Show when={layout.sidebar.opened()}>
                  <nav
                    class="absolute inset-y-0 right-0 z-30 w-0 overflow-visible"
                    onPointerDown={() => setState("sizing", true)}
                  >
                    <ResizeHandle
                      direction="horizontal"
                      size={layout.sidebar.width()}
                      min={MIN_SIDEBAR_WIDTH}
                      max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                      onResize={(w) => {
                        setState("sizing", true)
                        if (sizet !== undefined) clearTimeout(sizet)
                        sizet = window.setTimeout(() => setState("sizing", false), 120)
                        layout.sidebar.resize(w)
                      }}
                    />
                  </nav>
                </Show>
              </div>
            </div>
          </div>
          <div class="hidden xl:block h-full min-h-0 app-panel-divider-x" />
          <div class="flex-1 min-h-0 min-w-0 flex flex-col relative">
            <PanelHeader
              class="bg-background-base"
              reserveTrafficLights={mainHeaderControlsVisible()}
              reserveWindowsControls={!workspaceRightPanelOpen()}
              left={
                <div style={mainHeaderControlsVisible() ? { animation: "fade-in 0.18s ease-out" } : undefined}>
                  <TitlebarLeadingControls
                    showSidebarToggle={mainHeaderControlsVisible()}
                    showNewSession={mainHeaderControlsVisible()}
                    showNavigation={mainHeaderControlsVisible()}
                  />
                </div>
              }
              center={mainHeaderCenter()}
              right={mainHeaderTrailing()}
            />
            <div class="flex-1 min-h-0 relative overflow-x-hidden">
              <div class="xl:hidden">
                <div
                  classList={{
                    "fixed inset-x-0 top-10 bottom-0 z-40 transition-opacity duration-200": true,
                    "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
                    "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) layout.mobileSidebar.hide()
                  }}
                />
                <nav
                  aria-label={language.t("sidebar.nav.projectsAndSessions")}
                  data-component="sidebar-nav-mobile"
                  classList={{
                    "@container fixed top-10 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden app-panel-border-r bg-background-base transition-transform duration-200 ease-out": true,
                    "translate-x-0": layout.mobileSidebar.opened(),
                    "-translate-x-full": !layout.mobileSidebar.opened(),
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {sidebarContent(true)}
                </nav>
              </div>

              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict bg-background-base": true,
                }}
              >
                <div class="flex-1 min-h-0 min-w-0 w-full">
                  <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
                    <Show
                      when={appRoute.page() === "automations" || appRoute.page() === "automation-editor"}
                      fallback={props.children}
                    >
                      <DialogAutomations
                        projects={layout.projects.list()}
                        currentDir={currentDir()}
                        automationID={appRoute.automationID()}
                        embedded
                        onOpenAutomations={(input) => {
                          const directory = currentDir() || layout.projects.list()[0]?.worktree
                          if (!directory) return
                          navigate(`/${base64Encode(directory)}/automations`, { replace: input?.replace })
                        }}
                        onOpenAutomation={(automation) =>
                          navigate(`/${base64Encode(automation.directory)}/automations/${automation.id}`)
                        }
                        onOpenSession={(session) =>
                          navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
                        }
                      />
                    </Show>
                  </Show>
                </div>
              </main>
            </div>
            {import.meta.env.DEV && <DebugBar />}
          </div>
          <div
            class="hidden xl:block h-full min-h-0 app-panel-divider-x transition-[width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            classList={{
              "opacity-100": workspaceRightDividerWidth() > 0,
              "opacity-0": workspaceRightDividerWidth() === 0,
            }}
            style={{ width: `${workspaceRightDividerWidth()}px` }}
          />
          <aside
            id={workspaceRightPanel()?.id}
            aria-label={workspaceRightPanel()?.label}
            aria-hidden={!workspaceRightPanelOpen()}
            inert={!workspaceRightPanelOpen()}
            class="hidden xl:flex flex-col relative min-h-0 min-w-0 shrink-0 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !workspaceRightPanelOpen(),
              "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none":
                !workspaceRightPanelResizing(),
            }}
            style={{
              width: `${workspaceRightPanelVisibleWidth()}px`,
            }}
          >
            <PanelHeader
              class={workspaceRightPanel()?.headerClass ?? "bg-background-base"}
              reserveWindowsControls={workspaceRightPanelOpen()}
              left={workspaceRightPanel()?.header}
            />
            <div class="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-background-base">
              <WorkspaceRightPanelHost
                panel={workspaceRightPanel}
                open={workspaceRightPanelOpen}
                targetWidth={workspaceRightPanelTargetWidth}
              />
            </div>
          </aside>
          <Toast.Region />
        </div>
      </WorkspacePanelsContext.Provider>
    </LayoutHeaderSlotsContext.Provider>
  )
}
