import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createResource, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Accessor } from "solid-js"
import { formatKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform, type SpeechModelID, type SpeechModelInfo, type SpeechTranscriptionQuality } from "@/context/platform"

const fallbackModels: SpeechModelInfo[] = [
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
  audioProcessing: Accessor<boolean>
  onAudioProcessingChange: (value: boolean) => void
  pressToTalkKeybind: Accessor<string>
  onPressToTalkKeybindChange: (value: string) => void
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

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

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

export function VoiceSettingsPopover(props: VoiceSettingsPopoverProps) {
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
    () => models.latest.find((item) => item.id === props.model()) ?? fallbackModels.find((item) => item.id === props.model()),
  )
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

  const stopCapture = () => {
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

  return (
    <Popover
      open={state.open}
      onOpenChange={(value) => {
        setState("open", value)
        if (!value) stopCapture()
        if (value) void actions.refetch()
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
      title="Voice settings"
      description="Choose model quality, audio cleanup, and your press-to-talk shortcut."
      class="w-[320px] max-w-[calc(100vw-32px)]"
      placement="top-end"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-surface-base p-3">
          <div class="text-12-medium text-text-strong">Transcription mode</div>
          <div class="text-11-regular text-text-weak">Fast is lower latency. Accurate is slower but can catch more words.</div>
          <RadioGroup
            options={qualityOptions}
            current={qualityOptions.find((item) => item.id === props.quality())}
            value={(item) => item.id}
            label={(item) => item.label}
            onSelect={(item) => item && props.onQualityChange(item.id)}
            fill
          />
        </div>
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
    </Popover>
  )
}
