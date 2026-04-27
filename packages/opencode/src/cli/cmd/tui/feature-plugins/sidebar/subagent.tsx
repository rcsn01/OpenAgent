import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { Locale } from "@/util"

const id = "internal:sidebar-subagent"

function agentLabel(title: string) {
  const match = title.match(/@([^)]+?)\s+subagent/i)
  if (!match) return "Subagent"
  return Locale.titlecase(match[1].trim())
}

function taskLabel(title: string) {
  const value = title.replace(/\s+\(@[^)]+ subagent\)$/i, "").trim()
  if (value) return value
  return agentLabel(title)
}

function statusLabel(status: ReturnType<TuiPluginApi["state"]["session"]["status"]>) {
  if (status?.type === "busy") return "Running"
  if (status?.type === "retry") return "Retrying"
  return "Ready"
}

function statusColor(api: TuiPluginApi, status: ReturnType<TuiPluginApi["state"]["session"]["status"]>) {
  if (status?.type === "busy") return api.theme.current.warning
  if (status?.type === "retry") return api.theme.current.warning
  return api.theme.current.success
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const current = createMemo(() => props.api.state.session.get(props.session_id))
  const list = createMemo(() => {
    const session = current()
    const rootID = session?.parentID ?? session?.id
    if (!rootID) return []

    return props.api.state.session
      .list()
      .filter((item) => item.parentID === rootID)
      .toSorted((a, b) => a.time.created - b.time.created)
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Subagent</b>
        <Show when={list().length > 0}>
          <span style={{ fg: theme().textMuted }}> ({list().length})</span>
        </Show>
      </text>

      <Show when={list().length > 0} fallback={<text fg={theme().textMuted}>Subagent sessions will appear here</text>}>
        <For each={list()}>
          {(item) => {
            const status = () => props.api.state.session.status(item.id)
            return (
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => props.api.route.navigate("session", { sessionID: item.id })}
              >
                <text flexShrink={0} style={{ fg: statusColor(props.api, status()) }}>
                  •
                </text>
                <box>
                  <text fg={theme().text} wrapMode="word">
                    {taskLabel(item.title)}
                  </text>
                  <text fg={theme().textMuted} wrapMode="word">
                    {agentLabel(item.title)} · {statusLabel(status())}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
        <text fg={theme().textMuted} wrapMode="word">
          {props.api.keybind.print("session_child_first")} open first · click to inspect
        </text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_fill_bottom(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin