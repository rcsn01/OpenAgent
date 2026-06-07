import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@openagent/ui/button"
import { Icon } from "@openagent/ui/icon"
import { IconButton } from "@openagent/ui/icon-button"
import { RadioGroup } from "@openagent/ui/radio-group"
import { showToast } from "@openagent/ui/toast"
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Accessor } from "solid-js"
import { formatKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import type { VoiceInputGain, VoiceSettings } from "@/context/settings"
import {
  usePlatform,
  type SpeechModelID,
  type SpeechModelInfo,
  type SpeechTranscriptionQuality,
} from "@/context/platform"

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

interface VoiceSettingsPanelProps {
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
  onClose?: () => void
}

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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function formatInputGain(value: number) {
  return `${value.toFixed(1)}x`
}

function NumericSettingsSlider(props: {
  title: string
  description: string
  value: Accessor<number>
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  const value = createMemo(() => clampNumber(props.value(), props.min, props.max))
  const progress = createMemo(() => {
    const span = props.max - props.min || 1
    return `${((value() - props.min) / span) * 100}%`
  })

  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-surface-base p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-12-medium text-text-strong">{props.title}</div>
          <div class="text-11-regular text-text-weak">{props.description}</div>
        </div>
        <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-inset-base px-2 py-1 text-11-medium text-text-strong">
          {props.format(value())}
        </div>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={value()}
        aria-label={props.title}
        data-component="voice-slider"
        style={{ "--voice-slider-progress": progress() }}
        onInput={(event) => {
          props.onChange(clampNumber(Number(event.currentTarget.value), props.min, props.max))
        }}
      />
    </div>
  )
}

function VoiceLevelMeter(props: { audioProcessing: Accessor<boolean>; inputGain: Accessor<number> }) {
  const [level, setLevel] = createSignal(0)
  const [status, setStatus] = createSignal<"starting" | "ready" | "unavailable">("starting")
  const progress = createMemo(() => `${Math.round(level())}%`)

  createEffect(() => {
    const audioProcessing = props.audioProcessing()
    let disposed = false
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let source: MediaStreamAudioSourceNode | undefined
    let analyser: AnalyserNode | undefined
    let buffer: Uint8Array<ArrayBuffer> | undefined
    let animationFrame = 0

    const cleanup = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      animationFrame = 0

      try {
        source?.disconnect()
      } catch {}
      source = undefined

      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
        stream = undefined
      }

      if (context) {
        void context.close().catch(() => undefined)
        context = undefined
      }

      analyser = undefined
      buffer = undefined
    }

    setStatus("starting")
    setLevel(0)

    void (async () => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioContext === "undefined"
      ) {
        setStatus("unavailable")
        return
      }

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: audioProcessing
            ? {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
              }
            : {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
              },
        })

        if (disposed) {
          nextStream.getTracks().forEach((track) => track.stop())
          return
        }

        stream = nextStream
        context = new AudioContext()
        if (context.state === "suspended") await context.resume().catch(() => undefined)
        if (disposed || !context) {
          cleanup()
          return
        }

        analyser = context.createAnalyser()
        analyser.fftSize = 2048
        buffer = new Uint8Array<ArrayBuffer>(new ArrayBuffer(analyser.fftSize))
        source = context.createMediaStreamSource(stream)
        source.connect(analyser)
        setStatus("ready")

        const step = () => {
          if (disposed || !analyser || !buffer) return

          analyser.getByteTimeDomainData(buffer)
          let total = 0
          for (const sample of buffer) {
            const normalized = (sample - 128) / 128
            total += normalized * normalized
          }

          const rms = Math.sqrt(total / buffer.length)
          const boostedRms = clampNumber(rms * clampNumber(props.inputGain(), 1, 6), 0, 1)
          const nextLevel = clampNumber(Math.sqrt(boostedRms) * 260, 0, 100)
          setLevel((current) => current * 0.65 + nextLevel * 0.35)
          animationFrame = requestAnimationFrame(step)
        }

        animationFrame = requestAnimationFrame(step)
      } catch {
        if (disposed) return
        cleanup()
        setLevel(0)
        setStatus("unavailable")
      }
    })()

    onCleanup(() => {
      disposed = true
      cleanup()
    })
  })

  return (
    <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong">Mic level</div>
          <div class="text-11-regular text-text-weak">
            {status() === "unavailable" ? "Microphone input is unavailable." : "Live input level from your microphone."}
          </div>
        </div>
        <div class="shrink-0 rounded-md border border-border-weak-base bg-surface-inset-base px-2 py-1 text-11-medium text-text-strong">
          {status() === "starting" ? "Starting" : progress()}
        </div>
      </div>
      <div data-component="voice-level-meter" aria-hidden="true" style={{ "--voice-level": progress() }}>
        <div data-slot="bar" />
      </div>
    </div>
  )
}

export function VoiceSettingsPanel(props: VoiceSettingsPanelProps) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({
    open: false,
    installing: undefined as SpeechModelID | undefined,
    capturing: false,
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
    () =>
      models.latest.find((item) => item.id === props.model()) ??
      fallbackModels.find((item) => item.id === props.model()),
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

  createEffect(() => {
    if (!state.open) {
      setState("open", true)
      void actions.refetch()
    }
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background-base">
      <div class="flex shrink-0 items-start justify-between gap-4 border-b border-border-weak-base px-6 py-4">
        <div class="min-w-0">
          <div class="text-16-medium text-text-strong">Voice settings</div>
          <div class="text-13-regular text-text-weak">Tune capture, transcription, and vocabulary.</div>
        </div>
        <Show when={props.onClose}>
          <IconButton
            icon="close"
            size="small"
            variant="ghost"
            aria-label="Close voice settings"
            onClick={() => {
              stopCapture()
              props.onClose?.()
            }}
          />
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div class="mx-auto flex w-full max-w-[560px] flex-col gap-3">
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
                      name={
                        info().downloaded ? "circle-check" : state.installing === info().id ? "download" : "warning"
                      }
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

          <NumericSettingsSlider
            title="Mic sensitivity"
            description="Higher sensitivity starts capture more easily when your voice is quiet or you are farther from the mic."
            value={props.vadSensitivity}
            min={0}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)}%`}
            onChange={props.onVadSensitivityChange}
          />

          <NumericSettingsSlider
            title="Mic boost"
            description="Adjust microphone preamp."
            value={props.inputGain}
            min={1}
            max={6}
            step={0.1}
            format={formatInputGain}
            onChange={props.onInputGainChange}
          />

          <VoiceLevelMeter audioProcessing={props.audioProcessing} inputGain={props.inputGain} />

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
      </div>
    </div>
  )
}
