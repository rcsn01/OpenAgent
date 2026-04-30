import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Accessor } from "solid-js"
import { usePlatform, type SpeechModelID, type SpeechModelInfo } from "@/context/platform"

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
] as const

interface VoiceSettingsPopoverProps {
  disabled: boolean
  model: Accessor<SpeechModelID>
  onModelChange: (value: SpeechModelID) => void
}

export function VoiceSettingsPopover(props: VoiceSettingsPopoverProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({
    open: false,
    installing: undefined as SpeechModelID | undefined,
  })
  const [models, actions] = createResource(
    async () => {
      if (!platform.listSpeechModels) return fallbackModels
      return platform.listSpeechModels()
    },
    { initialValue: fallbackModels },
  )

  const selected = createMemo(
    () => models.latest.find((item) => item.id === props.model()) ?? fallbackModels.find((item) => item.id === props.model()),
  )

  const download = async () => {
    const info = selected()
    if (!info || !platform.installSpeechModel) return

    setState("installing", info.id)
    try {
      await platform.installSpeechModel(info.id)
      showToast({
        title: "Voice model downloaded",
        description: `${info.label} is ready to use locally.`,
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

  return (
    <Popover
      open={state.open}
      onOpenChange={(value) => {
        setState("open", value)
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
      description="Choose which local Parakeet model the microphone uses."
      class="w-[320px] max-w-[calc(100vw-32px)]"
      placement="top-end"
    >
      <div class="flex flex-col gap-3">
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
                <div class="rounded-md bg-surface-inset-base px-2 py-1 text-[11px] leading-4 text-text-dim break-all">
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
          Download the selected model here before turning on the microphone.
        </p>
      </div>
    </Popover>
  )
}
