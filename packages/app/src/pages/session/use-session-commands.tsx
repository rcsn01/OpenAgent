import { useNavigate } from "@solidjs/router"
import { formatTranscript, type TranscriptOptions } from "@opencode-ai/ui/contracts/transcript"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@opencode-ai/ui/toast"
import { findLast } from "@opencode-ai/ui/utils/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@opencode-ai/ui/contracts"
import { useSessionLayout } from "@/pages/session/session-layout"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const local = useLocal()
  const permission = usePermission()
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const navigate = useNavigate()
  const { params, tabs, view, href } = useSessionLayout()

  const info = () => {
    const id = params.id
    if (!id) return
    return sync.session.get(id)
  }
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  const shown = () =>
    platform.platform !== "desktop" ||
    import.meta.env.VITE_OPENCODE_CHANNEL !== "beta" ||
    settings.general.showFileTree()

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync.data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    return userMessages().filter((m) => m.id < revert)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk.directory)
    return permission.isAutoAcceptingDirectory(sdk.directory)
  }
  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.pointerEvents = "none"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: language.t("toast.session.share.copyFailed.title"),
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const url = await sdk.client.session
      .share({ sessionID })
      .then((res) => res.data?.share?.url)
      .catch(() => undefined)
    if (!url) {
      showToast({
        title: language.t("toast.session.share.failed.title"),
        description: language.t("toast.session.share.failed.description"),
        variant: "error",
      })
      return
    }

    await copyShare(url, false)
  }

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return

    await sdk.client.session
      .unshare({ sessionID })
      .then(() =>
        showToast({
          title: language.t("toast.session.unshare.success.title"),
          description: language.t("toast.session.unshare.success.description"),
          variant: "success",
        }),
      )
      .catch(() =>
        showToast({
          title: language.t("toast.session.unshare.failed.title"),
          description: language.t("toast.session.unshare.failed.description"),
          variant: "error",
        }),
      )
  }

  const openRename = () => {
    const sessionID = params.id
    if (!sessionID) return
    void import("@/components/dialog-session-rename").then((x) => {
      dialog.show(() => <x.DialogSessionRename sessionID={sessionID} />)
    })
  }

  const openTimeline = () => {
    const sessionID = params.id
    if (!sessionID) return
    void import("@/components/dialog-session-timeline").then((x) => {
      dialog.show(() => (
        <x.DialogSessionTimeline
          sessionID={sessionID}
          onSelect={(message) => {
            setActiveMessage(message)
            navigate(`${href(sessionID)}#message-${message.id}`)
          }}
        />
      ))
    })
  }

  const openFile = () => {
    void import("@/components/dialog-select-file").then((x) => {
      dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />)
    })
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new()
    view().terminal.open()
  }

  const chooseModel = () => {
    void import("@/components/dialog-select-model").then((x) => {
      dialog.show(() => <x.DialogSelectModel model={local.model} />)
    })
  }

  const chooseMcp = () => {
    void import("@/components/dialog-select-mcp").then((x) => {
      dialog.show(() => <x.DialogSelectMcp />)
    })
  }

  const chooseAgent = () => {
    void import("@/components/dialog-select-agent").then((x) => {
      dialog.show(() => <x.DialogSelectAgent />)
    })
  }

  const chooseVariant = () => {
    void import("@/components/dialog-select-variant").then((x) => {
      dialog.show(() => <x.DialogSelectVariant />)
    })
  }

  const toggleAutoAccept = () => {
    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, sdk.directory)
    else permission.toggleAutoAcceptDirectory(sdk.directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, sdk.directory)
      : permission.isAutoAcceptingDirectory(sdk.directory)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    if (sync.data.session_working(params.id ?? "")) {
      await sdk.client.session.abort({ sessionID }).catch(() => {})
    }

    const revert = info()?.revert?.messageID
    const message = findLast(userMessages(), (x) => !revert || x.id < revert)
    if (!message) return

    await sdk.client.session.revert({ sessionID, messageID: message.id })
    const parts = sync.data.part[message.id]
    if (parts) {
      const restored = extractPromptFromParts(parts, { directory: sdk.directory })
      prompt.set(restored)
    }

    const prev = findLast(userMessages(), (x) => x.id < message.id)
    setActiveMessage(prev)
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const next = userMessages().find((x) => x.id > revertMessageID)
    if (!next) {
      await sdk.client.session.unrevert({ sessionID })
      prompt.reset()
      const last = findLast(userMessages(), (x) => x.id >= revertMessageID)
      setActiveMessage(last)
      return
    }

    await sdk.client.session.revert({ sessionID, messageID: next.id })
    const prev = findLast(userMessages(), (x) => x.id < next.id)
    setActiveMessage(prev)
  }

  const compact = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.none.title"),
        description: language.t("toast.model.none.description"),
      })
      return
    }

    await sdk.client.session.summarize({
      sessionID,
      modelID: model.id,
      providerID: model.provider.id,
    })
  }

  const fork = () => {
    void import("@/components/dialog-fork").then((x) => {
      dialog.show(() => <x.DialogFork />)
    })
  }

  const openSessionGraphs = () => {
    const sessionID = params.id
    if (!sessionID) return
    view().subagents.open()
  }

  const transcriptOptions = (overrides?: Partial<TranscriptOptions>) => ({
    thinking: settings.general.showReasoningSummaries(),
    toolDetails: settings.general.shellToolPartsExpanded() || settings.general.editToolPartsExpanded(),
    assistantMetadata: true,
    providers: sync.data.provider.all,
    ...overrides,
  })

  const sessionTranscript = (overrides?: Partial<TranscriptOptions>) => {
    const sessionID = params.id
    if (!sessionID) return
    const session = info()
    if (!session) return
    return formatTranscript(
      session,
      messages().map((message) => ({
        info: message,
        parts: sync.data.part[message.id] ?? [],
      })),
      transcriptOptions(overrides),
    )
  }

  const transcriptFilename = () => {
    const session = info()
    const raw = session?.title || `session-${params.id?.slice(0, 8) ?? "transcript"}`
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    return `${slug || `session-${params.id?.slice(0, 8) ?? "transcript"}`}.md`
  }

  const saveTranscript = async (filename: string, content: string) => {
    if (platform.platform === "desktop" && platform.saveFilePickerDialog && platform.writeTextFile) {
      const path = await platform.saveFilePickerDialog({
        title: "Export transcript",
        defaultPath: filename,
      })
      if (!path) return false
      await platform.writeTextFile(path, content)
      return true
    }

    if (typeof document === "undefined" || typeof URL === "undefined") return false
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = filename
    link.style.display = "none"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(href)
    return true
  }

  const copyTranscript = async () => {
    const transcript = sessionTranscript()
    if (!transcript) return
    if (!(await write(transcript))) {
      showToast({
        title: "Failed to copy session transcript",
        variant: "error",
      })
      return
    }
    showToast({
      title: "Session transcript copied",
      variant: "success",
    })
  }

  const exportTranscript = () => {
    const defaults = transcriptOptions()
    void import("@/components/dialog-session-export").then((x) => {
      dialog.show(() => (
        <x.DialogSessionExport
          defaultFilename={transcriptFilename()}
          defaults={{
            thinking: defaults.thinking,
            toolDetails: defaults.toolDetails,
            assistantMetadata: defaults.assistantMetadata,
          }}
          onCopy={async (options) => {
            const transcript = sessionTranscript(options)
            if (!transcript) return
            if (!(await write(transcript))) {
              showToast({
                title: "Failed to copy session transcript",
                variant: "error",
              })
              return
            }
            showToast({
              title: "Session transcript copied",
              variant: "success",
            })
          }}
          onExport={async (options) => {
            const transcript = sessionTranscript(options)
            if (!transcript) return
            if (!(await saveTranscript(options.filename, transcript))) {
              showToast({
                title: "Failed to export session transcript",
                variant: "error",
              })
              return
            }
            showToast({
              title: "Session transcript exported",
              variant: "success",
            })
          }}
        />
      ))
    })
  }

  const toggleThinking = () => {
    const next = !settings.general.showReasoningSummaries()
    settings.general.setShowReasoningSummaries(next)
    showToast({
      title: next ? "Thinking shown" : "Thinking hidden",
    })
  }

  const toggleTimestamps = () => {
    const next = !settings.general.showMessageTimestamps()
    settings.general.setShowMessageTimestamps(next)
    showToast({
      title: next ? "Timestamps shown" : "Timestamps hidden",
    })
  }

  const toggleToolDetails = () => {
    const next = !(settings.general.shellToolPartsExpanded() || settings.general.editToolPartsExpanded())
    settings.general.setShellToolPartsExpanded(next)
    settings.general.setEditToolPartsExpanded(next)
    showToast({
      title: next ? "Tool details shown" : "Tool details hidden",
    })
  }

  const shareCmds = () => {
    if (sync.data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: info()?.share?.url ? language.t("session.share.copy.copyLink") : language.t("command.session.share"),
        description: info()?.share?.url
          ? language.t("toast.session.share.success.description")
          : language.t("command.session.share.description"),
        slash: { name: "share" },
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "session.unshare",
        title: language.t("command.session.unshare"),
        description: language.t("command.session.unshare.description"),
        slash: { name: "unshare" },
        disabled: !params.id || !info()?.share?.url,
        onSelect: unshare,
      }),
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: { name: "new", aliases: ["clear"] },
      onSelect: () => navigate(href()),
    }),
    sessionCommand({
      id: "session.rename",
      title: "Rename session",
      slash: { name: "rename" },
      disabled: !params.id,
      onSelect: openRename,
    }),
    sessionCommand({
      id: "session.timeline",
      title: "Jump to message",
      slash: { name: "timeline" },
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: openTimeline,
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: { name: "undo" },
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: { name: "redo" },
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: { name: "compact", aliases: ["summarize"] },
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.copy",
      title: "Copy session transcript",
      slash: { name: "copy" },
      disabled: !params.id || messages().length === 0,
      onSelect: () => void copyTranscript(),
    }),
    sessionCommand({
      id: "session.export",
      title: "Export session transcript",
      slash: { name: "export" },
      disabled: !params.id || messages().length === 0,
      onSelect: exportTranscript,
    }),
    sessionCommand({
      id: "session.graphs",
      title: language.t("command.subagents.toggle"),
      disabled: !params.id,
      onSelect: openSessionGraphs,
    }),
    sessionCommand({
      id: "session.thinking",
      title: settings.general.showReasoningSummaries() ? "Hide thinking" : "Show thinking",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      onSelect: toggleThinking,
    }),
    sessionCommand({
      id: "session.timestamps",
      title: settings.general.showMessageTimestamps() ? "Hide timestamps" : "Show timestamps",
      slash: { name: "timestamps", aliases: ["toggle-timestamps"] },
      onSelect: toggleTimestamps,
    }),
    sessionCommand({
      id: "session.tool-details",
      title:
        settings.general.shellToolPartsExpanded() || settings.general.editToolPartsExpanded()
          ? "Hide tool details"
          : "Show tool details",
      onSelect: toggleToolDetails,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: { name: "fork" },
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
  ]

  const fileCmds = () => [
    fileCommand({
      id: "file.open",
      title: language.t("command.file.open"),
      description: language.t("palette.search.placeholder"),
      keybind: "mod+k,mod+p",
      slash: { name: "open" },
      onSelect: openFile,
    }),
    fileCommand({
      id: "tab.close",
      title: language.t("command.tab.close"),
      keybind: "mod+w",
      disabled: !closableTab(),
      onSelect: closeTab,
    }),
  ]

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: { name: "terminal" },
      onSelect: () => view().terminal.toggle(),
    }),
    viewCommand({
      id: "extensions.toggle",
      title: "Toggle extensions",
      keybind: "mod+shift+e",
      onSelect: () => view().extensions.toggle(),
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => view().reviewPanel.toggle(),
    }),
    viewCommand({
      id: "context.toggle",
      title: language.t("command.context.toggle"),
      disabled: !params.id,
      onSelect: () => view().context.toggle(),
    }),
    viewCommand({
      id: "subagents.toggle",
      title: language.t("command.subagents.toggle"),
      disabled: !params.id,
      onSelect: () => view().subagents.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            disabled: !view().reviewPanel.opened(),
            onSelect: () => {
              if (!view().reviewPanel.opened()) return
              layout.fileTree.toggle()
            },
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const modelCmds = () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: { name: "models", aliases: ["model"] },
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.variant.choose",
      title: "Select variant",
      slash: { name: "variants" },
      onSelect: chooseVariant,
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => local.model.variant.cycle(),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: { name: "mcps", aliases: ["mcp"] },
      onSelect: chooseMcp,
    }),
  ]

  const agentCmds = () => [
    agentCommand({
      id: "agent.choose",
      title: "Select agent",
      slash: { name: "agents", aliases: ["agent"] },
      onSelect: chooseAgent,
    }),
    agentCommand({
      id: "agent.cycle",
      title: language.t("command.agent.cycle"),
      description: language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      onSelect: () => local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: language.t("command.agent.cycle.reverse"),
      description: language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      onSelect: () => local.agent.move(-1),
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...modelCmds(),
    ...mcpCmds(),
    ...agentCmds(),
    ...permissionsCmds(),
  ])
}
