import { getFilename } from "@opencode-ai/core/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { sessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { displayName } from "./helpers"
import { createStore } from "solid-js/store"
import { For, Show, type Accessor } from "solid-js"
import { type LocalProject } from "@/context/layout"

const updatedAt = (session: Session) => session.time.updated ?? session.time.created

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

export const SidebarHub = (props: {
  projects: Accessor<LocalProject[]>
  currentDir: Accessor<string>
  currentSessionID: Accessor<string | undefined>
  getProjectSessions: (project: LocalProject) => Session[]
  onOpenProject: (project: LocalProject) => void
  onEditProject: (project: LocalProject) => void
  onOpenSession: (session: Session) => void
  onNewChat: () => void
  onSearch: () => void
  onPlugins: () => void
  onAutomations: () => void
  onSettings: () => void
  onOpenProjectChooser: () => void
}) => {
  const [expanded, setExpanded] = createStore({} as Record<string, boolean>)

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border-weaker-base bg-background-base px-4 pb-3 pt-2">
      <div class="shrink-0 space-y-1">
        <SidebarAction icon="new-session" label="New chat" onClick={props.onNewChat} />
        <SidebarAction icon="magnifying-glass" label="Search" onClick={props.onSearch} />
        <SidebarAction icon="providers" label="Plugins" onClick={props.onPlugins} />
        <SidebarAction icon="checklist" label="Automations" onClick={props.onAutomations} />
      </div>

      <div class="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 no-scrollbar">
        <div class="pb-4">
          <div class="type-prose-md px-2 pb-2 text-text-weaker">Projects</div>
          <Show
            when={props.projects().length > 0}
            fallback={
              <div class="rounded-2xl border border-border-weak-base bg-surface-raised-base px-4 py-4">
                <div class="type-prose-md text-text-strong">No projects yet</div>
                <div class="type-prose-md mt-1 text-text-weak">Open a folder to start a new chat.</div>
                <button
                  type="button"
                  class="type-prose-md mt-4 inline-flex rounded-xl bg-surface-base-active px-3 py-2 text-text-strong transition-colors hover:bg-surface-base-hover"
                  onClick={props.onOpenProjectChooser}
                >
                  Open project
                </button>
              </div>
            }
          >
            <div class="space-y-3">
              <For each={props.projects()}>
                {(project) => {
                  const sessions = () => props.getProjectSessions(project)
                  const visible = () => (expanded[project.worktree] ? sessions() : sessions().slice(0, 5))

                  return (
                    <section class="space-y-1">
                      <div class="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1 text-left transition-colors hover:bg-surface-base-hover"
                          onClick={() => props.onOpenProject(project)}
                        >
                          <span class="flex size-5 shrink-0 items-center justify-center text-icon-base">
                            <Icon name="folder" />
                          </span>
                          <span class="type-prose-md truncate text-text-strong">{displayName(project)}</span>
                        </button>
                        <IconButton
                          icon="edit-small-2"
                          variant="ghost"
                          class="size-7 shrink-0 rounded-lg text-text-weak hover:text-text-strong"
                          aria-label={`Edit ${displayName(project)}`}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            props.onEditProject(project)
                          }}
                        />
                      </div>

                      <div class="space-y-0.5 pl-7">
                        <Show
                          when={sessions().length > 0}
                          fallback={<div class="type-prose-md px-3 py-0.5 text-text-weaker">No chats yet</div>}
                        >
                          <For each={visible()}>
                            {(session) => {
                              const active =
                                props.currentSessionID() === session.id &&
                                pathKey(props.currentDir()) === pathKey(session.directory)

                              return (
                                <button
                                  type="button"
                                  class="flex w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-left transition-colors hover:bg-surface-base-hover"
                                  classList={{ "bg-surface-base-active": active }}
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
                    </section>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        <div class="border-t border-border-weaker-base pt-4">
          <div class="type-prose-md px-2 pb-2 text-text-weaker">Chats</div>
          <div class="type-prose-md px-2 text-text-weaker">No chats</div>
        </div>
      </div>

      <div class="mt-3 shrink-0 border-t border-border-weaker-base pt-2">
        <SidebarAction icon="settings-gear" label="Settings" onClick={props.onSettings} />
      </div>
    </div>
  )
}
