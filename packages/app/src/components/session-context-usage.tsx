import { Match, Show, Switch, createMemo } from "solid-js"
import { Tooltip, TooltipKeybind, type TooltipProps } from "@openagent/ui/tooltip"
import { ProgressCircle } from "@openagent/ui/progress-circle"
import { Button } from "@openagent/ui/button"
import { Icon } from "@openagent/ui/icon"

import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: TooltipProps["placement"]
  tooltip?: "usage" | "label"
  class?: string
  keybind?: string
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const language = useLanguage()
  const providers = useProviders()
  const { params, view } = useSessionLayout()

  const variant = createMemo(() => props.variant ?? "button")
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() => getSessionContextMetrics(messages(), providers.all()))
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => {
    return usd().format(metrics().totalCost)
  })

  const openContext = () => {
    if (!params.id) return
    view().context.toggle()
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.usage ?? 0} />
    </div>
  )

  const sessionInfoIcon = () => (
    <Icon
      name="pin"
      size="small"
      classList={{
        "text-icon-strong": view().context.opened(),
        "text-icon-weak": !view().context.opened(),
      }}
    />
  )

  const tooltipValue = () => (
    <div>
      <Show when={context()}>
        {(ctx) => (
          <>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().total.toLocaleString(language.intl())}</span>
              <span class="text-text-invert-base">{language.t("context.usage.tokens")}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
              <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
            </div>
          </>
        )}
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
      </div>
    </div>
  )

  const content = () => (
    <Switch>
      <Match when={variant() === "indicator"}>{circle()}</Match>
      <Match when={true}>
        <Button
          type="button"
          variant="ghost"
          class={`size-6 ${props.class ?? ""}`}
          classList={{
            "bg-surface-base-active": view().context.opened(),
          }}
          onClick={openContext}
          aria-label={language.t("context.usage.view")}
          aria-expanded={view().context.opened()}
          aria-controls="context-panel"
          disabled={!params.id}
        >
          {sessionInfoIcon()}
        </Button>
      </Match>
    </Switch>
  )

  const tooltipContent = () => (props.tooltip === "label" ? language.t("context.usage.view") : tooltipValue())

  return (
    <Show
      when={props.keybind && variant() === "button" ? props.keybind : undefined}
      fallback={
        <Tooltip value={tooltipContent()} placement={props.placement ?? "top"}>
          {content()}
        </Tooltip>
      }
    >
      {(keybind) => (
        <TooltipKeybind title={language.t("context.usage.view")} keybind={keybind()} placement={props.placement ?? "top"}>
          {content()}
        </TooltipKeybind>
      )}
    </Show>
  )
}
