import { Popover as KobaltePopover } from "@kobalte/core/popover"
import type { Message as MessageType, Part } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"
import { sessionTitle } from "@/utils/session-title"

const emptyMessages: MessageType[] = []

const taskDescription = (part: Part, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

export function SessionTitleControl() {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const platform = usePlatform()
  const sdk = useSDK()
  const sync = useSync()
  const { params, sessionKey, href } = useSessionKey()
  const view = createMemo(() => layout.view(sessionKey))

  const sessionID = createMemo(() => params.id)
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const hasSessionFamily = createMemo(() => {
    const id = sessionID()
    if (!id) return false
    if (parentID()) return true
    return sync.data.session.some((item) => item.parentID === id)
  })
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync.session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => sync.data.part[message.id] ?? [])
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!sessionID()) return language.t("session.new.title")
    if (!parentID()) return titleLabel() ?? language.t("command.session.new")
    if (childTaskDescription()) return childTaskDescription()
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  const [menuButton, setMenuButton] = createSignal<HTMLButtonElement>()
  let titleRef: HTMLInputElement | undefined

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.share({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.unshare({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk.client.session.update({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  const navigateAfterSessionRemoval = (removedSessionID: string, removedParentID?: string, nextSessionID?: string) => {
    if (params.id !== removedSessionID) return
    if (removedParentID) {
      navigate(href(removedParentID))
      return
    }
    if (nextSessionID) {
      navigate(href(nextSessionID))
      return
    }
    navigate(href())
  }

  const archiveSession = async (id: string) => {
    const session = sync.session.get(id)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === id)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID: id, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === id)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(id, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (id: string) => {
    const session = sync.session.get(id)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === id)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID: id })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([id])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [id]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(id, session.parentID, nextSession?.id)
    return true
  }

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const shareSession = () => {
    const id = sessionID()
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    navigate(href(id))
  }

  const openSessionGraphs = () => {
    const id = sessionID()
    if (!id) return
    view().subagents.open()
  }

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync.data.message[id] !== undefined) return
        void sync.session.sync(id)
      },
      { defer: true },
    ),
  )

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const handleDelete = async () => {
      await deleteSession(props.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <div class="hidden md:flex max-w-[min(46vw,620px)] min-w-0 items-center justify-center gap-1 text-center">
      <Show when={parentID()}>
        <button
          type="button"
          class="min-w-0 max-w-[34%] truncate text-13-medium text-text-weak transition-colors hover:text-text-base"
          onClick={navigateParent}
        >
          {parentTitle()}
        </button>
        <span class="px-1 text-13-medium text-text-weak" aria-hidden="true">
          /
        </span>
      </Show>
      <Show
        when={title.editing}
        fallback={<span class="min-w-0 truncate text-13-medium text-text-strong">{childTitle()}</span>}
      >
        <InlineInput
          ref={(el) => {
            titleRef = el
          }}
          value={title.draft}
          disabled={titleMutation.isPending}
          class="min-w-36 max-w-[320px] text-13-medium text-text-strong rounded-[6px] px-1"
          style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
          onInput={(event) => setTitle("draft", event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "Enter") {
              event.preventDefault()
              void saveTitleEditor()
              return
            }
            if (event.key === "Escape") {
              event.preventDefault()
              closeTitleEditor()
            }
          }}
          onBlur={closeTitleEditor}
        />
      </Show>
      <Show when={sessionID()} keyed>
        {(id) => (
          <div class="shrink-0 flex items-center gap-1 pl-1">
            <Show when={!parentID()}>
              <DropdownMenu
                gutter={4}
                placement="bottom"
                open={title.menuOpen}
                onOpenChange={(open) => setTitle("menuOpen", open)}
              >
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  class="titlebar-icon w-7 h-6 p-0 box-border data-[expanded]:bg-surface-base-active"
                  classList={{
                    "bg-surface-base-active": share.open || title.pendingShare,
                  }}
                  aria-label={language.t("common.moreOptions")}
                  aria-expanded={title.menuOpen || share.open || title.pendingShare}
                  ref={setMenuButton}
                />
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    style={{ "min-width": "104px" }}
                    onCloseAutoFocus={(event) => {
                      if (title.pendingRename) {
                        event.preventDefault()
                        setTitle("pendingRename", false)
                        openTitleEditor()
                        return
                      }
                      if (title.pendingShare) {
                        event.preventDefault()
                        requestAnimationFrame(() => {
                          setShare({ open: true, dismiss: null })
                          setTitle("pendingShare", false)
                        })
                      }
                    }}
                  >
                    <DropdownMenu.Item
                      onSelect={() => {
                        setTitle("pendingRename", true)
                        setTitle("menuOpen", false)
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <Show when={shareEnabled()}>
                      <DropdownMenu.Item
                        onSelect={() => {
                          setTitle({ pendingShare: true, menuOpen: false })
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </Show>
                    <DropdownMenu.Item onSelect={() => void archiveSession(id)}>
                      <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} />)}>
                      <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>

              <KobaltePopover
                open={share.open}
                anchorRef={() => menuButton()}
                placement="bottom"
                gutter={4}
                modal={false}
                onOpenChange={(open) => {
                  if (open) setShare("dismiss", null)
                  setShare("open", open)
                }}
              >
                <KobaltePopover.Portal>
                  <KobaltePopover.Content
                    data-component="popover-content"
                    style={{ "min-width": "320px" }}
                    onEscapeKeyDown={(event) => {
                      setShare({ dismiss: "escape", open: false })
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onPointerDownOutside={() => {
                      setShare({ dismiss: "outside", open: false })
                    }}
                    onFocusOutside={() => {
                      setShare({ dismiss: "outside", open: false })
                    }}
                    onCloseAutoFocus={(event) => {
                      if (share.dismiss === "outside") event.preventDefault()
                      setShare("dismiss", null)
                    }}
                  >
                    <div class="flex flex-col p-3">
                      <div class="flex flex-col gap-1">
                        <div class="text-13-medium text-text-strong">
                          {language.t("session.share.popover.title")}
                        </div>
                        <div class="text-12-regular text-text-weak">
                          {shareUrl()
                            ? language.t("session.share.popover.description.shared")
                            : language.t("session.share.popover.description.unshared")}
                        </div>
                      </div>
                      <div class="mt-3 flex flex-col gap-2">
                        <Show
                          when={shareUrl()}
                          fallback={
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={shareSession}
                              disabled={shareMutation.isPending}
                            >
                              {shareMutation.isPending
                                ? language.t("session.share.action.publishing")
                                : language.t("session.share.action.publish")}
                            </Button>
                          }
                        >
                          <div class="flex flex-col gap-2">
                            <TextField
                              value={shareUrl() ?? ""}
                              readOnly
                              copyable
                              copyKind="link"
                              tabIndex={-1}
                              class="w-full"
                            />
                            <div class="grid grid-cols-2 gap-2">
                              <Button
                                size="large"
                                variant="secondary"
                                class="w-full shadow-none border border-border-weak-base"
                                onClick={unshareSession}
                                disabled={unshareMutation.isPending}
                              >
                                {unshareMutation.isPending
                                  ? language.t("session.share.action.unpublishing")
                                  : language.t("session.share.action.unpublish")}
                              </Button>
                              <Button
                                size="large"
                                variant="primary"
                                class="w-full"
                                onClick={viewShare}
                                disabled={unshareMutation.isPending}
                              >
                                {language.t("session.share.action.view")}
                              </Button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </KobaltePopover.Content>
                </KobaltePopover.Portal>
              </KobaltePopover>
            </Show>
            <Show when={hasSessionFamily()}>
              <IconButton
                icon="branch"
                variant="ghost"
                class="titlebar-icon w-7 h-6 p-0 box-border"
                aria-label="Open subagent graphs"
                onClick={openSessionGraphs}
              />
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
