import { Button } from "@openagent-ai/ui/button"
import { Checkbox } from "@openagent-ai/ui/checkbox"
import { useDialog } from "@openagent-ai/ui/context/dialog"
import { Dialog } from "@openagent-ai/ui/dialog"
import { createSignal, Show } from "solid-js"
import { DialogConnectProvider } from "@/components/dialog-connect-provider"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

type Reason = "free_tier_limit" | "account_rate_limit"

type UsageExceededAction = {
  reason: Reason
  title?: string
  message?: string
  label?: string
  link?: string
}

export function DialogUsageExceeded(props: { action: UsageExceededAction; onDontShowAgain: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const [dontShowAgain, setDontShowAgain] = createSignal(false)

  const title = () =>
    props.action.title ||
    language.t(
      props.action.reason === "free_tier_limit"
        ? "session.usageExceeded.free.title"
        : "session.usageExceeded.rate.title",
    )

  const message = () =>
    props.action.message ||
    language.t(
      props.action.reason === "free_tier_limit"
        ? "session.usageExceeded.free.message"
        : "session.usageExceeded.rate.message",
    )

  const label = () =>
    props.action.label ||
    language.t(
      props.action.reason === "free_tier_limit"
        ? "session.usageExceeded.free.action"
        : "session.usageExceeded.rate.action",
    )

  const close = () => {
    if (dontShowAgain()) props.onDontShowAgain()
    dialog.close()
  }

  const primary = () => {
    if (dontShowAgain()) props.onDontShowAgain()
    if (props.action.reason === "free_tier_limit") {
      dialog.show(() => <DialogConnectProvider provider="opencode-go" />)
      return
    }

    if (props.action.link) platform.openLink(props.action.link)
    dialog.close()
  }

  return (
    <Dialog title={title()} fit>
      <div class="flex flex-col gap-5 px-1.5 pb-1.5">
        <div class="text-14-regular text-text-base leading-normal whitespace-pre-wrap">{message()}</div>
        <Checkbox checked={dontShowAgain()} onChange={setDontShowAgain}>
          {language.t("session.usageExceeded.dontShowAgain")}
        </Checkbox>
        <div class="flex items-center justify-end gap-2">
          <Button variant="ghost" size="large" onClick={close}>
            {language.t("ui.common.dismiss")}
          </Button>
          <Show when={props.action.reason === "free_tier_limit" || props.action.link}>
            <Button variant="primary" size="large" onClick={primary}>
              {label()}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
