import { createMediaQuery } from "@solid-primitives/media"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type GeneralChatInfo } from "@/context/general-chat"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { pathKey } from "@/utils/path-key"
import { sessionTitle } from "@/utils/session-title"
import { displayName } from "./helpers"
import { ProjectActionsMenu } from "./project-actions-menu"

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
type ProjectOrganizeMode = "project" | "recent" | "chronological"
type ProjectSortMode = "created" | "updated"
type ProjectShowMode = "all" | "relevant"

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

const SidebarAction = (props: {
  icon: "new-session" | "magnifying-glass" | "providers" | "checklist" | "settings-gear"
  label: string
  onClick: () => void
}) => (
  <button
    type="button"
    class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-base-hover active:bg-surface-base-active"
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

const ChatSection = (props: {
  chats: Accessor<GeneralChatInfo[]>
  currentChatID: Accessor<string | undefined>
  onOpenChat: (chat: GeneralChatInfo) => void
  onWarmChat: (chat: GeneralChatInfo) => void
  onArchiveChat: (chat: GeneralChatInfo) => void
  onNewChat: () => void
}) => {
  const language = useLanguage()
  const touch = createMediaQuery("(hover: none)")

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 px-2">
        <div class="type-prose-md text-text-weaker">{language.t("sidebar.chat.section")}</div>
        <Tooltip value={language.t("command.session.new")} placement="top">
          <IconButton
            icon="new-session"
            variant="ghost"
            class="size-7 rounded-lg text-text-weak hover:text-text-strong"
            aria-label={language.t("command.session.new")}
            onClick={props.onNewChat}
          />
        </Tooltip>
      </div>
      <Show
        when={props.chats().length > 0}
        fallback={<div class="type-prose-md px-2 text-text-weaker">{language.t("sidebar.chat.empty")}</div>}
      >
        <div class="max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
          <div class="space-y-0.5">
            <For each={props.chats()}>
              {(chat) => {
                const active = () => props.currentChatID() === chat.rootSessionID
                const title = () => sessionTitle(chat.session.title) || language.t("command.session.new")

                return (
                  <div
                    class="group/chat flex items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors hover:bg-surface-base-hover"
                    classList={{ "bg-surface-base-active": active() }}
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onPointerDown={() => props.onWarmChat(chat)}
                      onFocus={() => props.onWarmChat(chat)}
                      onClick={() => props.onOpenChat(chat)}
                    >
                      <span class="type-prose-md min-w-0 flex-1 truncate text-text-strong">{title()}</span>
                      <span class="type-prose-md shrink-0 text-text-weak">
                        {compactRelativeTime(updatedAt(chat.session))}
                      </span>
                    </button>
                    <div
                      class="shrink-0 overflow-hidden transition-[width,opacity]"
                      classList={{
                        "w-7 opacity-100 pointer-events-auto": !!touch(),
                        "w-0 opacity-0 pointer-events-none": !touch(),
                        "group-hover/chat:w-7 group-hover/chat:opacity-100 group-hover/chat:pointer-events-auto": true,
                        "group-focus-within/chat:w-7 group-focus-within/chat:opacity-100 group-focus-within/chat:pointer-events-auto":
                          true,
                      }}
                    >
                      <Tooltip value={language.t("common.archive")} placement="top">
                        <IconButton
                          icon="archive"
                          variant="ghost"
                          class="size-7 rounded-lg text-text-weak hover:text-text-strong"
                          aria-label={language.t("common.archive")}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            props.onArchiveChat(chat)
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

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
  showSessions: Accessor<boolean>
  sortMode: Accessor<ProjectSortMode>
  editorOpen: (id: string) => boolean
  InlineEditor: InlineEditorComponent
}) => {
  const language = useLanguage()
  const touch = createMediaQuery("(hover: none)")
  const [expanded, setExpanded] = createStore({} as Record<string, boolean>)

  return (
    <Show when={props.projects().length > 0}>
      <div class="space-y-3">
        <Show when={props.label}>
          {(label) => <div class="type-prose-md px-2 pb-2 text-text-weaker">{label()}</div>}
        </Show>
        <For each={props.projects()}>
          {(project) => {
            const sessions = createMemo(() =>
              props
                .getProjectSessions(project)
                .toSorted((a, b) =>
                  props.sortMode() === "created" ? b.time.created - a.time.created : updatedAt(b) - updatedAt(a),
                ),
            )
            const visible = () => (expanded[project.worktree] ? sessions() : sessions().slice(0, 5))

            return (
              <section class="group/project space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1 text-left transition-colors hover:bg-surface-base-hover"
                    onClick={() => props.onOpenProject(project)}
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
                      hoverOnly={!touch()}
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
                        class="size-7 rounded-lg text-text-weak hover:text-text-strong"
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

                <Show when={props.showSessions()}>
                  <div class="space-y-0.5 pl-7">
                    <Show
                      when={sessions().length > 0}
                      fallback={<div class="type-prose-md px-3 py-0.5 text-text-weaker">No chats yet</div>}
                    >
                      <For each={visible()}>
                        {(session) => {
                          const active = () =>
                            props.currentSessionID() === session.id &&
                            pathKey(props.currentDir()) === pathKey(session.directory)

                          return (
                            <button
                              type="button"
                              class="flex w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-left transition-colors hover:bg-surface-base-hover"
                              classList={{ "bg-surface-base-active": active() }}
                              onClick={() => props.onOpenSession(session)}
                            >
                              <span class="type-prose-md min-w-0 flex-1 truncate text-text-strong">
                                {sessionTitle(session.title) || getFilename(session.directory)}
                              </span>
                              <span class="type-prose-md shrink-0 text-text-weak">
                                {compactRelativeTime(updatedAt(session))}
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </Show>
                    <Show when={sessions().length > 5}>
                      <button
                        type="button"
                        class="type-prose-md px-3 py-0.5 text-text-weaker transition-colors hover:text-text-strong"
                        onClick={() => setExpanded(project.worktree, (value) => !value)}
                      >
                        {expanded[project.worktree] ? "Show less" : "Show more"}
                      </button>
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
  chats: Accessor<GeneralChatInfo[]>
  currentChatID: Accessor<string | undefined>
  projects: Accessor<LocalProject[]>
  currentDir: Accessor<string>
  currentSessionID: Accessor<string | undefined>
  onOpenChat: (chat: GeneralChatInfo) => void
  onWarmChat: (chat: GeneralChatInfo) => void
  onArchiveChat: (chat: GeneralChatInfo) => void
  onNewGeneralChat: () => void
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
    showSessions: true,
    organize: "project" as ProjectOrganizeMode,
    sort: "updated" as ProjectSortMode,
    show: "all" as ProjectShowMode,
  })
  const projectTime = (project: LocalProject, mode: ProjectSortMode) => {
    const sessions = props.getProjectSessions(project)
    if (sessions.length === 0) return 0
    if (mode === "created") return Math.max(...sessions.map((session) => session.time.created))
    return Math.max(...sessions.map(updatedAt))
  }
  const relevant = (project: LocalProject) =>
    !!project.pinned ||
    pathKey(props.currentDir()) === pathKey(project.worktree) ||
    props.getProjectSessions(project).length > 0
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
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border-weaker-base bg-background-base px-4 pb-3 pt-2">
      <div class="shrink-0 space-y-1">
        <SidebarAction icon="new-session" label="New chat" onClick={props.onNewChat} />
        <SidebarAction icon="magnifying-glass" label="Search" onClick={props.onSearch} />
        <SidebarAction icon="providers" label="Plugins" onClick={props.onPlugins} />
        <SidebarAction icon="checklist" label="Automations" onClick={props.onAutomations} />
      </div>

      <div class="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 no-scrollbar">
        <div class="space-y-4 pb-4">
          <ChatSection
            chats={props.chats}
            currentChatID={props.currentChatID}
            onOpenChat={props.onOpenChat}
            onWarmChat={props.onWarmChat}
            onArchiveChat={props.onArchiveChat}
            onNewChat={props.onNewGeneralChat}
          />
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
            <div class="space-y-4">
              <div class="group/project-header flex items-center justify-between gap-2 px-2">
                <div class="type-prose-md text-text-weaker">{language.t("sidebar.project.projectsSection")}</div>
                <div class="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/project-header:opacity-100 group-hover/project-header:pointer-events-auto group-focus-within/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto">
                  <Tooltip
                    value={
                      view.showSessions
                        ? language.t("sidebar.project.compact")
                        : language.t("sidebar.project.expand")
                    }
                    placement="top"
                  >
                    <IconButton
                      icon={view.showSessions ? "collapse" : "expand"}
                      variant="ghost"
                      class="size-7 rounded-lg text-text-weak hover:text-text-strong"
                      aria-label={
                        view.showSessions
                          ? language.t("sidebar.project.compact")
                          : language.t("sidebar.project.expand")
                      }
                      aria-pressed={!view.showSessions}
                      onClick={() => setView("showSessions", (value) => !value)}
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
                        <DropdownMenu.Separator />
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
                        <DropdownMenu.Separator />
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
                    showSessions={() => view.showSessions}
                    sortMode={() => view.sort}
                    editorOpen={props.editorOpen}
                    InlineEditor={props.InlineEditor}
                  />
                }
              >
                <ProjectSection
                  projects={pinnedProjects}
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
                  showSessions={() => view.showSessions}
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
                  showSessions={() => view.showSessions}
                  sortMode={() => view.sort}
                  editorOpen={props.editorOpen}
                  InlineEditor={props.InlineEditor}
                />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="mt-3 shrink-0 border-t border-border-weaker-base pt-2">
        <SidebarAction icon="settings-gear" label="Settings" onClick={props.onSettings} />
      </div>
    </div>
  )
}
