import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createResource, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import type { Accessor } from "solid-js"
import { formatKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import type { VoiceInputGain, VoiceSettings } from "@/context/settings"
import { usePlatform, type SpeechModelID, type SpeechModelInfo, type SpeechTranscriptionQuality } from "@/context/platform"
import { parseVoiceCorrections, parseVoiceDictionary } from "./voice-postprocess"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const fallbackModels: SpeechModelInfo[] = [
  ...(IS_MAC
    ? [
        {
          id: "apple-speech",
          label: "Apple Speech",
          description: "Experimental. Uses macOS native speech recognition when it is available.",
          downloaded: true,
          recommended: false,
          path: "",
        } satisfies SpeechModelInfo,
      ]
    : []),
  {
    id: "parakeet-tdt-v3",
    label: "Parakeet TDT v3",
    description: "Recommended. Multilingual and the strongest local model.",
    downloaded: false,
    recommended: true,
    path: "",
  },
  {
    id: "parakeet-tdt-v2",
    label: "Parakeet TDT v2",
    description: "Earlier Parakeet release with an explicit download option.",
    downloaded: false,
    recommended: false,
    path: "",
  },
]

interface VoiceSettingsPopoverProps {
  disabled: boolean
  model: Accessor<SpeechModelID>
  onModelChange: (value: SpeechModelID) => void
  quality: Accessor<SpeechTranscriptionQuality>
  onQualityChange: (value: SpeechTranscriptionQuality) => void
  baseSilenceMs: Accessor<number>
  onBaseSilenceMsChange: (value: number) => void
  maxSilenceMs: Accessor<number>
  onMaxSilenceMsChange: (value: number) => void
  inputGain: Accessor<VoiceInputGain>
  onInputGainChange: (value: VoiceInputGain) => void
  dictionary: Accessor<string>
  onDictionaryChange: (value: string) => void
  corrections: Accessor<string>
  onCorrectionsChange: (value: string) => void
  vadSensitivity: Accessor<VoiceSettings["vadSensitivity"]>
  onVadSensitivityChange: (value: VoiceSettings["vadSensitivity"]) => void
  audioProcessing: Accessor<boolean>
  onAudioProcessingChange: (value: boolean) => void
  pressToTalkKeybind: Accessor<string>
  onPressToTalkKeybindChange: (value: string) => void
}

type VoiceSettingsView = "main" | "transcription" | "audio" | "vocabulary"

const qualityOptions = [
  {
    id: "fast",
    label: "Fast",
    description: "Uses the lighter local runtime for lower latency.",
  },
  {
    id: "accurate",
    label: "Accurate",
    description: "Uses a fuller local runtime for better recognition.",
  },
] satisfies Array<{
  id: SpeechTranscriptionQuality
  label: string
  description: string
}>

const inputGainOptions = [
  {
    id: "normal",
    label: "Normal",
    description: "No extra preamp. Best if your microphone already sounds loud enough.",
  },
  {
    id: "boost",
    label: "Boost",
    description: "Adds a strong input boost for quieter voices and farther mics.",
  },
  {
    id: "max",
    label: "Max",
    description: "Adds a very aggressive input boost. Best for very quiet microphones.",
  },
] satisfies Array<{
  id: VoiceInputGain
  label: string
  description: string
}>

const vadSensitivityOptions = [
  {
    id: "low",
    label: "Low",
    description: "Reduces false triggers in noisy rooms, but needs louder speech.",
  },
  {
    id: "normal",
    label: "Normal",
    description: "Balanced detection for most microphones and rooms.",
  },
  {
    id: "high",
    label: "High",
    description: "Starts listening sooner for quieter speech and more distance.",
  },
] satisfies Array<{
  id: VoiceSettings["vadSensitivity"]
  label: string
  description: string
}>

type SliderOption<T extends string> = {
  id: T
  label: string
  description: string
}

const autoSendDelayOptions = [
  {
    id: "short",
    label: "Short",
    description: "Sends sooner after a pause for quicker back-and-forth.",
    baseSilenceMs: 800,
    maxSilenceMs: 2200,
  },
  {
    id: "normal",
    label: "Normal",
    description: "More forgiving for natural pauses in the middle of a sentence.",
    baseSilenceMs: 1200,
    maxSilenceMs: 3200,
  },
  {
    id: "long",
    label: "Long",
    description: "Waits through long thinking pauses before sending. Best for dictating multi-part requests.",
    baseSilenceMs: 2600,
    maxSilenceMs: 8000,
  },
] satisfies Array<{
  id: "short" | "normal" | "long"
  label: string
  description: string
  baseSilenceMs: number
  maxSilenceMs: number
}>

function isModifier(key: string) {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
}

function normalizeKey(key: string) {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

function recordKeybind(event: KeyboardEvent) {
  if (isModifier(event.key)) return

  const parts: string[] = []
  const mod = IS_MAC ? event.metaKey : event.ctrlKey
  if (mod) parts.push("mod")
  if (IS_MAC && event.ctrlKey) parts.push("ctrl")
  if (!IS_MAC && event.metaKey) parts.push("meta")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey) parts.push("shift")

  const key = normalizeKey(event.key)
  if (!key) return
  parts.push(key)
  return parts.join("+")
}

function optionIndex<T extends string>(options: readonly SliderOption<T>[], value: T) {
  return Math.max(
    0,
    options.findIndex((item) => item.id === value),
  )
}

function SettingsSlider<T extends string>(props: {
  title: string
  description: string
  value: Accessor<T>
  options: readonly SliderOption<T>[]
  onChange: (value: T) => void
}) {
  const currentIndex = createMemo(() => optionIndex(props.options, props.value()))
  const current = createMemo(() => props.options[currentIndex()] ?? props.options[0])
  const progress = createMemo(() => {
    const max = Math.max(1, props.options.length - 1)
    return `${(currentIndex() / max) * 100}%`
  })

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-12-medium text-text-strong">{props.title}</div>
          <div class="text-11-regular text-text-weak">{props.description}</div>
        </div>
        <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-inset-base px-2 py-1 text-11-medium text-text-strong">
          {current()?.label}
        </div>
      </div>
      <input
        type="range"
        min="0"
        max={props.options.length - 1}
        step="1"
        value={currentIndex()}
        aria-label={props.title}
        data-component="voice-slider"
        style={{ "--voice-slider-progress": progress() }}
        onInput={(event) => {
          const index = Math.max(0, Math.min(props.options.length - 1, Number(event.currentTarget.value)))
          props.onChange(props.options[index].id)
        }}
      />
      <div class="grid grid-cols-3 text-[11px] leading-4 text-text-dim">
        <For each={props.options}>
          {(item, index) => (
            <button
              type="button"
              classList={{
                "text-left first:text-left last:text-right": true,
                "text-text-strong": item.id === props.value(),
              }}
              onClick={() => props.onChange(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div class="text-11-regular text-text-weak">{current()?.description}</div>
    </div>
  )
}

export function VoiceSettingsPopover(props: VoiceSettingsPopoverProps) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({
    open: false,
    installing: undefined as SpeechModelID | undefined,
    capturing: false,
    view: "main" as VoiceSettingsView,
  })
  const [models, actions] = createResource(
    () => props.quality(),
    async (quality) => {
      if (!platform.listSpeechModels) return fallbackModels
      return platform.listSpeechModels(quality)
    },
    { initialValue: fallbackModels },
  )

  const selected = createMemo(
    () => models.latest.find((item) => item.id === props.model()) ?? fallbackModels.find((item) => item.id === props.model()),
  )
  const autoSendDelay = createMemo(() => {
    if (props.maxSilenceMs() >= 4200 || props.baseSilenceMs() >= 1600) return autoSendDelayOptions[2]
    if (props.maxSilenceMs() >= 3200 || props.baseSilenceMs() >= 1200) return autoSendDelayOptions[1]
    return autoSendDelayOptions[0]
  })
  const pressToTalkDisplay = createMemo(() => {
    if (state.capturing) return "Press keys"
    return formatKeybind(props.pressToTalkKeybind(), language.t) || "Unassigned"
  })
  const viewTitle = createMemo(() => {
    if (state.view === "transcription") return "Transcription settings"
    if (state.view === "audio") return "Audio settings"
    if (state.view === "vocabulary") return "Vocabulary"
    return "Voice settings"
  })
  const viewDescription = createMemo(() => {
    if (state.view !== "main") return undefined
    return "Tune hands-free send, transcription models, mic behavior, and custom corrections."
  })
  const transcriptionSummary = createMemo(() => {
    const mode = props.quality() === "accurate" ? "Accurate" : "Fast"
    const model = selected()?.label ?? "No model selected"
    const downloaded = selected()?.downloaded ? "Downloaded" : "Needs download"
    return `${mode} mode with ${model}. ${downloaded}.`
  })
  const audioSummary = createMemo(() => {
    const sensitivity = vadSensitivityOptions.find((item) => item.id === props.vadSensitivity())?.label ?? "Normal"
    const gain = inputGainOptions.find((item) => item.id === props.inputGain())?.label ?? "Normal"
    return `${sensitivity} sensitivity, ${gain} boost, cleanup ${props.audioProcessing() ? "on" : "off"}.`
  })
  const vocabularySummary = createMemo(() => {
    const termCount = parseVoiceDictionary(props.dictionary()).length
    const correctionCount = parseVoiceCorrections(props.corrections()).length
    if (!termCount && !correctionCount) return "No custom terms or correction rules yet."
    return `${termCount} custom term${termCount === 1 ? "" : "s"} and ${correctionCount} correction rule${correctionCount === 1 ? "" : "s"}.`
  })

  const download = async () => {
    const info = selected()
    if (!info || !platform.installSpeechModel) return

    setState("installing", info.id)
    try {
      await platform.installSpeechModel(info.id, props.quality())
      showToast({
        title: "Voice model downloaded",
        description: `${info.label} is ready in ${props.quality() === "accurate" ? "Accurate" : "Fast"} mode.`,
        variant: "success",
        icon: "circle-check",
      })
      await actions.refetch()
    } catch (error) {
      showToast({
        title: "Couldn't download voice model",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
        icon: "warning",
      })
    } finally {
      setState("installing", undefined)
    }
  }

  function stopCapture() {
    setState("capturing", false)
  }

  function setView(view: VoiceSettingsView) {
    stopCapture()
    setState("view", view)
  }

  if (typeof document !== "undefined") {
    makeEventListener(
      document,
      "keydown",
      (event) => {
        if (!state.capturing) return

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()

        if (event.key === "Escape") {
          stopCapture()
          return
        }

        const clear =
          (event.key === "Backspace" || event.key === "Delete") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey
        if (clear) {
          props.onPressToTalkKeybindChange("none")
          stopCapture()
          return
        }

        const next = recordKeybind(event)
        if (!next) return
        props.onPressToTalkKeybindChange(next)
        stopCapture()
      },
      { capture: true },
    )
  }

  onCleanup(stopCapture)

  return (
    <Popover
      open={state.open}
      onOpenChange={(value) => {
        setState("open", value)
        if (!value) {
          stopCapture()
          setState("view", "main")
          return
        }
        setState("view", "main")
        void actions.refetch()
      }}
      triggerAs={IconButton}
      triggerProps={{
        icon: "settings-gear",
        variant: "ghost",
        size: "small",
        class: "size-7",
        "aria-label": "Voice settings",
        disabled: props.disabled,
      }}
      title={
        <div class="flex min-w-0 items-center gap-1">
          <Show when={state.view !== "main"}>
            <IconButton
              icon="arrow-left"
              size="small"
              variant="ghost"
              aria-label={language.t("common.goBack")}
              onClick={() => setView("main")}
            />
          </Show>
          <span class="truncate">{viewTitle()}</span>
        </div>
      }
      description={viewDescription()}
      class="w-[360px] max-w-[calc(100vw-24px)]"
      placement="top-end"
    >
      <div class="flex max-h-[min(72vh,640px)] flex-col gap-3 overflow-y-auto pr-1">
        <Switch>
          <Match when={state.view === "main"}>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="text-12-medium text-text-strong">Pause before send</div>
                <div class="text-11-regular text-text-weak">
                  Longer delay waits through more natural pauses before voice sends automatically.
                </div>
                <RadioGroup
                  options={autoSendDelayOptions}
                  current={autoSendDelay()}
                  value={(item) => item.id}
                  label={(item) => item.label}
                  onSelect={(item) => {
                    if (!item) return
                    props.onBaseSilenceMsChange(item.baseSilenceMs)
                    props.onMaxSilenceMsChange(item.maxSilenceMs)
                  }}
                  fill
                />
              </div>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3 text-left transition-colors hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active"
                onClick={() => setView("transcription")}
              >
                <div class="min-w-0 flex-1">
                  <div class="text-12-medium text-text-strong">Transcription settings</div>
                  <div class="text-11-regular text-text-weak">{transcriptionSummary()}</div>
                </div>
                <Icon name="chevron-right" size="small" />
              </button>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3 text-left transition-colors hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active"
                onClick={() => setView("audio")}
              >
                <div class="min-w-0 flex-1">
                  <div class="text-12-medium text-text-strong">Audio settings</div>
                  <div class="text-11-regular text-text-weak">{audioSummary()}</div>
                </div>
                <Icon name="chevron-right" size="small" />
              </button>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3 text-left transition-colors hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active"
                onClick={() => setView("vocabulary")}
              >
                <div class="min-w-0 flex-1">
                  <div class="text-12-medium text-text-strong">Vocabulary and corrections</div>
                  <div class="text-11-regular text-text-weak">{vocabularySummary()}</div>
                </div>
                <Icon name="chevron-right" size="small" />
              </button>
            </div>
          </Match>
          <Match when={state.view === "transcription"}>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="text-12-medium text-text-strong">Transcription mode</div>
                <div class="text-11-regular text-text-weak">
                  Fast is lower latency. Accurate is slower but can catch more words.
                </div>
                <RadioGroup
                  options={qualityOptions}
                  current={qualityOptions.find((item) => item.id === props.quality())}
                  value={(item) => item.id}
                  label={(item) => item.label}
                  onSelect={(item) => item && props.onQualityChange(item.id)}
                  fill
                />
              </div>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-12-medium text-text-strong">Model</span>
                  <Show when={selected()?.recommended}>
                    <span class="rounded-full bg-surface-base px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-dim">
                      Recommended
                    </span>
                  </Show>
                </div>
                <RadioGroup
                  options={models.latest}
                  current={selected()}
                  value={(item) => item.id}
                  label={(item) => item.label.replace("Parakeet ", "")}
                  onSelect={(item) => item && props.onModelChange(item.id)}
                  fill
                />
              </div>
              <Show when={selected()}>
                {(info) => (
                  <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                    <div class="flex items-start gap-2">
                      <div class="pt-0.5 text-text-dim">
                        <Icon
                          name={info().downloaded ? "circle-check" : state.installing === info().id ? "download" : "warning"}
                          size="small"
                        />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-12-medium text-text-strong">
                          {state.installing === info().id
                            ? `Downloading ${info().label}...`
                            : info().downloaded
                              ? `${info().label} is downloaded`
                              : `${info().label} is not downloaded`}
                        </div>
                        <div class="text-11-regular text-text-weak">{info().description}</div>
                      </div>
                    </div>
                    <Show when={info().downloaded && info().path}>
                      <div class="rounded-md bg-surface-inset-base px-2 py-1 text-[11px] leading-4 break-all text-text-dim">
                        {info().path}
                      </div>
                    </Show>
                    <Show when={!info().downloaded}>
                      <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        icon="download"
                        disabled={!!state.installing || !platform.installSpeechModel}
                        onClick={download}
                      >
                        {state.installing === info().id ? "Downloading..." : "Download model"}
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
              <p class="text-11-regular leading-4 text-text-weak">
                Download the selected model for the current mode before turning on the microphone.
              </p>
            </div>
          </Match>
          <Match when={state.view === "audio"}>
            <div class="flex flex-col gap-3">
              <SettingsSlider
                title="Mic sensitivity"
                description="Higher sensitivity starts capture more easily when your voice is quiet or you are farther from the mic."
                options={vadSensitivityOptions}
                value={props.vadSensitivity}
                onChange={props.onVadSensitivityChange}
              />
              <SettingsSlider
                title="Mic boost"
                description="Boost raises the captured input level before transcription."
                options={inputGainOptions}
                value={props.inputGain}
                onChange={props.onInputGainChange}
              />
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="text-12-medium text-text-strong">Audio cleanup</div>
                    <div class="text-11-regular text-text-weak">
                      {props.audioProcessing()
                        ? "Browser echo cancellation, noise suppression, and gain control are on."
                        : "Raw microphone capture is on. This can help if cleanup is distorting speech."}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={props.audioProcessing()}
                    classList={{
                      "h-8 min-w-[64px] rounded-md px-3 text-12-regular": true,
                      "bg-surface-base text-text-subtle hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active":
                        !props.audioProcessing(),
                      "border border-border-weak-base bg-surface-inset-base text-text-strong": props.audioProcessing(),
                    }}
                    onClick={() => props.onAudioProcessingChange(!props.audioProcessing())}
                  >
                    {props.audioProcessing() ? "On" : "Off"}
                  </button>
                </div>
              </div>
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="text-12-medium text-text-strong">Press-to-talk</div>
                    <div class="text-11-regular text-text-weak">Hold this shortcut while the mic is off to transcribe.</div>
                  </div>
                  <button
                    type="button"
                    data-voice-ptt-capture="true"
                    classList={{
                      "h-8 min-w-[88px] rounded-md px-3 text-12-regular": true,
                      "border border-border-weak-base bg-surface-inset-base text-text-weak": state.capturing,
                      "bg-surface-base text-text-subtle hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active":
                        !state.capturing,
                    }}
                    onClick={() => setState("capturing", !state.capturing)}
                  >
                    {pressToTalkDisplay()}
                  </button>
                </div>
                <div class="text-[11px] leading-4 text-text-dim">Press `Esc` to cancel or `Backspace` to clear.</div>
              </div>
            </div>
          </Match>
          <Match when={state.view === "vocabulary"}>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="text-12-medium text-text-strong">Custom terms</div>
                <div class="text-11-regular text-text-weak">
                  Add names or technical words to preserve preferred casing. Separate entries with commas or new lines.
                </div>
                <textarea
                  rows={4}
                  value={props.dictionary()}
                  placeholder={"OpenAI\nWhisperKit\nTypeScript"}
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                  class="w-full resize-y rounded-md border border-border-weak-base bg-surface-inset-base px-3 py-2 text-12-regular text-text-strong outline-none focus:outline-none placeholder:text-text-dim"
                  onInput={(event) => props.onDictionaryChange(event.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
                <div class="text-12-medium text-text-strong">Corrections</div>
                <div class="text-11-regular text-text-weak">
                  Fix recurring substitutions with one rule per line, like `codax =&gt; Codex`.
                </div>
                <textarea
                  rows={4}
                  value={props.corrections()}
                  placeholder={"codax => Codex\nopen agent => OpenAgent"}
                  spellcheck={false}
                  autocorrect="off"
                  autocapitalize="off"
                  class="w-full resize-y rounded-md border border-border-weak-base bg-surface-inset-base px-3 py-2 text-12-regular text-text-strong outline-none focus:outline-none placeholder:text-text-dim"
                  onInput={(event) => props.onCorrectionsChange(event.currentTarget.value)}
                />
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </Popover>
  )
}
