import { Match, Switch, createEffect, createMemo, createSignal, onCleanup, Show, Index } from "solid-js"
import { Virtualizer, type VirtualizerHandle } from "virtua/solid"
import { Button } from "@openagent-ai/ui/button"
import { FileIcon } from "@openagent-ai/ui/file-icon"
import { Icon } from "@openagent-ai/ui/icon"
import { SessionTurn } from "@openagent-ai/ui/session-turn"
import { ScrollView } from "@openagent-ai/ui/scroll-view"
import type { AssistantMessage, Message as MessageType, Part, TextPart, UserMessage } from "@openagent-ai/sdk/v2"
import { Binary } from "@openagent-ai/core/util/binary"
import { getFilename } from "@openagent-ai/core/util/path"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useLanguage } from "@/context/language"
import { useSessionKey } from "@/pages/session/session-layout"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { createMessageTimelineRows, type MessageTimelineRow } from "./message-timeline.data"

type MessageComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

const emptyMessages: MessageType[] = []
const idle = { type: "idle" as const }
type UserActions = {
  fork?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
  revert?: (input: { sessionID: string; messageID: string }) => Promise<void> | void
}

const messageComments = (parts: Part[]): MessageComment[] =>
  parts.flatMap((part) => {
    if (part.type !== "text" || !(part as TextPart).synthetic) return []
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return []
    return [
      {
        path: next.path,
        comment: next.comment,
        selection: next.selection
          ? {
              startLine: next.selection.startLine,
              endLine: next.selection.endLine,
            }
          : undefined,
      },
    ]
  })

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

export function MessageTimeline(props: {
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  historyMore: boolean
  historyLoading: boolean
  historyShift: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  setRevealMessage: (fn: ((id: string) => boolean) | undefined) => void
  anchor: (id: string) => string
}) {
  let touchGesture: number | undefined

  const sync = useSync()
  const settings = useSettings()
  const language = useLanguage()
  const { params } = useSessionKey()

  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>()
  let virtualizer: VirtualizerHandle | undefined

  const rows = createMemo<readonly MessageTimelineRow[]>(
    (previous) =>
      createMessageTimelineRows({
        messages: props.renderedUserMessages,
        historyMore: props.historyMore,
        previous,
      }),
    [],
  )
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const pending = createMemo(() =>
    sessionMessages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    ),
  )
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })

  const activeMessageID = createMemo(() => {
    const parentID = pending()?.parentID
    if (parentID) {
      const messages = sessionMessages()
      const result = Binary.search(messages, parentID, (message) => message.id)
      const message = result.found ? messages[result.index] : messages.find((item) => item.id === parentID)
      if (message && message.role === "user") return message.id
    }

    const status = sessionStatus()
    if (status.type !== "idle") {
      const messages = sessionMessages()
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i].id
      }
    }

    return undefined
  })

  const revealMessage = (id: string) => {
    const index = rows().findIndex((row) => row.type === "message" && row.messageID === id)
    if (index === -1) return false
    virtualizer?.scrollToIndex(index, { align: "start" })
    return true
  }

  createEffect(() => {
    props.setRevealMessage(revealMessage)
  })
  onCleanup(() => props.setRevealMessage(undefined))

  return (
    <div class="relative w-full h-full min-w-0">
      <div
        class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
        classList={{
          "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
          "opacity-0 translate-y-2 scale-95 pointer-events-none":
            !props.scroll.overflow || !props.scroll.jump,
        }}
      >
        <button
          class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
          onClick={props.onResumeScroll}
        >
          <div
            class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
            style={{
              "box-shadow":
                "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
            }}
          >
            <Icon name="arrow-down-to-line" size="small" />
          </div>
        </button>
      </div>
      <ScrollView
        viewportRef={(el) => {
          setScrollElement(el)
          props.setScrollRef(el)
        }}
        onWheel={(e) => {
          const root = e.currentTarget
          const delta = normalizeWheelDelta({
            deltaY: e.deltaY,
            deltaMode: e.deltaMode,
            rootHeight: root.clientHeight,
          })
          if (!delta) return
          markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
        }}
        onTouchStart={(e) => {
          touchGesture = e.touches[0]?.clientY
        }}
        onTouchMove={(e) => {
          const next = e.touches[0]?.clientY
          const prev = touchGesture
          touchGesture = next
          if (next === undefined || prev === undefined) return

          const delta = prev - next
          if (!delta) return

          const root = e.currentTarget
          markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
        }}
        onTouchEnd={() => {
          touchGesture = undefined
        }}
        onTouchCancel={() => {
          touchGesture = undefined
        }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return
          props.onMarkScrollGesture(e.currentTarget)
        }}
        onScroll={(e) => {
          props.onScheduleScrollState(e.currentTarget)
          props.onTurnBackfillScroll()
          if (!props.hasScrollGesture()) return
          props.onUserScroll()
          props.onAutoScrollHandleScroll()
          props.onMarkScrollGesture(e.currentTarget)
        }}
        onClick={props.onAutoScrollInteraction}
        class="relative min-w-0 w-full h-full"
      >
        <div
          ref={props.setContentRef}
          role="log"
          data-slot="session-turn-list"
          class="min-w-0 w-full pb-16 transition-[margin]"
          classList={{
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
            "mt-0.5": props.centered,
            "mt-0": !props.centered,
          }}
        >
          <div
            class="min-w-0 w-full"
            classList={{
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
            }}
          >
            <Show when={scrollElement()}>
              {(root) => (
                <Virtualizer
                  ref={(handle) => {
                    virtualizer = handle
                  }}
                  data={rows()}
                  scrollRef={root()}
                  shift={props.historyShift}
                  bufferSize={800}
                  itemSize={500}
                >
                  {(row) => (
                    <Switch>
                      <Match when={row.type === "load-earlier"}>
                        <div class="w-full flex justify-center">
                          <Button
                            variant="ghost"
                            size="large"
                            class="text-12-medium opacity-50"
                            disabled={props.historyLoading}
                            onClick={props.onLoadEarlier}
                          >
                            {props.historyLoading
                              ? language.t("session.messages.loadingEarlier")
                              : language.t("session.messages.loadEarlier")}
                          </Button>
                        </div>
                      </Match>
                      <Match when={row.type === "message" ? row : undefined}>
                        {(messageRow) => {
                          const messageID = messageRow().messageID
                          const active = createMemo(() => activeMessageID() === messageID)
                          const message = createMemo(() => sessionMessages().find((item) => item.id === messageID))
                          const comments = createMemo(() => messageComments(sync.data.part[messageID] ?? []), [], {
                            equals: (a, b) =>
                              a.length === b.length &&
                              a.every(
                                (c, i) =>
                                  c.path === b[i].path &&
                                  c.comment === b[i].comment &&
                                  c.selection?.startLine === b[i].selection?.startLine &&
                                  c.selection?.endLine === b[i].selection?.endLine,
                              ),
                          })
                          const commentCount = createMemo(() => comments().length)
                          return (
                            <div
                              id={props.anchor(messageID)}
                              data-message-id={messageID}
                              data-timeline-row-key={messageRow().key}
                              classList={{
                                "min-w-0 w-full max-w-full": true,
                                "md:max-w-200 2xl:max-w-[1000px]": props.centered,
                              }}
                              style={{
                                "content-visibility": active() ? undefined : "auto",
                                "contain-intrinsic-size": active() ? undefined : "auto 500px",
                              }}
                            >
                              <Show when={commentCount() > 0}>
                                <div class="w-full px-4 md:px-5 pb-2">
                                  <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                                    <div class="flex w-max min-w-full justify-end gap-2">
                                      <Index each={comments()}>
                                        {(commentAccessor: () => MessageComment) => {
                                          const comment = createMemo(() => commentAccessor())
                                          return (
                                            <Show when={comment()}>
                                              {(c) => (
                                                <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                                                  <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                                                    <FileIcon
                                                      node={{ path: c().path, type: "file" }}
                                                      class="size-3.5 shrink-0"
                                                    />
                                                    <span class="truncate">{getFilename(c().path)}</span>
                                                    <Show when={c().selection}>
                                                      {(selection) => (
                                                        <span class="shrink-0 text-text-weak">
                                                          {selection().startLine === selection().endLine
                                                            ? `:${selection().startLine}`
                                                            : `:${selection().startLine}-${selection().endLine}`}
                                                        </span>
                                                      )}
                                                    </Show>
                                                  </div>
                                                  <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                                                    {c().comment}
                                                  </div>
                                                </div>
                                              )}
                                            </Show>
                                          )
                                        }}
                                      </Index>
                                    </div>
                                  </div>
                                </div>
                              </Show>
                              <SessionTurn
                                sessionID={sessionID() ?? ""}
                                messageID={messageID}
                                messages={sessionMessages()}
                                actions={props.actions}
                                active={active()}
                                status={active() ? sessionStatus() : undefined}
                                messageTimestamp={
                                  settings.general.showMessageTimestamps() && message()
                                    ? new Date(message()!.time.created).toLocaleString(undefined, {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      })
                                    : undefined
                                }
                                showReasoningSummaries={settings.general.showReasoningSummaries()}
                                shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                                editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                                classes={{
                                  root: "min-w-0 w-full relative",
                                  content: "flex flex-col justify-between !overflow-visible",
                                  container: "w-full px-4 md:px-5",
                                }}
                              />
                            </div>
                          )
                        }}
                      </Match>
                    </Switch>
                  )}
                </Virtualizer>
              )}
            </Show>
          </div>
        </div>
      </ScrollView>
    </div>
  )
}
