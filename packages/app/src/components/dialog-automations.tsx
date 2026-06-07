import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@openagent/ui/dialog"
import { Button } from "@openagent/ui/button"
import { Icon } from "@openagent/ui/icon"
import { showToast } from "@openagent/ui/toast"
import { useDialog } from "@openagent/ui/context/dialog"
import { useAutomations, type Automation, type AutomationModel } from "@/context/automation/store"
import type { AutomationSchedule } from "@/context/automation/schedule"
import { type LocalProject } from "@/context/layout"
import { useModels } from "@/context/models"
import { displayName, errorMessage } from "@/pages/layout/helpers"

type ScheduleKind = "minute" | "hourly" | "daily" | "weekday" | "weekly"

function formatTime(value?: number) {
  if (!value) return "Never"
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
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
  const automations = useAutomations()
  const models = useModels()

  const firstProject = () => props.projects[0]
  const initialDirectory = () => props.currentDir || firstProject()?.worktree || ""
  const [mode, setMode] = createSignal<"list" | "editor">("list")
  const [editing, setEditing] = createSignal<Automation | undefined>()
  const [name, setName] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [directory, setDirectory] = createSignal(initialDirectory())
  const [status, setStatus] = createSignal<"active" | "paused">("active")
  const [scheduleKind, setScheduleKind] = createSignal<ScheduleKind>("daily")
  const [time, setTime] = createSignal("09:00")
  const [day, setDay] = createSignal("1")
  const [minutes, setMinutes] = createSignal("5")
  const [model, setModel] = createSignal<AutomationModel | undefined>()
  const [variant, setVariant] = createSignal<string | undefined>()
  const [saving, setSaving] = createSignal(false)
  const [runningID, setRunningID] = createSignal<string | undefined>()

  const projectName = (worktree: string) => {
    const project = props.projects.find((item) => item.worktree === worktree)
    if (project) return displayName(project)
    return worktree.split(/[\\/]/).filter(Boolean).at(-1) ?? worktree
  }

  const setSchedule = (schedule: AutomationSchedule) => {
    if (schedule.type === "interval") {
      setScheduleKind(schedule.minutes === 60 ? "hourly" : "minute")
      setMinutes(String(schedule.minutes))
      return
    }
    setScheduleKind(schedule.type)
    setTime(schedule.time)
    if (schedule.type === "weekly") setDay(String(schedule.day))
  }

  const schedule = (): AutomationSchedule => {
    if (scheduleKind() === "minute") return { type: "interval", minutes: Math.max(5, Number(minutes()) || 5) }
    if (scheduleKind() === "hourly") return { type: "interval", minutes: 60 }
    if (scheduleKind() === "weekly") return { type: "weekly", day: Number(day()) || 1, time: time() }
    if (scheduleKind() === "weekday") return { type: "weekday", time: time() }
    return { type: "daily", time: time() }
  }

  const resetForm = () => {
    setEditing(undefined)
    setName("")
    setPrompt("")
    setDirectory(initialDirectory())
    setStatus("active")
    setModel(undefined)
    setVariant(undefined)
    setSchedule({ type: "daily", time: "09:00" })
  }

  const openEditor = (item?: Automation) => {
    resetForm()
    if (item) {
      setEditing(item)
      setName(item.name)
      setPrompt(item.prompt)
      setDirectory(item.directory)
      setStatus(item.status)
      setModel(item.model)
      setVariant(item.variant)
      setSchedule(item.schedule)
    }
    setMode("editor")
  }

  createEffect(() => {
    const id = props.automationID
    if (!id) {
      if (editing()) {
        setMode("list")
        resetForm()
      }
      return
    }
    const item = automations.list().find((entry) => entry.id === id)
    if (item) {
      if (editing()?.id !== item.id) openEditor(item)
      return
    }
    if (automations.ready()) props.onOpenAutomations?.({ replace: true })
  })

  const canSave = () => name().trim().length > 0 && prompt().trim().length > 0 && directory().trim().length > 0

  const save = () => {
    if (!canSave()) return
    setSaving(true)
    try {
      const input = {
        name: name().trim(),
        prompt: prompt(),
        directory: directory(),
        schedule: schedule(),
        status: status(),
        model: model(),
        variant: variant(),
      }
      const current = editing()
      if (current) {
        const updated = automations.actions.update(current.id, input)
        if (updated) setEditing(updated)
        return updated
      }
      const created = automations.actions.create(input)
      showToast({ variant: "success", title: "Automation created", description: created.name })
      props.onOpenAutomation?.({ directory: created.directory, id: created.id }) ?? openEditor(created)
      return created
    } catch (err) {
      showToast({
        variant: "error",
        title: "Automation could not be saved",
        description: errorMessage(err, "Automation could not be saved"),
      })
    } finally {
      setSaving(false)
    }
  }

  const saveExisting = () => {
    if (!editing()) return
    save()
  }

  const remove = (item: Automation) => {
    automations.actions.delete(item.id)
    props.onOpenAutomations?.({ replace: true })
    setMode("list")
    resetForm()
  }

  const runNow = async (item: Automation) => {
    if (runningID()) return
    setRunningID(item.id)
    try {
      const run = await automations.actions.run(item.id)
      if (run?.sessionID) {
        props.onOpenSession({ directory: run.directory, id: run.sessionID })
        if (!props.embedded) dialog.close()
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Automation run failed",
        description: errorMessage(err, "Automation run failed"),
      })
    } finally {
      setRunningID(undefined)
    }
  }

  const selectedModel = createMemo(() => {
    const current = model()
    if (!current) return
    return models.find({ providerID: current.providerID, modelID: current.modelID })
  })
  const variants = createMemo(() => Object.keys(selectedModel()?.variants ?? {}))
  const runs = () => (editing() ? automations.runs(editing()!.id) : [])

  const detailRow = (label: string, value: string) => (
    <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
      <span class="text-text-base">{label}</span>
      <span class="min-w-0 truncate text-right text-text-weak">{value}</span>
    </div>
  )

  const list = () => (
    <div class="no-scrollbar min-h-0 flex-1 overflow-auto px-10 py-10">
      <div class="mx-auto flex max-w-[760px] flex-col gap-8">
        <header class="flex items-center justify-between gap-4">
          <h2 class="text-[32px] font-medium leading-tight text-text-strong">Automations</h2>
        </header>

        <section>
          <h3 class="mb-3 text-17-medium text-text-strong">Current</h3>
          <div class="border-t border-border-weaker-base pt-2">
            <Show
              when={automations.list().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {automations.ready() ? "No automations yet." : "Loading automations..."}
                </div>
              }
            >
              <For each={automations.list()}>
                {(item) => (
                  <div
                    role="button"
                    tabindex="0"
                    class="group flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl bg-surface-base px-4 transition-colors hover:bg-surface-base-hover"
                    onClick={() => props.onOpenAutomation?.({ directory: item.directory, id: item.id }) ?? openEditor(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        props.onOpenAutomation?.({ directory: item.directory, id: item.id }) ?? openEditor(item)
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
                        automations.actions.update(item.id, { status: item.status === "active" ? "paused" : "active" })
                      }}
                    >
                      {item.status === "active" ? "Active" : "Paused"}
                    </button>
                    <button
                      type="button"
                      class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                      aria-label="Run automation"
                      disabled={!!runningID()}
                      onClick={(event) => {
                        event.stopPropagation()
                        void runNow(item)
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
                        remove(item)
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
  )

  const editor = () => (
    <form
      class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,420px)] overflow-hidden"
      onSubmit={(event) => {
        event.preventDefault()
        saveExisting()
      }}
    >
      <div class="flex min-h-0 flex-col overflow-hidden px-10 py-6">
        <div class="mb-14 flex items-center gap-3 text-15-medium">
          <button
            type="button"
            class="text-text-weak hover:text-text-strong"
            onClick={() => {
              saveExisting()
              props.onOpenAutomations?.() ?? setMode("list")
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
            onBlur={saveExisting}
            placeholder="Automation title"
            autofocus
          />
          <textarea
            class="mt-12 min-h-0 flex-1 w-full resize-none border-none bg-transparent text-18-regular leading-8 text-text-strong outline-none placeholder:text-text-dim"
            value={prompt()}
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onBlur={saveExisting}
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
                onClick={() => remove(item())}
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
            disabled={!canSave() || saving() || !!runningID()}
            onClick={() => {
              const current = editing() ?? save()
              if (current) void runNow(current)
            }}
          >
            {editing() ? "Run now" : saving() ? "Creating..." : "Create"}
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
                    onClick={() => {
                      setStatus("active")
                      saveExisting()
                    }}
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
                    onClick={() => {
                      setStatus("paused")
                      saveExisting()
                    }}
                  >
                    Paused
                  </button>
                </div>
              </div>
              {detailRow("Next run", editing() ? formatTime(editing()!.nextRunAt) : "After creation")}
              {detailRow("Last ran", formatTime(editing()?.lastRunAt))}
            </div>
          </section>

          <section>
            <h3 class="mb-5 text-16-medium text-text-dim">Details</h3>
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                <span class="text-text-base">Project</span>
                <select
                  class="max-w-[200px] border-none bg-transparent text-right text-text-weak outline-none"
                  value={directory()}
                  onInput={(event) => {
                    setDirectory(event.currentTarget.value)
                    saveExisting()
                  }}
                >
                  <For each={props.projects}>
                    {(project) => <option value={project.worktree}>{displayName(project)}</option>}
                  </For>
                </select>
              </div>
              <div class="flex items-center justify-between gap-4 py-1.5 text-15-regular">
                <span class="text-text-base">Repeats</span>
                <select
                  class="border-none bg-transparent text-right text-text-weak outline-none"
                  value={scheduleKind()}
                  onInput={(event) => {
                    const next = event.currentTarget.value as ScheduleKind
                    setScheduleKind(next)
                    if (next === "minute" && Number(minutes()) === 60) setMinutes("5")
                    saveExisting()
                  }}
                >
                  <option value="minute">Minute</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekday">Weekday</option>
                  <option value="weekly">Weekly</option>
                </select>
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
                      onBlur={saveExisting}
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
                    onBlur={saveExisting}
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
                      saveExisting()
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
                    setModel(selected)
                    setVariant(undefined)
                    saveExisting()
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
                  onInput={(event) => {
                    setVariant(event.currentTarget.value || undefined)
                    saveExisting()
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
            <Show when={runs().length > 0} fallback={<div class="text-14-regular text-text-weak">No runs yet.</div>}>
              <div class="space-y-4">
                <For each={runs()}>
                  {(run) => (
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 text-left"
                      onClick={() => {
                        if (run.sessionID) {
                          props.onOpenSession({ directory: run.directory, id: run.sessionID })
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
                        <span class="text-14-regular text-text-weak">{projectName(run.directory)}</span>
                      </span>
                      <span class="shrink-0 text-13-regular text-text-weak">
                        {compactRelativeTime(run.completedAt ?? run.failedAt ?? run.startedAt)}
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
  )

  const content = () => (
    <div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-base">
      <Show when={mode() === "editor"} fallback={list()}>
        {editor()}
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
