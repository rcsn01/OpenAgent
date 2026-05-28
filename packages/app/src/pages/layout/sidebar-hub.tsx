import { base64Encode } from "@opencode-ai/ui/utils/encode"
import { getFilename } from "@opencode-ai/ui/utils/path"
import { type Session } from "@opencode-ai/ui/contracts"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { pathKey } from "@/utils/path-key"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { displayName } from "./helpers"
import { ProjectActionsMenu } from "./project-actions-menu"
import { sidebarSessionStatus } from "./sidebar-session-status"

type InlineEditorComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void
  class?: string
  displayClass?: string
  editing?: boolean
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

const updatedAt = (session: Session) => session.time.updated ?? session.time.created
const projectEditorId = (project: LocalProject) => `project:${pathKey(project.worktree)}`
const isAutomationSession = (session: Session) =>
  (session as Session & { source?: string }).source === "automation" || session.title.startsWith("[Automation] ")
type ProjectOrganizeMode = "project" | "recent" | "chronological"
type ProjectSortMode = "created" | "updated"
type ProjectShowMode = "all" | "relevant"
const sidebarItemGapClass = "space-y-1"

const compactRelativeTime = (value: number) => {
  const diff = Math.max(0, Date.now() - value)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`

  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const sessionGlow = {
  running: "working",
  done: "done",
  pending: "needs-input",
  error: "failed",
} as const

const SessionMenuItem = (props: {
  icon: Parameters<typeof Icon>[0]["name"]
  label: string
  onSelect: () => void
}) => (
  <DropdownMenu.Item onSelect={props.onSelect} class="flex items-center gap-2.5">
    <span class="flex size-4 shrink-0 items-center justify-center text-icon-base">
      <Icon name={props.icon} size="small" />
    </span>
    <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
  </DropdownMenu.Item>
)

const ProjectSessionButton = (props: {
  session: Session
  active: Accessor<boolean>
  onOpen: () => void
  onArchive: (session: Session) => void
  onDelete: (session: Session) => void
}) => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const [menu, setMenu] = createStore({ open: false })
  const [sessionStore] = globalSync.child(props.session.directory, { bootstrap: false })
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const glow = createMemo(() => {
    const status = sidebarSessionStatus({
      status: sessionStore.session_status[props.session.id],
      hasPendingInteraction: hasPermissions(),
      hasUnseenError: hasError(),
      unseenCount: unseenCount(),
    })
    return status ? sessionGlow[status] : undefined
  })

  return (
    <div
      data-component="sidebar-session-row"
      data-session-glow={glow()}
      class="group/session flex w-full items-center gap-1 rounded-xl py-1.5 pl-10 pr-1.5 text-left transition-colors hover:bg-surface-base-hover focus-within:bg-surface-base-hover"
      classList={{
        "bg-surface-base-active": props.active() && glow() !== "working",
        "hover:bg-transparent": glow() === "working",
      }}
    >
      <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={props.onOpen}>
        <span class="type-prose-md min-w-0 flex-1 truncate text-text-strong">
          {sessionTitle(props.session.title) || getFilename(props.session.directory)}
        </span>
      </button>
      <div class="relative h-6 min-w-8 shrink-0">
        <span
          class="type-prose-md absolute right-0 top-1/2 -translate-y-1/2 text-text-weak transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0"
          classList={{ "opacity-0": menu.open }}
        >
          {compactRelativeTime(updatedAt(props.session))}
        </span>
        <DropdownMenu open={menu.open} onOpenChange={(open) => setMenu("open", open)}>
          <Tooltip value={language.t("common.moreOptions")} placement="top">
            <DropdownMenu.Trigger
              as={IconButton}
              icon="settings-gear"
              variant="ghost"
              data-action="session-menu"
              data-session={props.session.id}
              class="absolute right-0 top-1/2 size-6 -translate-y-1/2 rounded-lg text-text-weak transition-opacity hover:text-text-strong data-[expanded]:bg-surface-base-active opacity-0 pointer-events-none group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto data-[expanded]:opacity-100 data-[expanded]:pointer-events-auto"
              aria-label={language.t("common.moreOptions")}
            />
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <SessionMenuItem icon="archive" label={language.t("common.archive")} onSelect={() => props.onArchive(props.session)} />
              <DropdownMenu.Separator />
              <SessionMenuItem icon="trash" label={language.t("common.delete")} onSelect={() => props.onDelete(props.session)} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}

const SidebarAction = (props: {
  icon: "new-session" | "magnifying-glass" | "providers" | "checklist" | "settings-gear"
  label: string
  onClick: () => void
}) => (
  <button
    type="button"
    class="flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-surface-base-hover active:bg-surface-base-active"
    onClick={props.onClick}
  >
    <span class="flex size-5 shrink-0 items-center justify-center text-icon-base">
      <Icon name={props.icon} />
    </span>
    <span class="type-prose-md truncate text-text-strong">{props.label}</span>
  </button>
)

const ProjectHeaderMenuItem = (props: {
  icon: Parameters<typeof Icon>[0]["name"]
  label: string
  selected?: boolean
  disabled?: boolean
  onSelect: () => void
}) => (
  <DropdownMenu.Item disabled={props.disabled} onSelect={props.onSelect} class="flex items-center gap-2.5">
    <span class="flex size-4 shrink-0 items-center justify-center text-icon-base">
      <Icon name={props.icon} size="small" />
    </span>
    <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
    <Show when={props.selected}>
      <span class="ml-auto flex size-4 shrink-0 items-center justify-center text-icon-base">
        <Icon name="check" size="small" />
      </span>
    </Show>
  </DropdownMenu.Item>
)

const ProjectHeaderMenuLabel = (props: { label: string }) => (
  <DropdownMenu.GroupLabel class="px-2 py-1 text-12-medium text-text-weaker">{props.label}</DropdownMenu.GroupLabel>
)

const ProjectSection = (props: {
  label?: string
  projects: Accessor<LocalProject[]>
  currentDir: Accessor<string>
  currentSessionID: Accessor<string | undefined>
  getProjectSessions: (project: LocalProject) => Session[]
  onOpenProject: (project: LocalProject) => void
  onOpenProjectNewChat: (project: LocalProject) => void
  onToggleProjectPin: (project: LocalProject) => void
  onOpenProjectDirectory: (project: LocalProject) => void
  onCreateProjectWorktree: (project: LocalProject) => void
  onRequestProjectRename: (project: LocalProject) => void
  onRenameProject: (project: LocalProject, next: string) => void
  onArchiveProjectChats: (project: LocalProject) => void
  onRemoveProject: (project: LocalProject) => void
  onOpenSession: (session: Session) => void
  onArchiveSession: (session: Session) => void
  onDeleteSession: (session: Session) => void
  hasMoreProjectSessions: (project: LocalProject) => boolean
  onLoadMoreProjectSessions: (project: LocalProject) => Promise<void>
  visibleCount: Record<string, number>
  setProjectVisibleCount: (worktree: string, count: number) => void
  sortMode: Accessor<ProjectSortMode>
  editorOpen: (id: string) => boolean
  InlineEditor: InlineEditorComponent
}) => {
  const language = useLanguage()
  const projectVisibleCount = (project: LocalProject) => props.visibleCount[project.worktree] ?? 5

  return (
    <Show when={props.projects().length > 0}>
      <div class={sidebarItemGapClass}>
        <Show when={props.label}>
          {(label) => <div class="type-prose-md px-2 pb-2 text-text-weaker">{label()}</div>}
        </Show>
        <For each={props.projects()}>
          {(project) => {
            const sessions = createMemo(() =>
              props
                .getProjectSessions(project)
                .filter((session) => !isAutomationSession(session))
                .toSorted((a, b) =>
                  props.sortMode() === "created" ? b.time.created - a.time.created : updatedAt(b) - updatedAt(a),
                ),
            )
            const visible = () => sessions().slice(0, projectVisibleCount(project))
            const sessionsVisible = () => projectVisibleCount(project) > 0
            const hasMore = () => props.hasMoreProjectSessions(project)
            const canShowMore = () => projectVisibleCount(project) < sessions().length || hasMore()
            const canShowLess = () => projectVisibleCount(project) > 5
            const showMoreControl = () => canShowMore() || canShowLess()
            const toggleProjectSessions = () => {
              if (sessionsVisible()) {
                props.setProjectVisibleCount(project.worktree, 0)
                return
              }
              props.setProjectVisibleCount(project.worktree, 5)
            }
            const showMore = async () => {
              const current = projectVisibleCount(project)
              if (current >= sessions().length && hasMore()) await props.onLoadMoreProjectSessions(project)
              props.setProjectVisibleCount(project.worktree, current + 5)
            }
            const showLess = () => {
              props.setProjectVisibleCount(project.worktree, Math.max(5, projectVisibleCount(project) - 5))
            }

            return (
              <section class="group/project space-y-1">
                <div class="flex items-center justify-between gap-1 rounded-xl px-2 py-0.5 transition-colors hover:bg-surface-base-hover focus-within:bg-surface-base-hover">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    onClick={toggleProjectSessions}
                  >
                    <span class="flex size-5 shrink-0 items-center justify-center text-icon-base">
                      <Icon name="folder" />
                    </span>
                    <props.InlineEditor
                      id={projectEditorId(project)}
                      value={() => displayName(project)}
                      onSave={(next) => props.onRenameProject(project, next)}
                      class="type-prose-md min-w-0 truncate text-text-strong"
                      displayClass="type-prose-md min-w-0 truncate text-text-strong"
                      editing={props.editorOpen(projectEditorId(project))}
                      openOnDblClick={false}
                    />
                  </button>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <ProjectActionsMenu
                      project={() => project}
                      hoverOnly
                      triggerClass="size-7 text-text-weak hover:text-text-strong"
                      triggerDataAction="project-menu"
                      triggerDataProject={base64Encode(project.worktree)}
                      onTogglePin={props.onToggleProjectPin}
                      onOpenDirectory={props.onOpenProjectDirectory}
                      onCreateWorktree={props.onCreateProjectWorktree}
                      onRequestRename={props.onRequestProjectRename}
                      onArchiveChats={props.onArchiveProjectChats}
                      onRemove={props.onRemoveProject}
                    />
                    <Tooltip value={language.t("command.session.new")} placement="top">
                      <IconButton
                        icon="new-session"
                        variant="ghost"
                        class="size-7 rounded-lg text-text-weak transition-opacity hover:text-text-strong opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto group-focus-within/project:opacity-100 group-focus-within/project:pointer-events-auto"
                        aria-label={language.t("command.session.new")}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          props.onOpenProjectNewChat(project)
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>

                <Show when={sessionsVisible()}>
                  <div class="space-y-0.5">
                    <Show
                      when={sessions().length > 0}
                      fallback={<div class="type-prose-md py-0.5 pl-10 pr-3 text-text-weaker">No sessions yet</div>}
                    >
                      <For each={visible()}>
                        {(session) => {
                          const active = () =>
                            props.currentSessionID() === session.id &&
                            pathKey(props.currentDir()) === pathKey(session.directory)

                          return (
                            <ProjectSessionButton
                              session={session}
                              active={active}
                              onOpen={() => props.onOpenSession(session)}
                              onArchive={props.onArchiveSession}
                              onDelete={props.onDeleteSession}
                            />
                          )
                        }}
                      </For>
                    </Show>
                    <Show when={showMoreControl()}>
                      <div class="flex items-center justify-between gap-2 py-0.5 pl-10 pr-3">
                        <Show when={canShowMore()}>
                          <button
                            type="button"
                            class="type-prose-md text-text-weaker transition-colors hover:text-text-strong"
                            onClick={() => void showMore()}
                          >
                            Show more
                          </button>
                        </Show>
                        <Show when={canShowLess()}>
                          <button
                            type="button"
                            class="type-prose-md ml-auto text-text-weaker transition-colors hover:text-text-strong"
                            onClick={showLess}
                          >
                            Show less
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

export const SidebarHub = (props: {
  projects: Accessor<LocalProject[]>
  currentDir: Accessor<string>
  currentSessionID: Accessor<string | undefined>
  getProjectSessions: (project: LocalProject) => Session[]
  onOpenProject: (project: LocalProject) => void
  onOpenProjectNewChat: (project: LocalProject) => void
  onToggleProjectPin: (project: LocalProject) => void
  onOpenProjectDirectory: (project: LocalProject) => void
  onCreateProjectWorktree: (project: LocalProject) => void
  onRequestProjectRename: (project: LocalProject) => void
  onRenameProject: (project: LocalProject, next: string) => void
  onArchiveProjectChats: (project: LocalProject) => void
  onRemoveProject: (project: LocalProject) => void
  onOpenSession: (session: Session) => void
  onArchiveSession: (session: Session) => void
  onDeleteSession: (session: Session) => void
  hasMoreProjectSessions: (project: LocalProject) => boolean
  onLoadMoreProjectSessions: (project: LocalProject) => Promise<void>
  onNewChat: () => void
  onSearch: () => void
  onPlugins: () => void
  onAutomations: () => void
  onSettings: () => void
  onStartProject: () => void
  onOpenProjectChooser: () => void
  editorOpen: (id: string) => boolean
  InlineEditor: InlineEditorComponent
}) => {
  const language = useLanguage()
  const [view, setView] = createStore({
    organize: "project" as ProjectOrganizeMode,
    sort: "updated" as ProjectSortMode,
    show: "all" as ProjectShowMode,
    visibleCount: {} as Record<string, number>,
  })
  const setProjectVisibleCount = (worktree: string, count: number) => setView("visibleCount", worktree, count)
  const collapseAllProjects = () => {
    for (const project of visibleProjects()) {
      setProjectVisibleCount(project.worktree, 0)
    }
  }
  const visibleProjectSessions = (project: LocalProject) =>
    props.getProjectSessions(project).filter((session) => !isAutomationSession(session))
  const projectTime = (project: LocalProject, mode: ProjectSortMode) => {
    const sessions = visibleProjectSessions(project)
    if (sessions.length === 0) return 0
    if (mode === "created") return Math.max(...sessions.map((session) => session.time.created))
    return Math.max(...sessions.map(updatedAt))
  }
  const relevant = (project: LocalProject) =>
    !!project.pinned ||
    pathKey(props.currentDir()) === pathKey(project.worktree) ||
    visibleProjectSessions(project).length > 0
  const visibleProjects = createMemo(() =>
    props
      .projects()
      .filter((project) => view.show === "all" || relevant(project))
      .toSorted((a, b) => {
        if (view.organize === "project") return 0
        return projectTime(b, view.sort) - projectTime(a, view.sort)
      }),
  )
  const pinnedProjects = createMemo(() => visibleProjects().filter((project) => !!project.pinned))
  const otherProjects = createMemo(() => visibleProjects().filter((project) => !project.pinned))

  return (
    <div class="flex flex-1 min-h-0 w-full min-w-0 flex-col bg-background-base px-2 pb-3 pt-2">
      <div class={`shrink-0 ${sidebarItemGapClass}`}>
        <SidebarAction icon="new-session" label="New session" onClick={props.onNewChat} />
        <SidebarAction icon="magnifying-glass" label="Search" onClick={props.onSearch} />
        <SidebarAction icon="providers" label="Plugins" onClick={props.onPlugins} />
        <SidebarAction icon="checklist" label="Automations" onClick={props.onAutomations} />
      </div>

      <div class="mt-1 flex-1 min-h-0 overflow-y-auto pr-1 no-scrollbar">
        <div class={`${sidebarItemGapClass} pb-4`}>
          <Show
            when={props.projects().length > 0}
            fallback={
              <div class="rounded-2xl border border-border-weak-base bg-surface-raised-base px-4 py-4">
                <div class="type-prose-md text-text-strong">{language.t("sidebar.empty.title")}</div>
                <div class="type-prose-md mt-1 text-text-weak">{language.t("sidebar.empty.description")}</div>
                <button
                  type="button"
                  class="type-prose-md mt-4 inline-flex rounded-xl bg-surface-base-active px-3 py-2 text-text-strong transition-colors hover:bg-surface-base-hover"
                  onClick={props.onOpenProjectChooser}
                >
                  {language.t("command.project.open")}
                </button>
              </div>
            }
          >
            <div class={sidebarItemGapClass}>
              <div class="group/project-header flex items-center justify-between gap-2 px-2">
                <div class="type-prose-md text-text-weaker">{language.t("sidebar.project.projectsSection")}</div>
                <div class="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/project-header:opacity-100 group-hover/project-header:pointer-events-auto group-focus-within/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto">
                  <Tooltip
                    value={language.t("sidebar.project.compact")}
                    placement="top"
                  >
                    <IconButton
                      icon="collapse"
                      variant="ghost"
                      class="size-7 rounded-lg text-text-weak hover:text-text-strong"
                      aria-label={language.t("sidebar.project.compact")}
                      onClick={collapseAllProjects}
                    />
                  </Tooltip>
                  <DropdownMenu>
                    <Tooltip value={language.t("sidebar.project.viewOptions")} placement="top">
                      <DropdownMenu.Trigger
                        as={IconButton}
                        icon="menu"
                        variant="ghost"
                        class="size-7 rounded-lg text-text-weak hover:text-text-strong data-[expanded]:bg-surface-base-active"
                        aria-label={language.t("sidebar.project.viewOptions")}
                      />
                    </Tooltip>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Group>
                          <ProjectHeaderMenuLabel label={language.t("sidebar.project.organize")} />
                          <ProjectHeaderMenuItem
                            icon="folder"
                            label={language.t("sidebar.project.organize.byProject")}
                            selected={view.organize === "project"}
                            onSelect={() => setView("organize", "project")}
                          />
                          <ProjectHeaderMenuItem
                            icon="folder"
                            label={language.t("sidebar.project.organize.recent")}
                            selected={view.organize === "recent"}
                            onSelect={() => setView("organize", "recent")}
                          />
                          <ProjectHeaderMenuItem
                            icon="status"
                            label={language.t("sidebar.project.organize.chronological")}
                            selected={view.organize === "chronological"}
                            onSelect={() => setView("organize", "chronological")}
                          />
                        </DropdownMenu.Group>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Group>
                          <ProjectHeaderMenuLabel label={language.t("sidebar.project.sortBy")} />
                          <ProjectHeaderMenuItem
                            icon="plus-small"
                            label={language.t("sidebar.project.sort.created")}
                            selected={view.sort === "created"}
                            onSelect={() => setView("sort", "created")}
                          />
                          <ProjectHeaderMenuItem
                            icon="edit-small-2"
                            label={language.t("sidebar.project.sort.updated")}
                            selected={view.sort === "updated"}
                            onSelect={() => setView("sort", "updated")}
                          />
                        </DropdownMenu.Group>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Group>
                          <ProjectHeaderMenuLabel label={language.t("sidebar.project.show")} />
                          <ProjectHeaderMenuItem
                            icon="speech-bubble"
                            label={language.t("sidebar.project.show.all")}
                            selected={view.show === "all"}
                            onSelect={() => setView("show", "all")}
                          />
                          <ProjectHeaderMenuItem
                            icon="star"
                            label={language.t("sidebar.project.show.relevant")}
                            selected={view.show === "relevant"}
                            onSelect={() => setView("show", "relevant")}
                          />
                        </DropdownMenu.Group>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                  <DropdownMenu>
                    <Tooltip value={language.t("sidebar.project.add")} placement="top">
                      <DropdownMenu.Trigger
                        as={IconButton}
                        icon="folder-add-left"
                        variant="ghost"
                        class="size-7 rounded-lg text-text-weak hover:text-text-strong data-[expanded]:bg-surface-base-active"
                        aria-label={language.t("sidebar.project.add")}
                      />
                    </Tooltip>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <ProjectHeaderMenuItem
                          icon="plus"
                          label={language.t("sidebar.project.startFromScratch")}
                          onSelect={props.onStartProject}
                        />
                        <ProjectHeaderMenuItem
                          icon="folder"
                          label={language.t("sidebar.project.useExistingFolder")}
                          onSelect={props.onOpenProjectChooser}
                        />
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>
              <Show
                when={view.organize === "project"}
                fallback={
                  <ProjectSection
                    projects={visibleProjects}
                    currentDir={props.currentDir}
                    currentSessionID={props.currentSessionID}
                    getProjectSessions={props.getProjectSessions}
                    onOpenProject={props.onOpenProject}
                    onOpenProjectNewChat={props.onOpenProjectNewChat}
                    onToggleProjectPin={props.onToggleProjectPin}
                    onOpenProjectDirectory={props.onOpenProjectDirectory}
                    onCreateProjectWorktree={props.onCreateProjectWorktree}
                    onRequestProjectRename={props.onRequestProjectRename}
                    onRenameProject={props.onRenameProject}
                    onArchiveProjectChats={props.onArchiveProjectChats}
                    onRemoveProject={props.onRemoveProject}
                    onOpenSession={props.onOpenSession}
                    onArchiveSession={props.onArchiveSession}
                    onDeleteSession={props.onDeleteSession}
                    hasMoreProjectSessions={props.hasMoreProjectSessions}
                    onLoadMoreProjectSessions={props.onLoadMoreProjectSessions}
                    visibleCount={view.visibleCount}
                    setProjectVisibleCount={setProjectVisibleCount}
                    sortMode={() => view.sort}
                    editorOpen={props.editorOpen}
                    InlineEditor={props.InlineEditor}
                  />
                }
              >
                <ProjectSection
                  projects={pinnedProjects}
                  label={pinnedProjects().length > 0 ? language.t("sidebar.project.pinnedSection") : undefined}
                  currentDir={props.currentDir}
                  currentSessionID={props.currentSessionID}
                  getProjectSessions={props.getProjectSessions}
                  onOpenProject={props.onOpenProject}
                  onOpenProjectNewChat={props.onOpenProjectNewChat}
                  onToggleProjectPin={props.onToggleProjectPin}
                  onOpenProjectDirectory={props.onOpenProjectDirectory}
                  onCreateProjectWorktree={props.onCreateProjectWorktree}
                  onRequestProjectRename={props.onRequestProjectRename}
                  onRenameProject={props.onRenameProject}
                  onArchiveProjectChats={props.onArchiveProjectChats}
                  onRemoveProject={props.onRemoveProject}
                  onOpenSession={props.onOpenSession}
                  onArchiveSession={props.onArchiveSession}
                  onDeleteSession={props.onDeleteSession}
                  hasMoreProjectSessions={props.hasMoreProjectSessions}
                  onLoadMoreProjectSessions={props.onLoadMoreProjectSessions}
                  visibleCount={view.visibleCount}
                  setProjectVisibleCount={setProjectVisibleCount}
                  sortMode={() => view.sort}
                  editorOpen={props.editorOpen}
                  InlineEditor={props.InlineEditor}
                />
                <ProjectSection
                  projects={otherProjects}
                  currentDir={props.currentDir}
                  currentSessionID={props.currentSessionID}
                  getProjectSessions={props.getProjectSessions}
                  onOpenProject={props.onOpenProject}
                  onOpenProjectNewChat={props.onOpenProjectNewChat}
                  onToggleProjectPin={props.onToggleProjectPin}
                  onOpenProjectDirectory={props.onOpenProjectDirectory}
                  onCreateProjectWorktree={props.onCreateProjectWorktree}
                  onRequestProjectRename={props.onRequestProjectRename}
                  onRenameProject={props.onRenameProject}
                  onArchiveProjectChats={props.onArchiveProjectChats}
                  onRemoveProject={props.onRemoveProject}
                  onOpenSession={props.onOpenSession}
                  onArchiveSession={props.onArchiveSession}
                  onDeleteSession={props.onDeleteSession}
                  hasMoreProjectSessions={props.hasMoreProjectSessions}
                  onLoadMoreProjectSessions={props.onLoadMoreProjectSessions}
                  visibleCount={view.visibleCount}
                  setProjectVisibleCount={setProjectVisibleCount}
                  sortMode={() => view.sort}
                  editorOpen={props.editorOpen}
                  InlineEditor={props.InlineEditor}
                />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="mt-3 shrink-0 app-inner-border-t pt-2">
        <SidebarAction icon="settings-gear" label="Settings" onClick={props.onSettings} />
      </div>
    </div>
  )
}
