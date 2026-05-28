import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Dialog } from "@openagent-ai/ui/dialog"
import { Button } from "@openagent-ai/ui/button"
import { FilterDropdown, type FilterDropdownOption } from "@openagent-ai/ui/filter-dropdown"
import { Icon } from "@openagent-ai/ui/icon"
import { Popover } from "@openagent-ai/ui/popover"
import { showToast } from "@openagent-ai/ui/toast"
import { useDialog } from "@openagent-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { type LocalProject } from "@/context/layout"
import { useModels } from "@/context/models"
import { displayName, errorMessage } from "@/pages/layout/helpers"
import type { AutomationListResponse } from "@openagent-ai/sdk/v2/client"

type Automation = AutomationListResponse[number]
type Schedule = Automation["schedule"]
type ScheduleKind = "minute" | "hourly" | "daily" | "weekday" | "weekly"
type AutomationModel = NonNullable<Automation["model"]>
type AutomationStatusFilter = "current" | "active" | "paused"
const DEFAULT_AUTOMATION_PARALLEL_LIMIT = 10
const MIN_AUTOMATION_PARALLEL_LIMIT = 1
const MAX_AUTOMATION_PARALLEL_LIMIT = 20
const AUTOMATION_STATUS_FILTER_OPTIONS: FilterDropdownOption<AutomationStatusFilter>[] = [
  { value: "current", label: "Current" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
]

type SaveSnapshot = {
  requestID: number
  editing?: Automation
  name: string
  prompt: string
  directory: string
  schedule: Schedule
  status: Automation["status"]
  model?: Automation["model"]
  variant?: string
}

function formatTime(value?: number) {
  if (!value) return "Never"
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function compactRelativeTime(value?: number) {
  if (!value) return ""
  const diff = Math.max(0, Date.now() - value)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function encodeModel(value?: AutomationModel) {
  return value ? JSON.stringify(value) : ""
}

function decodeModel(value: string): AutomationModel | undefined {
  if (!value) return
  try {
    const parsed = JSON.parse(value) as Partial<AutomationModel>
    if (parsed.providerID && parsed.modelID) return { providerID: parsed.providerID, modelID: parsed.modelID }
  } catch {
    return
  }
}

export function DialogAutomations(props: {
  projects: LocalProject[]
  currentDir?: string
  automationID?: string
  embedded?: boolean
  onOpenAutomations?: (input?: { replace?: boolean }) => void
  onOpenAutomation?: (input: { directory: string; id: string }) => void
  onOpenSession: (input: { directory: string; id: string }) => void
}) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const sync = useGlobalSync()
  const models = useModels()
  const queryClient = useQueryClient()
  const firstProject = () => props.projects[0]
  const initialDirectory = () => props.currentDir || firstProject()?.worktree || ""
  const [draftDirectory, setDraftDirectory] = createSignal(initialDirectory())
  const apiDirectory = createMemo(() => initialDirectory())
  const client = createMemo(() => globalSDK.createClient({ directory: apiDirectory(), throwOnError: true }))
  const key = () => ["automation"]

  const [mode, setMode] = createSignal<"list" | "editor">("list")
  const [editing, setEditing] = createSignal<Automation | undefined>()
  const [name, setName] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [status, setStatus] = createSignal<"active" | "paused">("active")
  const [scheduleKind, setScheduleKind] = createSignal<ScheduleKind>("daily")
  const [time, setTime] = createSignal("09:00")
  const [day, setDay] = createSignal("1")
  const [minutes, setMinutes] = createSignal("5")
  const [model, setModel] = createSignal<Automation["model"]>()
  const [variant, setVariant] = createSignal<string | undefined>()
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [automationStatusFilter, setAutomationStatusFilter] = createSignal<AutomationStatusFilter>("current")
  const [parallelLimitDraft, setParallelLimitDraft] = createSignal(String(DEFAULT_AUTOMATION_PARALLEL_LIMIT))
  let saveRequestID = 0
  let queuedSave = false
  let creatingAutomation = false
  let projectSelect: HTMLSelectElement | undefined

  const automations = useQuery(() => ({
    queryKey: key(),
    queryFn: () => client().automation.list().then((x) => x.data ?? []),
    enabled: !!apiDirectory(),
  }))

  const runs = useQuery(() => ({
    queryKey: [editing()?.id, "automation", "runs"],
    queryFn: () => {
      const current = editing()
      if (!current) return []
      return client()
        .automation.runs({ automationID: current.id, limit: "20" })
        .then((x) => x.data ?? [])
    },
    enabled: !!editing()?.id,
  }))

  const projectName = (worktree: string) => {
    const project = props.projects.find((item) => item.worktree === worktree)
    if (project) return displayName(project)
    return worktree.split(/[\\/]/).filter(Boolean).at(-1) ?? worktree
  }

  const automationParallelLimit = () =>
    finiteNumber(sync.data.config.automation?.parallel) ?? DEFAULT_AUTOMATION_PARALLEL_LIMIT
  const filteredAutomations = createMemo(() => {
    const filter = automationStatusFilter()
    const items = automations.data ?? []
    if (filter === "current") return items
    return items.filter((item) => item.status === filter)
  })

  const normalizeParallelLimit = (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return DEFAULT_AUTOMATION_PARALLEL_LIMIT
    return Math.max(
      MIN_AUTOMATION_PARALLEL_LIMIT,
      Math.min(MAX_AUTOMATION_PARALLEL_LIMIT, Math.floor(parsed)),
    )
  }

  const saveParallelLimit = async () => {
    const next = normalizeParallelLimit(parallelLimitDraft())
    setParallelLimitDraft(String(next))
    if (next === automationParallelLimit()) return
    try {
      await sync.updateConfig({
        ...sync.data.config,
        automation: {
          ...(sync.data.config.automation ?? {}),
          parallel: next,
        },
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Automation settings could not be saved",
        description: errorMessage(err, "Automation settings could not be saved"),
      })
    }
  }

  createEffect(() => {
    setParallelLimitDraft(String(automationParallelLimit()))
  })

  createEffect(() => {
    const select = projectSelect
    if (!select) return
    const next = draftDirectory()
    if (select.value !== next) select.value = next
  })

  const setSchedule = (schedule: Schedule) => {
    if (schedule.type === "interval") {
      setScheduleKind(schedule.minutes === 60 ? "hourly" : "minute")
      setMinutes(String(schedule.minutes))
      return
    }
    setScheduleKind(schedule.type)
    setTime(schedule.time)
    if (schedule.type === "weekly") setDay(String(schedule.day))
  }

  const resetForm = () => {
    setEditing(undefined)
    setDraftDirectory(initialDirectory())
    setName("")
    setPrompt("")
    setStatus("active")
    setModel(undefined)
    setVariant(undefined)
    setSchedule({ type: "daily", time: "09:00" })
  }

  const openEditor = (input?: { item?: Automation }) => {
    resetForm()
    if (input?.item) {
      setDraftDirectory(input.item.directory)
      setEditing(input.item)
      setName(input.item.name)
      setPrompt(input.item.prompt)
      setStatus(input.item.status)
      setModel(input.item.model)
      setVariant(input.item.variant)
      setSchedule(input.item.schedule)
    }
    setMode("editor")
  }

  createEffect(() => {
    const automationID = props.automationID
    const data = automations.data
    if (!automationID) {
      if (editing()) {
        setMode("list")
        resetForm()
      }
      return
    }

    const item = data?.find((entry) => entry.id === automationID)
    if (item) {
      if (editing()?.id !== item.id) openEditor({ item })
      return
    }

    if (data && !automations.isLoading) props.onOpenAutomations?.({ replace: true })
  })

  const schedule = (): Schedule => {
    if (scheduleKind() === "minute") return { type: "interval", minutes: Math.max(5, Number(minutes()) || 5) }
    if (scheduleKind() === "hourly") return { type: "interval", minutes: 60 }
    if (scheduleKind() === "weekly") return { type: "weekly", day: Number(day()) || 1, time: time() }
    if (scheduleKind() === "weekday") return { type: "weekday", time: time() }
    return { type: "daily", time: time() }
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key() })

  const canSave = () => name().trim().length > 0 && prompt().trim().length > 0
  const saveSnapshot = (): SaveSnapshot | undefined => {
    if (!canSave()) return
    return {
      requestID: ++saveRequestID,
      editing: editing(),
      name: name(),
      prompt: prompt(),
      directory: draftDirectory(),
      schedule: schedule(),
      status: status(),
      model: model(),
      variant: variant(),
    }
  }

  const sameModel = (a: Automation["model"], b: Automation["model"]) =>
    (a?.providerID ?? "") === (b?.providerID ?? "") && (a?.modelID ?? "") === (b?.modelID ?? "")

  const snapshotStillCurrent = (snapshot: SaveSnapshot) =>
    snapshot.name === name() &&
    snapshot.prompt === prompt() &&
    snapshot.directory === draftDirectory() &&
    snapshot.status === status() &&
    snapshot.variant === variant() &&
    sameModel(snapshot.model, model()) &&
    JSON.stringify(snapshot.schedule) === JSON.stringify(schedule())

  const save = useMutation(() => ({
    mutationFn: async (snapshot: SaveSnapshot) => {
      const current = snapshot.editing
      if (current) {
        return client().automation.update({
          automationID: current.id,
          name: snapshot.name,
          prompt: snapshot.prompt,
          body_directory: snapshot.directory,
          schedule: snapshot.schedule,
          status: snapshot.status,
          model: snapshot.model,
          variant: snapshot.variant,
        })
      }
      return client().automation.create({
        name: snapshot.name,
        prompt: snapshot.prompt,
        body_directory: snapshot.directory,
        schedule: snapshot.schedule,
        status: snapshot.status,
        model: snapshot.model,
        variant: snapshot.variant,
      })
    },
    onSuccess: (result, snapshot) => {
      const item = result.data
      if (item && !snapshot.editing) {
        showToast({
          variant: "success",
          title: "Automation created",
          description: item.name,
        })
        void invalidate()
        if (props.onOpenAutomations) props.onOpenAutomations({ replace: true })
        else setMode("list")
        resetForm()
        return
      }
      if (item) {
        setEditing(item)
        if (snapshotStillCurrent(snapshot)) {
          setDraftDirectory(item.directory)
          setName(item.name)
          setPrompt(item.prompt)
          setStatus(item.status)
          setModel(item.model)
          setVariant(item.variant)
          setSchedule(item.schedule)
        }
      }
      void invalidate()
    },
    onError: (err) =>
      showToast({
        variant: "error",
        title: "Automation could not be saved",
        description: errorMessage(err, "Automation could not be saved"),
      }),
    onSettled: () => {
      creatingAutomation = false
      if (!queuedSave) return
      queuedSave = false
      queueMicrotask(persistEdits)
    },
  }))

  const updateStatus = useMutation(() => ({
    mutationFn: (item: Automation) =>
      client().automation.update({
        automationID: item.id,
        status: item.status === "active" ? "paused" : "active",
      }),
    onSuccess: () => {
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: [editing()?.id, "automation", "runs"] })
    },
  }))

  const runNow = useMutation(() => ({
    mutationFn: (item: Automation) => client().automation.run({ automationID: item.id }),
    onSuccess: (result, item) => {
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: [editing()?.id, "automation", "runs"] })
      const run = result.data
      if (run?.sessionID) {
        props.onOpenSession({ directory: run.directory ?? item.directory, id: run.sessionID })
        if (!props.embedded) dialog.close()
      }
    },
    onError: (err) =>
      showToast({
        variant: "error",
        title: "Automation run failed",
        description: errorMessage(err, "Automation run failed"),
      }),
  }))

  const remove = useMutation(() => ({
    mutationFn: (item: Automation) => client().automation.delete({ automationID: item.id }),
    onSuccess: () => {
      setMode("list")
      resetForm()
      props.onOpenAutomations?.({ replace: true })
      void invalidate()
    },
  }))

  const persistEdits = () => {
    if (!canSave()) return
    if (!editing()) return
    if (save.isPending) {
      queuedSave = true
      return
    }
    const snapshot = saveSnapshot()
    if (snapshot) save.mutate(snapshot)
  }

  const createAutomation = () => {
    if (!canSave() || save.isPending || creatingAutomation) return
    const snapshot = saveSnapshot()
    if (!snapshot) return
    creatingAutomation = true
    save.mutate(snapshot)
  }

  const updateStatusDraft = (next: Automation["status"]) => {
    if (status() === next) return
    setStatus(next)
    queueMicrotask(persistEdits)
  }

  onCleanup(() => {
    if (mode() !== "editor") return
    persistEdits()
  })

  const selectedModel = createMemo(() => {
    const current = model()
    if (!current) return
    return models.find({ providerID: current.providerID, modelID: current.modelID })
  })

  const variants = createMemo(() => Object.keys(selectedModel()?.variants ?? {}))

  const detailRow = (label: string, value: string, icon?: Parameters<typeof Icon>[0]["name"]) => (
    <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
      <span class="text-text-base">{label}</span>
      <span class="flex min-w-0 items-center gap-1 text-right text-text-weak">
        <span class="truncate">{value}</span>
        <Show when={icon}>
          <Icon name={icon!} size="small" />
        </Show>
      </span>
    </div>
  )

  const content = () => (
    <div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-base">
      <Show
        when={mode() === "editor"}
        fallback={
          <>
        <div class="no-scrollbar min-h-0 flex-1 overflow-auto px-10 py-10">
          <div class="mx-auto flex max-w-[760px] flex-col gap-8">
            <header class="group/automation-heading flex items-center justify-between gap-4">
              <h2 class="text-[32px] font-medium leading-tight text-text-strong">Automations</h2>
              <Popover
                open={settingsOpen()}
                onOpenChange={setSettingsOpen}
                placement="bottom-end"
                title="Automation settings"
                class="w-[280px]"
                trigger={
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base opacity-0 transition-[background-color,color,opacity] hover:bg-surface-base-hover hover:text-icon-strong focus:opacity-100 group-hover/automation-heading:opacity-100"
                    classList={{ "opacity-100": settingsOpen() }}
                    aria-label="Automation settings"
                  >
                    <Icon name="settings-gear" size="small" />
                  </button>
                }
              >
                <div class="flex flex-col gap-3">
                  <label class="flex flex-col gap-1.5">
                    <span class="text-13-medium text-text-strong">Parallel automations</span>
                    <span class="text-12-regular leading-5 text-text-weak">
                      Maximum automation runs active at the same time.
                    </span>
                    <input
                      type="number"
                      min={MIN_AUTOMATION_PARALLEL_LIMIT}
                      max={MAX_AUTOMATION_PARALLEL_LIMIT}
                      step="1"
                      class="mt-1 h-9 rounded-lg border border-border-base bg-surface-base px-3 text-14-regular text-text-strong outline-none focus:border-border-strong"
                      value={parallelLimitDraft()}
                      onInput={(event) => setParallelLimitDraft(event.currentTarget.value)}
                      onBlur={() => void saveParallelLimit()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  </label>
                </div>
              </Popover>
            </header>

            <section>
              <FilterDropdown
                value={automationStatusFilter()}
                options={AUTOMATION_STATUS_FILTER_OPTIONS}
                onChange={setAutomationStatusFilter}
                aria-label="Automation status filter"
                class="mb-3 flex items-center gap-1 rounded-md text-17-medium text-text-strong transition-colors hover:text-text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              >
                {AUTOMATION_STATUS_FILTER_OPTIONS.find((option) => option.value === automationStatusFilter())?.label ?? "Current"}
                <Icon name="chevron-down" size="small" class="text-icon-base" />
              </FilterDropdown>
              <div class="border-t border-border-weaker-base pt-2">
                <Show
                  when={filteredAutomations().length > 0}
                  fallback={
                    <div class="py-4 text-14-regular text-text-weak">
                      {automations.isLoading
                        ? "Loading automations..."
                        : automationStatusFilter() === "current"
                          ? "No automations yet."
                          : "No automations found."}
                    </div>
                  }
                >
                  <For each={filteredAutomations()}>
                    {(item) => (
                      <div
                        role="button"
                        tabindex="0"
                        class="group flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl bg-surface-base px-4 transition-colors hover:bg-surface-base-hover"
                        onClick={() => props.onOpenAutomation?.({ directory: item.directory, id: item.id }) ?? openEditor({ item })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            props.onOpenAutomation?.({ directory: item.directory, id: item.id }) ?? openEditor({ item })
                          }
                        }}
                      >
                        <div class="min-w-0 flex flex-1 items-baseline gap-2">
                          <span class="truncate text-15-medium text-text-strong">{item.name}</span>
                          <span class="shrink-0 text-13-regular text-text-weak">{projectName(item.directory)}</span>
                        </div>
                        <button
                          type="button"
                          class="shrink-0 rounded-md px-2 py-1 text-13-medium transition-colors hover:bg-surface-base-hover"
                          classList={{
                            "text-success-base": item.status === "active",
                            "text-text-weak": item.status !== "active",
                          }}
                          aria-label={item.status === "active" ? "Pause automation" : "Resume automation"}
                          onClick={(event) => {
                            event.stopPropagation()
                            updateStatus.mutate(item)
                          }}
                        >
                          {item.status === "active" ? "Active" : "Paused"}
                        </button>
                        <button
                          type="button"
                          class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                          aria-label="Run automation"
                          onClick={(event) => {
                            event.stopPropagation()
                            runNow.mutate(item)
                          }}
                        >
                          <Icon name="arrow-right" size="small" />
                        </button>
                        <button
                          type="button"
                          class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                          aria-label="Delete automation"
                          onClick={(event) => {
                            event.stopPropagation()
                            remove.mutate(item)
                          }}
                        >
                          <Icon name="trash" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
                <button
                  type="button"
                  class="mt-2 flex min-h-[52px] w-full items-center rounded-xl border border-dashed border-border-weaker-base px-4 text-left text-15-medium text-text-weak transition-colors hover:border-border-base hover:bg-surface-base hover:text-text-strong"
                  aria-label="+ New Automation"
                  onClick={() => openEditor()}
                >
                  + New Automation
                </button>
              </div>
            </section>
          </div>
        </div>
          </>
        }
      >
        <form
          class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,420px)] overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault()
            persistEdits()
          }}
        >
          <div class="flex min-h-0 flex-col overflow-hidden px-10 py-6">
            <div class="mb-14 flex items-center gap-3 text-15-medium">
              <button
                type="button"
                class="text-text-weak hover:text-text-strong"
                onClick={() => {
                  persistEdits()
                  props.onOpenAutomations?.() ?? setMode("list")
                  if (!props.onOpenAutomations) resetForm()
                }}
              >
                Automations
              </button>
              <Icon name="chevron-right" size="small" class="text-icon-base" />
              <span class="truncate text-text-strong">{name() || "New automation"}</span>
            </div>

            <div class="flex min-h-0 w-full max-w-[1120px] flex-1 flex-col pr-8">
              <input
                class="w-full shrink-0 border-none bg-transparent text-[34px] font-medium leading-tight text-text-strong outline-none placeholder:text-text-dim"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                onBlur={persistEdits}
                placeholder="Automation title"
                autofocus
              />
              <textarea
                class="mt-12 min-h-0 flex-1 w-full resize-none border-none bg-transparent text-18-regular leading-8 text-text-strong outline-none placeholder:text-text-dim"
                value={prompt()}
                onInput={(event) => setPrompt(event.currentTarget.value)}
                onBlur={persistEdits}
                placeholder="Add prompt e.g. look for crashes in $sentry"
              />
            </div>
          </div>

          <aside class="flex min-h-0 flex-col overflow-auto border-l border-border-weaker-base px-8 py-5">
            <div class="mb-12 flex items-center justify-end gap-4">
              <Show when={editing()}>
                {(item) => (
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                    aria-label="Delete automation"
                    onClick={() => remove.mutate(item())}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </Show>
              <Button
                type="button"
                size="large"
                variant="primary"
                icon="arrow-right"
                disabled={!canSave() || save.isPending || runNow.isPending}
                aria-busy={save.isPending && !editing() ? "true" : undefined}
                onClick={() => {
                  const current = editing()
                  if (!current) {
                    createAutomation()
                    return
                  }
                  runNow.mutate(current)
                }}
              >
                {editing() ? "Run now" : save.isPending ? "Creating..." : "Create"}
              </Button>
            </div>

            <div class="space-y-10">
              <section>
                <h3 class="mb-5 text-16-medium text-text-dim">Status</h3>
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                    <span class="text-text-base">Status</span>
                    <div class="flex rounded-lg bg-surface-base p-0.5 text-13-medium">
                      <button
                        type="button"
                        class="rounded-md px-2.5 py-1 transition-colors"
                        classList={{
                          "bg-surface-raised-base text-success-base": status() === "active",
                          "text-text-weak hover:text-text-strong": status() !== "active",
                        }}
                        aria-pressed={status() === "active"}
                        onClick={() => updateStatusDraft("active")}
                      >
                        Active
                      </button>
                      <button
                        type="button"
                        class="rounded-md px-2.5 py-1 transition-colors"
                        classList={{
                          "bg-surface-raised-base text-text-base": status() === "paused",
                          "text-text-weak hover:text-text-strong": status() !== "paused",
                        }}
                        aria-pressed={status() === "paused"}
                        onClick={() => updateStatusDraft("paused")}
                      >
                        Paused
                      </button>
                    </div>
                  </div>
                  {detailRow("Next run", editing() ? formatTime(finiteNumber(editing()!.nextRunAt)) : "After creation")}
                  {detailRow("Last ran", formatTime(finiteNumber(editing()?.lastRunAt)))}
                </div>
              </section>

              <section>
                <h3 class="mb-5 text-16-medium text-text-dim">Details</h3>
                <div class="space-y-2">
                  {detailRow("Runs in", "Worktree", "chevron-down")}
                  {detailRow("Environment", "No environment", "chevron-down")}
                  <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                    <span class="text-text-base">Project</span>
                    <select
                      ref={projectSelect}
                      class="max-w-[200px] border-none bg-transparent text-right text-text-weak outline-none"
                      value={draftDirectory()}
                      onInput={(event) => {
                        setDraftDirectory(event.currentTarget.value)
                        queueMicrotask(persistEdits)
                      }}
                    >
                      <For each={props.projects}>
                        {(project) => (
                          <option value={project.worktree} selected={project.worktree === draftDirectory()}>
                            {displayName(project)}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                    <span class="text-text-base">Repeats</span>
                    <span class="flex items-center text-text-weak">
                      <select
                        class="border-none bg-transparent text-right text-text-weak outline-none"
                        value={scheduleKind()}
                        onInput={(event) => {
                          const next = event.currentTarget.value as ScheduleKind
                          setScheduleKind(next)
                          if (next === "minute" && Number(minutes()) === 60) setMinutes("5")
                          queueMicrotask(persistEdits)
                        }}
                      >
                        <option value="minute">Minute</option>
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily</option>
                        <option value="weekday">Weekday</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </span>
                  </div>
                  <Show when={scheduleKind() === "minute"}>
                    <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                      <span class="text-text-base">Every</span>
                      <span class="flex items-center gap-2 text-text-weak">
                        <input
                          type="number"
                          min="5"
                          class="w-16 border-none bg-transparent text-right text-text-weak outline-none"
                          value={minutes()}
                          onInput={(event) => setMinutes(event.currentTarget.value)}
                          onBlur={persistEdits}
                        />
                        min
                      </span>
                    </div>
                  </Show>
                  <Show when={scheduleKind() === "daily" || scheduleKind() === "weekday" || scheduleKind() === "weekly"}>
                    <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                      <span class="text-text-base">Time</span>
                      <input
                        type="time"
                        class="border-none bg-transparent text-right text-text-weak outline-none"
                        value={time()}
                        onInput={(event) => setTime(event.currentTarget.value)}
                        onBlur={persistEdits}
                      />
                    </div>
                  </Show>
                  <Show when={scheduleKind() === "weekly"}>
                    <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                      <span class="text-text-base">Day</span>
                      <select
                        class="border-none bg-transparent text-right text-text-weak outline-none"
                        value={day()}
                        onInput={(event) => {
                          setDay(event.currentTarget.value)
                          queueMicrotask(persistEdits)
                        }}
                      >
                        <option value="0">Sunday</option>
                        <option value="1">Monday</option>
                        <option value="2">Tuesday</option>
                        <option value="3">Wednesday</option>
                        <option value="4">Thursday</option>
                        <option value="5">Friday</option>
                        <option value="6">Saturday</option>
                      </select>
                    </div>
                  </Show>
                  <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                    <span class="text-text-base">Model</span>
                    <select
                      class="max-w-[220px] border-none bg-transparent text-right text-text-weak outline-none"
                      value={encodeModel(model())}
                      onInput={(event) => {
                        const selected = decodeModel(event.currentTarget.value)
                        if (!selected) {
                          setModel(undefined)
                          setVariant(undefined)
                          queueMicrotask(persistEdits)
                          return
                        }
                        setModel(selected)
                        setVariant(undefined)
                        queueMicrotask(persistEdits)
                      }}
                    >
                      <option value="">Default</option>
                      <For each={models.list().filter((item) => models.visible({ providerID: item.provider.id, modelID: item.id }))}>
                        {(item) => (
                          <option value={encodeModel({ providerID: item.provider.id, modelID: item.id })}>
                            {item.provider.name} / {item.name}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                    <span class="text-text-base">Reasoning</span>
                    <select
                      class="max-w-[200px] border-none bg-transparent text-right text-text-weak outline-none"
                      value={variant() ?? ""}
                      disabled={!selectedModel() || variants().length === 0}
                      title={!selectedModel() ? "Select a model to choose reasoning" : undefined}
                      onInput={(event) => {
                        setVariant(event.currentTarget.value || undefined)
                        queueMicrotask(persistEdits)
                      }}
                    >
                      <option value="">Default</option>
                      <For each={variants()}>{(item) => <option value={item}>{item}</option>}</For>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 class="mb-5 text-16-medium text-text-dim">Previous runs</h3>
                <Show
                  when={(runs.data ?? []).length > 0}
                  fallback={<div class="text-14-regular text-text-weak">{runs.isLoading ? "Loading runs..." : "No runs yet."}</div>}
                >
                  <div class="space-y-4">
                    <For each={runs.data ?? []}>
                      {(run) => (
                        <button
                          type="button"
                          class="flex w-full items-center gap-3 text-left"
                          onClick={() => {
                            if (run.sessionID) {
                              props.onOpenSession({ directory: run.directory ?? editing()?.directory ?? draftDirectory(), id: run.sessionID })
                              return
                            }
                            if (run.status === "failed") {
                              showToast({
                                variant: "error",
                                title: "Automation run failed",
                                description: run.error ?? "No session was created for this run.",
                              })
                            }
                          }}
                        >
                          <span
                            class="flex size-4 shrink-0 items-center justify-center rounded-full"
                            classList={{
                              "bg-accent-base": run.status === "running",
                              "bg-surface-base text-text-weak": run.status !== "running",
                            }}
                          >
                            <Show when={run.status !== "running"}>
                              <Icon name={run.status === "succeeded" ? "check-small" : "close-small"} size="small" />
                            </Show>
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="mr-2 text-15-medium text-text-strong">{name() || "Automation run"}</span>
                            <span class="text-14-regular text-text-weak">
                              {projectName(run.directory ?? editing()?.directory ?? draftDirectory())}
                            </span>
                          </span>
                          <span class="shrink-0 text-13-regular text-text-weak">
                            {compactRelativeTime(finiteNumber(run.completedAt) ?? finiteNumber(run.startedAt))}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>
          </aside>
        </form>
      </Show>
    </div>
  )

  if (props.embedded) return content()

  return (
    <Dialog size="x-large" transition>
      {content()}
    </Dialog>
  )
}
