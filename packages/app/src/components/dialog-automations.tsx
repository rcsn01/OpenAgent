import { createMemo, createSignal, For, Show } from "solid-js"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject } from "@/context/layout"
import { displayName, errorMessage } from "@/pages/layout/helpers"
import type { AutomationListResponse } from "@opencode-ai/sdk/v2/client"

type Automation = AutomationListResponse[number]
type Schedule = Automation["schedule"]
type Template = {
  title: string
  prompt: string
  icon: Parameters<typeof Icon>[0]["name"]
  category: string
  schedule: Schedule
}

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const templates: Template[] = [
  {
    category: "Status reports",
    title: "Standup summary",
    prompt: "Summarize yesterday's git activity for standup.",
    icon: "speech-bubble",
    schedule: { type: "daily", time: "09:00" },
  },
  {
    category: "Status reports",
    title: "Weekly team update",
    prompt: "Synthesize this week's PRs, rollouts, incidents, and reviews into a weekly update.",
    icon: "comment",
    schedule: { type: "weekly", day: 5, time: "15:00" },
  },
  {
    category: "Status reports",
    title: "PR risk digest",
    prompt: "Summarize last week's PRs by teammate and theme; highlight risks.",
    icon: "bullet-list",
    schedule: { type: "weekly", day: 1, time: "09:00" },
  },
  {
    category: "Release prep",
    title: "Release notes",
    prompt: "Draft weekly release notes from merged PRs, including links when available.",
    icon: "review",
    schedule: { type: "weekly", day: 5, time: "11:00" },
  },
  {
    category: "Release prep",
    title: "Pre-tag checklist",
    prompt: "Before tagging, verify changelog, migrations, feature flags, and tests.",
    icon: "circle-check",
    schedule: { type: "weekly", day: 4, time: "16:00" },
  },
  {
    category: "Release prep",
    title: "Changelog updater",
    prompt: "Update the changelog with this week's highlights and key PR links.",
    icon: "pencil-line",
    schedule: { type: "weekly", day: 5, time: "10:00" },
  },
  {
    category: "Incidents & triage",
    title: "CI failure triage",
    prompt: "Summarize CI failures and flaky tests from the last CI window; suggest top fixes.",
    icon: "status",
    schedule: { type: "daily", time: "10:00" },
  },
  {
    category: "Incidents & triage",
    title: "Root-cause grouping",
    prompt: "Check CI failures; group by likely root cause and suggest minimal fixes.",
    icon: "terminal",
    schedule: { type: "interval", minutes: 240 },
  },
  {
    category: "Incidents & triage",
    title: "Issue triage",
    prompt: "Triage new issues; suggest owner, priority, and labels.",
    icon: "warning",
    schedule: { type: "daily", time: "09:30" },
  },
  {
    category: "Code quality",
    title: "Bug scan",
    prompt: "Scan recent commits since the last run, or last 24h, for likely bugs and propose minimal fixes.",
    icon: "shield",
    schedule: { type: "daily", time: "17:00" },
  },
  {
    category: "Code quality",
    title: "Coverage scout",
    prompt: "Identify untested paths from recent changes; add focused test suggestions.",
    icon: "star",
    schedule: { type: "weekly", day: 3, time: "14:00" },
  },
]

const categories = ["Status reports", "Release prep", "Incidents & triage", "Code quality"]

function scheduleText(schedule: Schedule) {
  if (schedule.type === "interval") return `Every ${schedule.minutes} minutes`
  if (schedule.type === "daily") return `Daily at ${schedule.time}`
  return `${days[schedule.day]} at ${schedule.time}`
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

export function DialogAutomations(props: {
  projects: LocalProject[]
  currentDir?: string
  embedded?: boolean
  onOpenSession: (input: { directory: string; id: string }) => void
}) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()
  const firstProject = () => props.projects[0]
  const [directory, setDirectory] = createSignal(props.currentDir || firstProject()?.worktree || "")
  const client = createMemo(() => globalSDK.createClient({ directory: directory(), throwOnError: true }))
  const key = () => [directory(), "automation"]

  const [editorOpen, setEditorOpen] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [editing, setEditing] = createSignal<Automation | undefined>()
  const [template, setTemplate] = createSignal<Template | undefined>()
  const [name, setName] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [status, setStatus] = createSignal<"active" | "paused">("active")
  const [scheduleType, setScheduleType] = createSignal<Schedule["type"]>("daily")
  const [time, setTime] = createSignal("09:00")
  const [day, setDay] = createSignal("1")
  const [minutes, setMinutes] = createSignal("60")

  const automations = useQuery(() => ({
    queryKey: key(),
    queryFn: () => client().automation.list().then((x) => x.data ?? []),
    enabled: !!directory(),
  }))

  const projectName = (worktree: string) => displayName(props.projects.find((item) => item.worktree === worktree) ?? firstProject()!)

  const setSchedule = (schedule: Schedule) => {
    setScheduleType(schedule.type)
    if (schedule.type === "interval") {
      setMinutes(String(schedule.minutes))
      return
    }
    setTime(schedule.time)
    if (schedule.type === "weekly") setDay(String(schedule.day))
  }

  const resetForm = () => {
    setEditing(undefined)
    setTemplate(undefined)
    setName("")
    setPrompt("")
    setStatus("active")
    setSchedule({ type: "daily", time: "09:00" })
  }

  const openEditor = (input?: { item?: Automation; template?: Template }) => {
    resetForm()
    if (input?.item) {
      setEditing(input.item)
      setName(input.item.name)
      setPrompt(input.item.prompt)
      setStatus(input.item.status)
      setSchedule(input.item.schedule)
    }
    if (input?.template) {
      setTemplate(input.template)
      setName(input.template.title)
      setPrompt(input.template.prompt)
      setSchedule(input.template.schedule)
    }
    setPickerOpen(false)
    setEditorOpen(true)
  }

  const schedule = (): Schedule => {
    if (scheduleType() === "interval") return { type: "interval", minutes: Number(minutes()) || 60 }
    if (scheduleType() === "weekly") return { type: "weekly", day: Number(day()) || 1, time: time() }
    return { type: "daily", time: time() }
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key() })

  const save = useMutation(() => ({
    mutationFn: async () => {
      const current = editing()
      if (current) {
        return client().automation.update({
          automationID: current.id,
          name: name(),
          prompt: prompt(),
          schedule: schedule(),
          status: status(),
        })
      }
      return client().automation.create({
        name: name(),
        prompt: prompt(),
        schedule: schedule(),
        status: status(),
      })
    },
    onSuccess: () => {
      setEditorOpen(false)
      resetForm()
      void invalidate()
    },
    onError: (err) =>
      showToast({
        variant: "error",
        title: "Automation could not be saved",
        description: errorMessage(err, "Automation could not be saved"),
      }),
  }))

  const updateStatus = useMutation(() => ({
    mutationFn: (item: Automation) =>
      client().automation.update({
        automationID: item.id,
        status: item.status === "active" ? "paused" : "active",
      }),
    onSuccess: () => void invalidate(),
  }))

  const runNow = useMutation(() => ({
    mutationFn: (item: Automation) => client().automation.run({ automationID: item.id }),
    onSuccess: (result) => {
      void invalidate()
      const run = result.data
      if (run?.sessionID) {
        props.onOpenSession({ directory: directory(), id: run.sessionID })
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
    onSuccess: () => void invalidate(),
  }))

  const canSave = () => name().trim().length > 0 && prompt().trim().length > 0
  const selectedScheduleText = () => scheduleText(schedule())

  const content = () => (
    <div class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-base">
        <div class="absolute right-4 top-4 z-10">
          <Button icon="plus-small" class="rounded-xl" onClick={() => openEditor()}>
            New automation
          </Button>
        </div>

        <div class="no-scrollbar min-h-0 flex-1 overflow-auto px-10 py-10">
          <div class="mx-auto flex max-w-[760px] flex-col gap-8">
            <header class="pr-40">
              <h2 class="text-[32px] font-medium leading-tight text-text-strong">Automations</h2>
            </header>

            <section>
              <h3 class="mb-3 text-17-medium text-text-strong">Current</h3>
              <div class="border-t border-border-subtle pt-2">
                <Show
                  when={(automations.data ?? []).length > 0}
                  fallback={
                    <div class="py-4 text-14-regular text-text-weak">
                      {automations.isLoading ? "Loading automations..." : "No automations yet."}
                    </div>
                  }
                >
                  <For each={automations.data ?? []}>
                    {(item) => (
                      <div class="group flex min-h-[56px] items-center gap-3 rounded-xl bg-surface-base px-4 transition-colors hover:bg-surface-base-hover">
                        <button
                          type="button"
                          class="flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-text-weak hover:text-text-strong"
                          aria-label={item.status === "active" ? "Pause automation" : "Resume automation"}
                          onClick={() => updateStatus.mutate(item)}
                        >
                          <Show when={item.status === "paused"}>
                            <Icon name="check-small" size="small" />
                          </Show>
                        </button>
                        <div class="min-w-0 flex flex-1 items-baseline gap-2">
                          <span class="truncate text-15-medium text-text-strong">{item.name}</span>
                          <span class="shrink-0 text-13-regular text-text-weak">{projectName(item.directory)}</span>
                        </div>
                        <button
                          type="button"
                          class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                          aria-label="Run automation"
                          onClick={() => runNow.mutate(item)}
                        >
                          <Icon name="arrow-right" size="small" />
                        </button>
                        <button
                          type="button"
                          class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                          aria-label="Edit automation"
                          onClick={() => openEditor({ item })}
                        >
                          <Icon name="edit" size="small" />
                        </button>
                        <button
                          type="button"
                          class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover hover:text-icon-strong"
                          aria-label="Delete automation"
                          onClick={() => remove.mutate(item)}
                        >
                          <Icon name="trash" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </section>
          </div>
        </div>

        <Show when={pickerOpen()}>
          <div class="absolute inset-0 z-20 flex items-center justify-center bg-background-base/40 px-6 backdrop-blur-[1px]">
            <div class="max-h-[76%] w-full max-w-[820px] overflow-hidden rounded-[22px] border border-border-subtle bg-surface-raised-stronger p-5 shadow-2xl">
              <div class="mb-5 flex items-center justify-between">
                <h3 class="text-18-medium text-text-strong">Automation templates</h3>
                <div class="flex items-center gap-2">
                  <Button onClick={() => openEditor()}>Create new</Button>
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover"
                    aria-label="Close templates"
                    onClick={() => setPickerOpen(false)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
              <div class="no-scrollbar grid max-h-[520px] grid-cols-2 gap-4 overflow-auto">
                <For each={templates}>
                  {(item) => (
                    <button
                      type="button"
                      class="min-h-[104px] rounded-[18px] border border-border-subtle bg-surface-base px-5 py-4 text-left hover:bg-surface-base-hover"
                      onClick={() => openEditor({ template: item })}
                    >
                      <Icon name={item.icon} />
                      <span class="mt-4 block text-15-regular leading-6 text-text-strong">{item.prompt}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        <Show when={editorOpen()}>
          <div class="absolute inset-0 z-30 flex items-end justify-center bg-background-base/30 px-2 pb-2">
            <form
              class="w-full max-w-[1040px] rounded-[28px] border border-border-subtle bg-surface-raised-stronger p-7 shadow-2xl"
              onSubmit={(event) => {
                event.preventDefault()
                if (!canSave()) return
                save.mutate()
              }}
            >
              <div class="mb-4 flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <input
                    class="w-full border-none bg-transparent text-22-medium text-text-strong outline-none placeholder:text-text-dim"
                    value={name()}
                    onInput={(event) => setName(event.currentTarget.value)}
                    placeholder="Automation title"
                    autofocus
                  />
                  <textarea
                    class="mt-6 min-h-[220px] w-full resize-none border-none bg-transparent text-18-regular leading-7 text-text-strong outline-none placeholder:text-text-dim"
                    value={prompt()}
                    onInput={(event) => setPrompt(event.currentTarget.value)}
                    placeholder="Add prompt e.g. look for crashes in $sentry"
                  />
                </div>
                <div class="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover"
                    aria-label="Automation information"
                  >
                    <Icon name="help" />
                  </button>
                  <Show when={template()}>
                    <Button type="button" onClick={() => template() && openEditor({ template: template() })}>
                      Use template
                    </Button>
                  </Show>
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover"
                    aria-label="Close automation editor"
                    onClick={() => {
                      setEditorOpen(false)
                      resetForm()
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex min-w-0 flex-wrap items-center gap-4 text-16-regular text-text-strong">
                  <label class="flex items-center gap-2">
                    <Icon name="branch" />
                    <span>Worktree</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <Icon name="folder" />
                    <select
                      class="max-w-[220px] border-none bg-transparent text-text-strong outline-none"
                      value={directory()}
                      onInput={(event) => setDirectory(event.currentTarget.value)}
                    >
                      <For each={props.projects}>
                        {(project) => <option value={project.worktree}>{displayName(project)}</option>}
                      </For>
                    </select>
                  </label>
                  <label class="flex items-center gap-2">
                    <Icon name="status" />
                    <select
                      class="border-none bg-transparent text-text-strong outline-none"
                      value={scheduleType()}
                      onInput={(event) => setScheduleType(event.currentTarget.value as Schedule["type"])}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="interval">Interval</option>
                    </select>
                    <span class="text-text-weak">{selectedScheduleText()}</span>
                  </label>
                  <Show
                    when={scheduleType() === "interval"}
                    fallback={
                      <input
                        type="time"
                        class="w-[96px] border-none bg-transparent text-text-strong outline-none"
                        value={time()}
                        onInput={(event) => setTime(event.currentTarget.value)}
                      />
                    }
                  >
                    <input
                      type="number"
                      min="15"
                      class="w-[76px] border-none bg-transparent text-text-strong outline-none"
                      value={minutes()}
                      onInput={(event) => setMinutes(event.currentTarget.value)}
                    />
                  </Show>
                  <Show when={scheduleType() === "weekly"}>
                    <select
                      class="border-none bg-transparent text-text-strong outline-none"
                      value={day()}
                      onInput={(event) => setDay(event.currentTarget.value)}
                    >
                      <For each={days}>{(label, index) => <option value={index()}>{label}</option>}</For>
                    </select>
                  </Show>
                  <button
                    type="button"
                    class="flex size-8 items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover"
                    aria-label={status() === "active" ? "Pause automation" : "Activate automation"}
                    onClick={() => setStatus(status() === "active" ? "paused" : "active")}
                  >
                    <Icon name={status() === "active" ? "models" : "circle-ban-sign"} />
                  </button>
                </div>
                <div class="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    class="text-16-regular text-text-weak hover:text-text-strong"
                    onClick={() => {
                      setEditorOpen(false)
                      resetForm()
                    }}
                  >
                    Cancel
                  </button>
                  <Button type="submit" variant="primary" size="large" disabled={!canSave() || save.isPending}>
                    {editing() ? "Save" : "Create"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
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
