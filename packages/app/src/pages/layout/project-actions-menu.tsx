import { createMemo, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

type OS = "macos" | "windows" | "linux" | "unknown"

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const ProjectMenuItem = (props: {
  icon: IconProps["name"]
  label: string
  disabled?: boolean
  onSelect: () => void
}) => (
  <DropdownMenu.Item
    disabled={props.disabled}
    onSelect={props.onSelect}
    class="flex items-center gap-2.5"
  >
    <span class="flex size-4 shrink-0 items-center justify-center text-icon-base">
      <Icon name={props.icon} size="small" />
    </span>
    <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
  </DropdownMenu.Item>
)

export const ProjectActionsMenu = (props: {
  project: Accessor<LocalProject | undefined>
  onTogglePin: (project: LocalProject) => void
  onOpenDirectory: (project: LocalProject) => void
  onCreateWorktree: (project: LocalProject) => void
  onRequestRename: (project: LocalProject) => void
  onArchiveChats: (project: LocalProject) => void
  onRemove: (project: LocalProject) => void
  hoverOnly?: boolean
  sidebarHovering?: Accessor<boolean>
  triggerClass?: string
  triggerDataAction?: string
  triggerDataProject?: string
}) => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const os = createMemo(() => detectOS(platform))
  const [state, setState] = createStore({
    open: false,
    pendingRename: false,
  })
  const canOpenDirectory = createMemo(() => !!platform.openPath && server.isLocal())
  const openDirectoryLabel = createMemo(() => {
    if (os() === "macos") return language.t("session.header.open.finder")
    if (os() === "windows") return language.t("session.header.open.fileExplorer")
    return language.t("session.header.open.fileManager")
  })
  const isGitProject = createMemo(() => props.project()?.vcs === "git")
  const pinLabel = createMemo(() =>
    props.project()?.pinned ? language.t("sidebar.project.unpin") : language.t("sidebar.project.pin"),
  )

  return (
    <DropdownMenu
      modal={props.sidebarHovering ? !props.sidebarHovering() : true}
      open={state.open}
      onOpenChange={(open) => setState("open", open)}
    >
      <Tooltip value={language.t("common.moreOptions")} placement="top">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          data-action={props.triggerDataAction}
          data-project={props.triggerDataProject}
          class={`shrink-0 rounded-lg transition-opacity data-[expanded]:bg-surface-base-active ${props.triggerClass ?? ""}`}
          classList={{
            "opacity-100 pointer-events-auto": state.open || !props.hoverOnly,
            "opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto group-focus-within/project:opacity-100 group-focus-within/project:pointer-events-auto data-[expanded]:opacity-100 data-[expanded]:pointer-events-auto":
              !state.open && !!props.hoverOnly,
          }}
          aria-label={language.t("common.moreOptions")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          onCloseAutoFocus={(event) => {
            if (!state.pendingRename) return
            const project = props.project()
            if (!project) return
            event.preventDefault()
            setState("pendingRename", false)
            props.onRequestRename(project)
          }}
        >
          <ProjectMenuItem
            icon="pin"
            label={pinLabel()}
            onSelect={() => {
              const project = props.project()
              if (!project) return
              props.onTogglePin(project)
            }}
          />
          <Show when={canOpenDirectory()}>
            <ProjectMenuItem
              icon="open-file"
              label={openDirectoryLabel()}
              onSelect={() => {
                const project = props.project()
                if (!project) return
                props.onOpenDirectory(project)
              }}
            />
          </Show>
          <Show when={isGitProject()}>
            <ProjectMenuItem
              icon="branch"
              label={language.t("sidebar.project.createPermanentWorktree")}
              onSelect={() => {
                const project = props.project()
                if (!project) return
                props.onCreateWorktree(project)
              }}
            />
          </Show>
          <ProjectMenuItem
            icon="edit-small-2"
            label={language.t("common.rename")}
            onSelect={() => {
              setState("pendingRename", true)
              setState("open", false)
            }}
          />
          <ProjectMenuItem
            icon="archive"
            label={language.t("sidebar.project.archiveChats")}
            onSelect={() => {
              const project = props.project()
              if (!project) return
              props.onArchiveChats(project)
            }}
          />
          <DropdownMenu.Separator />
          <ProjectMenuItem
            icon="close"
            label={language.t("sidebar.project.remove")}
            onSelect={() => {
              const project = props.project()
              if (!project) return
              props.onRemove(project)
            }}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
