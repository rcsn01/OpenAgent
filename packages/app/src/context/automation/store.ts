import type { Session, TextPartInput } from "@opencode-ai/sdk/v2/client"
import { Binary } from "@openagent/core/util/binary"
import { createSimpleContext } from "@openagent/ui/context"
import { createEffect, onCleanup } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { Identifier } from "@/utils/id"
import { errorMessage } from "@/pages/layout/helpers"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { advanceAutomationRunAt, nextAutomationRunAt, type AutomationSchedule } from "./schedule"

export type AutomationModel = {
  providerID: string
  modelID: string
}

export type AutomationStatus = "active" | "paused"

export type AutomationRun = {
  id: string
  automationID: string
  directory: string
  sessionID?: string
  status: "running" | "succeeded" | "failed"
  startedAt: number
  completedAt?: number
  failedAt?: number
  error?: string
}

export type Automation = {
  id: string
  name: string
  prompt: string
  directory: string
  schedule: AutomationSchedule
  status: AutomationStatus
  model?: AutomationModel
  variant?: string
  lastRunAt?: number
  nextRunAt?: number
  runs: AutomationRun[]
}

export type AutomationInput = {
  name: string
  prompt: string
  directory: string
  schedule: AutomationSchedule
  status: AutomationStatus
  model?: AutomationModel
  variant?: string
}

export type AutomationState = {
  automations: Automation[]
}

const HISTORY_LIMIT = 20
const STORE_TARGET = { ...Persist.global("automations.v1"), migrate: normalizeAutomationState }

const defaultState: AutomationState = {
  automations: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function cleanStatus(value: unknown): AutomationStatus {
  return value === "paused" ? "paused" : "active"
}

function cleanSchedule(value: unknown): AutomationSchedule {
  if (!isRecord(value)) return { type: "daily", time: "09:00" }
  if (value.type === "interval") return { type: "interval", minutes: Math.max(1, Math.floor(cleanNumber(value.minutes) ?? 5)) }
  if (value.type === "weekday") return { type: "weekday", time: cleanString(value.time) || "09:00" }
  if (value.type === "weekly") {
    return {
      type: "weekly",
      day: Math.max(0, Math.min(6, Math.floor(cleanNumber(value.day) ?? 1))),
      time: cleanString(value.time) || "09:00",
    }
  }
  return { type: "daily", time: cleanString(value.time) || "09:00" }
}

function cleanModel(value: unknown): AutomationModel | undefined {
  if (!isRecord(value)) return
  const providerID = cleanString(value.providerID)
  const modelID = cleanString(value.modelID)
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

function cleanRun(value: unknown): AutomationRun | undefined {
  if (!isRecord(value)) return
  const id = cleanString(value.id)
  const automationID = cleanString(value.automationID)
  const directory = cleanString(value.directory)
  const startedAt = cleanNumber(value.startedAt)
  if (!id || !automationID || !directory || !startedAt) return
  const status = value.status === "running" || value.status === "failed" ? value.status : "succeeded"
  return {
    id,
    automationID,
    directory,
    sessionID: cleanString(value.sessionID) || undefined,
    status,
    startedAt,
    completedAt: cleanNumber(value.completedAt),
    failedAt: cleanNumber(value.failedAt),
    error: cleanString(value.error) || undefined,
  }
}

export function normalizeAutomationState(value: unknown): AutomationState {
  if (!isRecord(value)) return defaultState
  const raw = Array.isArray(value.automations) ? value.automations : []
  const automations = raw.flatMap((entry): Automation[] => {
    if (!isRecord(entry)) return []
    const id = cleanString(entry.id)
    const name = cleanString(entry.name)
    const prompt = cleanString(entry.prompt)
    const directory = cleanString(entry.directory)
    if (!id || !name || !prompt || !directory) return []
    const schedule = cleanSchedule(entry.schedule)
    const nextRunAt = cleanNumber(entry.nextRunAt) ?? nextAutomationRunAt(schedule)
    return [
      {
        id,
        name,
        prompt,
        directory,
        schedule,
        status: cleanStatus(entry.status),
        model: cleanModel(entry.model),
        variant: cleanString(entry.variant) || undefined,
        lastRunAt: cleanNumber(entry.lastRunAt),
        nextRunAt,
        runs: (Array.isArray(entry.runs) ? entry.runs : []).flatMap((run) => {
          const cleaned = cleanRun(run)
          return cleaned ? [cleaned] : []
        }).slice(0, HISTORY_LIMIT),
      },
    ]
  })
  return { automations }
}

function automationID() {
  return `atm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function runID() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function withHistory(item: Automation, run: AutomationRun) {
  return [run, ...item.runs.filter((entry) => entry.id !== run.id)].slice(0, HISTORY_LIMIT)
}

function seedSession(globalSync: ReturnType<typeof useGlobalSync>, directory: string, info: Session) {
  const [, setStore] = globalSync.child(directory)
  setStore("session", (list: Session[]) => {
    const result = Binary.search(list, info.id, (item) => item.id)
    const next = [...list]
    if (result.found) next[result.index] = info
    else next.splice(result.index, 0, info)
    return next
  })
}

export function createAutomationActions(input: {
  store: Store<AutomationState>
  setStore: SetStoreFunction<AutomationState>
  createClient: ReturnType<typeof useGlobalSDK>["createClient"]
  globalSync: ReturnType<typeof useGlobalSync>
}) {
  const running = new Set<string>()

  const find = (id: string) => input.store.automations.find((item) => item.id === id)
  const upsertRun = (automationID: string, run: AutomationRun) => {
    input.setStore(
      "automations",
      (item) => item.id === automationID,
      produce((draft) => {
        draft.runs = withHistory(draft, run)
      }),
    )
  }

  const actions = {
    create(snapshot: AutomationInput) {
      const now = Date.now()
      const item: Automation = {
        id: automationID(),
        ...snapshot,
        lastRunAt: undefined,
        nextRunAt: nextAutomationRunAt(snapshot.schedule, now),
        runs: [],
      }
      input.setStore("automations", (list) => [item, ...list])
      return item
    },
    update(id: string, patch: Partial<AutomationInput>) {
      const current = find(id)
      if (!current) return
      input.setStore(
        "automations",
        (item) => item.id === id,
        produce((draft) => {
          if (patch.name !== undefined) draft.name = patch.name
          if (patch.prompt !== undefined) draft.prompt = patch.prompt
          if (patch.directory !== undefined) draft.directory = patch.directory
          if (patch.status !== undefined) draft.status = patch.status
          if (patch.model !== undefined) draft.model = patch.model
          if (patch.variant !== undefined) draft.variant = patch.variant
          if (patch.schedule !== undefined) {
            draft.schedule = patch.schedule
            draft.nextRunAt = nextAutomationRunAt(patch.schedule)
          }
        }),
      )
      return find(id)
    },
    delete(id: string) {
      input.setStore("automations", (list) => list.filter((item) => item.id !== id))
    },
    async run(id: string) {
      const item = find(id)
      if (!item) throw new Error("Automation not found")
      if (running.has(id)) return item.runs.find((run) => run.status === "running")

      running.add(id)
      const startedAt = Date.now()
      const run: AutomationRun = {
        id: runID(),
        automationID: item.id,
        directory: item.directory,
        status: "running",
        startedAt,
      }
      upsertRun(id, run)

      let sessionID: string | undefined
      try {
        const client = input.createClient({ directory: item.directory, throwOnError: true })
        const created = await client.session.create({ title: `[Automation] ${item.name}` }).then((x) => x.data)
        if (!created) throw new Error("Session was not created")
        sessionID = created.id

        seedSession(input.globalSync, item.directory, created as Session)
        const part: TextPartInput & { id: string } = {
          id: Identifier.ascending("part"),
          type: "text",
          text: item.prompt,
        }
        await client.session.promptAsync({
          sessionID: created.id,
          model: item.model,
          variant: item.variant,
          parts: [part],
        })

        const completedAt = Date.now()
        const succeeded: AutomationRun = {
          ...run,
          status: "succeeded",
          sessionID: created.id,
          completedAt,
        }
        input.setStore(
          "automations",
          (entry) => entry.id === id,
          produce((draft) => {
            draft.lastRunAt = completedAt
            draft.nextRunAt = advanceAutomationRunAt(draft.schedule, draft.nextRunAt ?? startedAt, completedAt)
            draft.runs = withHistory(draft, succeeded)
          }),
        )
        return succeeded
      } catch (err) {
        const failedAt = Date.now()
        const failed: AutomationRun = {
          ...run,
          status: "failed",
          sessionID,
          failedAt,
          error: errorMessage(err, "Automation run failed"),
        }
        input.setStore(
          "automations",
          (entry) => entry.id === id,
          produce((draft) => {
            draft.lastRunAt = failedAt
            draft.nextRunAt = advanceAutomationRunAt(draft.schedule, draft.nextRunAt ?? startedAt, failedAt)
            draft.runs = withHistory(draft, failed)
          }),
        )
        throw err
      } finally {
        running.delete(id)
      }
    },
    runDue(now = Date.now()) {
      const due = input.store.automations.filter(
        (item) => item.status === "active" && (item.nextRunAt ?? 0) <= now && !running.has(item.id),
      )
      for (const item of due) void actions.run(item.id).catch(() => undefined)
    },
    running(id: string) {
      return running.has(id)
    },
  }

  return actions
}

export const { use: useAutomations, provider: AutomationsProvider } = createSimpleContext({
  name: "Automations",
  init: () => {
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()
    const [store, setStore, , ready] = persisted(STORE_TARGET, createStore(defaultState))
    const actions = createAutomationActions({
      store,
      setStore,
      createClient: globalSDK.createClient,
      globalSync,
    })

    let interval: ReturnType<typeof setInterval> | undefined
    createEffect(() => {
      if (!ready()) return
      actions.runDue()
      if (interval !== undefined) return
      interval = setInterval(() => actions.runDue(), 60_000)
    })

    onCleanup(() => {
      if (interval !== undefined) clearInterval(interval)
    })

    return {
      store,
      ready,
      list: () => store.automations,
      actions,
      runs(id: string) {
        return store.automations.find((item) => item.id === id)?.runs ?? []
      },
    }
  },
})
