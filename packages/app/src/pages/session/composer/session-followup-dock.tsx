import { For, Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { buildFollowupDockModel, type FollowupDockItem } from "./session-followup-dock-model"

export function SessionFollowupDock(props: {
  items: FollowupDockItem[]
  sending?: string
  autoSendPaused?: boolean
  onSend: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  onToggleAutoSend: () => void
}) {
  const language = useLanguage()
  const model = createMemo(() => buildFollowupDockModel(props.items))
  const total = createMemo(() => model().total)
  const items = createMemo(() => model().items)

  const QueueRow = (item: { id: string; text: string }, index: number) => (
    <div class="flex items-center gap-2 min-w-0 px-3 py-2">
      <div class="min-w-0 flex-1 flex items-center gap-2">
        <Show when={index === 0}>
          <Icon name="arrow-undo-down" size="small" class="shrink-0 text-icon-weak" />
        </Show>
        <span
          class="min-w-0 flex-1 truncate text-14-regular"
          classList={{
            "text-text-strong": index === 0,
            "text-text-base": index !== 0,
          }}
        >
          {item.text}
        </span>
      </div>
      <Button
        size="small"
        variant="ghost"
        class="shrink-0 gap-1.5 text-text-weak hover:text-text-strong"
        disabled={!!props.sending}
        onClick={() => props.onSend(item.id)}
      >
        <Icon name="arrow-undo-down" size="small" />
        {language.t("session.followupDock.steer")}
      </Button>
      <Tooltip value={language.t("session.followupDock.delete")}>
        <IconButton
          icon="trash"
          variant="ghost"
          size="small"
          class="shrink-0 text-icon-weak hover:text-text-danger-base"
          disabled={!!props.sending}
          onClick={() => props.onDelete(item.id)}
          aria-label={language.t("session.followupDock.delete")}
        />
      </Tooltip>
      <div class="shrink-0" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={IconButton}
            icon="dot-grid"
            variant="ghost"
            size="small"
            class="text-icon-weak"
            aria-label={language.t("session.followupDock.actions")}
            disabled={!!props.sending}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content style={{ "min-width": "156px" }}>
              <DropdownMenu.Item onSelect={() => props.onEdit(item.id)}>
                <DropdownMenu.ItemLabel>{language.t("session.followupDock.edit")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={props.onToggleAutoSend}>
                <DropdownMenu.ItemLabel>
                  {props.autoSendPaused
                    ? language.t("session.followupDock.turnOnAutoSend")
                    : language.t("session.followupDock.turnOffAutoSend")}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div class="px-3 py-2.5 border-b border-border-weaker-base">
        <div class="flex items-center gap-2 text-12-medium text-text-weak">
          <Icon name="arrow-undo-down" size="small" class="text-icon-weak" />
          <span>{language.t("session.followupDock.queued")}</span>
          <Show when={total() > 1}>
            <span class="text-text-weaker">
              {language.t("session.followupDock.summary.other", {
                count: total(),
              })}
            </span>
          </Show>
          <span class="ml-auto text-12-regular text-text-weaker">
            {props.autoSendPaused
              ? language.t("session.followupDock.autoSendOff")
              : language.t("session.followupDock.autoSend")}
          </span>
        </div>
      </div>

      <div class="max-h-44 overflow-y-auto no-scrollbar divide-y divide-border-weaker-base">
        <For each={items()}>{(item, index) => QueueRow(item, index())}</For>
      </div>

      <div class="h-5" aria-hidden="true" />
    </DockTray>
  )
}
