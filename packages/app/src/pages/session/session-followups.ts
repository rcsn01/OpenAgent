import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Identifier } from "@/utils/id"
import { pathKey } from "@/utils/path-key"
import { Persist, persisted } from "@/utils/persist"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { sendFollowupDraft } from "@/components/prompt-input/submit"

type FollowupItem = FollowupDraft & { id: string }
type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">
const emptyFollowups: FollowupItem[] = []
type FollowupState = {
  items: Record<string, FollowupItem[] | undefined>
  failed: Record<string, string | undefined>
  paused: Record<string, boolean | undefined>
  edit: Record<string, FollowupEdit | undefined>
}
type FollowupByWorkspace = {
  workspace: Record<string, FollowupState | undefined>
}
type FollowupValue<T> = T extends Record<string, infer V> ? V : never
const emptyFollowupState = (): FollowupState => ({
  items: {},
  failed: {},
  paused: {},
  edit: {},
})

export function followupText(item: FollowupDraft, attachmentLabel: string) {
  const text = item.prompt
    .map((part) => {
      if (part.type === "image") return `[image:${part.filename}]`
      if (part.type === "file") return `[file:${part.path}]`
      if (part.type === "agent") return `@${part.name}`
      return part.content
    })
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line)

  if (text) return text
  return `[${attachmentLabel}]`
}

export function useSessionFollowups(input: {
  directory: () => string
  sessionID: () => string | undefined
  client: () => Parameters<typeof sendFollowupDraft>[0]["client"]
  sync: () => Parameters<typeof sendFollowupDraft>[0]["sync"]
  globalSync: () => Parameters<typeof sendFollowupDraft>[0]["globalSync"]
  optimisticBusy: (draft: FollowupDraft) => boolean
  isChildSession: (sessionID: string) => boolean
  isSessionBusy: (sessionID: string) => boolean
  blocked: () => boolean
  fail: (error: unknown) => void
  resumeScroll: () => void
  attachmentLabel: () => string
}) {
  const followupWorkspaceKey = createMemo(() => pathKey(input.directory()))
  const [followupStore, setFollowupStore] = persisted(
    Persist.global("workspace-followup.v1"),
    createStore<FollowupByWorkspace>({
      workspace: {},
    }),
  )
  const followupState = createMemo(() => followupStore.workspace[followupWorkspaceKey()] ?? emptyFollowupState())
  const followup = {
    get items() {
      return followupState().items
    },
    get failed() {
      return followupState().failed
    },
    get paused() {
      return followupState().paused
    },
    get edit() {
      return followupState().edit
    },
  }
  const ensureFollowupWorkspace = () => {
    const key = followupWorkspaceKey()
    if (!followupStore.workspace[key]) setFollowupStore("workspace", key, emptyFollowupState())
    return key
  }
  const setFollowup = <K extends keyof FollowupState>(
    key: K,
    sessionID: string,
    value: FollowupValue<FollowupState[K]> | ((prev: FollowupValue<FollowupState[K]>) => FollowupValue<FollowupState[K]>),
  ) => {
    ;(setFollowupStore as (...args: unknown[]) => void)("workspace", ensureFollowupWorkspace(), key, sessionID, value)
  }

  const queued = createMemo(() => {
    const id = input.sessionID()
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editing = createMemo(() => {
    const id = input.sessionID()
    if (!id) return
    return followup.edit[id]
  })

  const mutation = useMutation(() => ({
    mutationFn: async (payload: { sessionID: string; id: string; manual?: boolean }) => {
      const item = (followup.items[payload.sessionID] ?? []).find((entry) => entry.id === payload.id)
      if (!item) return

      if (payload.manual) setFollowup("paused", payload.sessionID, undefined)
      setFollowup("failed", payload.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: input.client(),
        sync: input.sync(),
        globalSync: input.globalSync(),
        draft: item,
        optimisticBusy: input.optimisticBusy(item),
      }).catch((err) => {
        setFollowup("failed", payload.sessionID, payload.id)
        input.fail(err)
        return false
      })
      if (!ok) return

      setFollowup("items", payload.sessionID, (items) => (items ?? []).filter((entry) => entry.id !== payload.id))
      if (payload.manual) input.resumeScroll()
    },
  }))

  const busy = (sessionID: string) => mutation.isPending && mutation.variables?.sessionID === sessionID
  const sending = createMemo(() => {
    const id = input.sessionID()
    if (!id) return
    if (!busy(id)) return
    return mutation.variables?.id
  })
  const queueEnabled = createMemo(() => {
    const id = input.sessionID()
    if (!id) return false
    return input.isSessionBusy(id) && !input.blocked() && !input.isChildSession(id)
  })
  const dock = createMemo(() => queued().map((item) => ({ id: item.id, text: followupText(item, input.attachmentLabel()) })))

  const queue = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const send = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    if (input.isChildSession(sessionID)) return Promise.resolve()
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (busy(sessionID)) return Promise.resolve()

    return mutation.mutateAsync({ sessionID, id, manual: opts?.manual })
  }

  const edit = (id: string) => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    if (busy(sessionID)) return

    const item = queued().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const remove = (id: string) => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    if (busy(sessionID)) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, (value) => (value?.id === id ? undefined : value))
    const remaining = (followup.items[sessionID] ?? []).filter((entry) => entry.id !== id)
    if (remaining.length === 0) setFollowup("paused", sessionID, undefined)
  }

  const clearEdit = () => {
    const id = input.sessionID()
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const pauseAutoSend = () => {
    const id = input.sessionID()
    if (!id) return
    setFollowup("paused", id, true)
  }

  const toggleAutoSend = () => {
    const id = input.sessionID()
    if (!id) return
    setFollowup("paused", id, (value) => (value ? undefined : true))
  }

  return {
    state: followup,
    queued,
    editing,
    busy,
    sending,
    queueEnabled,
    dock,
    queue,
    send,
    edit,
    remove,
    clearEdit,
    pauseAutoSend,
    toggleAutoSend,
  }
}
