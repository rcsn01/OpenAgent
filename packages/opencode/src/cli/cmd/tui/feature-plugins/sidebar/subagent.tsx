import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { tint } from "@tui/context/theme"
import { SubagentGraphScreen } from "@tui/routes/session/subagent-graph"
import * as Locale from "@/util/locale"

const id = "internal:sidebar-subagent"
const graphRoute = `${id}:graph`
type SidebarPart = ReturnType<TuiPluginApi["state"]["part"]>[number]

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

function executionMode(part: SidebarPart) {
  if (part.type === "tool" && (part.tool === "task" || part.tool === "background_task")) {
    const metadata = part.state.status === "pending" ? undefined : part.state.metadata
    if (metadata?.executionMode === "blocking" || metadata?.executionMode === "background") {
      return metadata.executionMode
    }
    if (part.tool === "background_task") return "background"
    return "blocking"
  }
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

function rowBackground(
  api: TuiPluginApi,
  mode: "blocking" | "background" | undefined,
  status: ReturnType<TuiPluginApi["state"]["session"]["status"]>,
) {
  if (mode !== "blocking") return undefined
  if (status?.type === "busy" || status?.type === "retry") return tint(api.theme.current.backgroundPanel, api.theme.current.warning, 0.2)
  return tint(api.theme.current.backgroundPanel, api.theme.current.success, 0.2)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const current = createMemo(() => props.api.state.session.get(props.session_id))
  const rootID = createMemo(() => {
    const session = current()
    return session?.parentID ?? session?.id
  })
  const list = createMemo(() => {
    const id = rootID()
    if (!id) return []

    return props.api.state.session
      .list()
      .filter((item) => item.parentID === id)
      .toSorted((a, b) => a.time.created - b.time.created)
  })
  const rootTaskModes = createMemo(() => {
    const id = rootID()
    if (!id) return new Map<string, "blocking" | "background">()

    return props.api.state.session.messages(id).reduce((acc, message) => {
      props.api.state.part(message.id).forEach((part) => {
        const mode = executionMode(part)
        if (part.type !== "tool" || !mode) return
        const metadata = part.state.status === "pending" ? undefined : part.state.metadata
        if (typeof metadata?.sessionId !== "string") return
        acc.set(metadata.sessionId, mode)
      })
      return acc
    }, new Map<string, "blocking" | "background">())
  })

  const sessionMode = (sessionID: string) => {
    const direct = rootTaskModes().get(sessionID)
    return direct
  }

  const openGraph = () => {
    props.api.route.navigate(graphRoute, { sessionID: props.session_id })
  }

  return (
    <box>
      <box onMouseUp={openGraph}>
        <text fg={theme().text}>
          <b>Subagent</b>
          <Show when={list().length > 0}>
            <span style={{ fg: theme().textMuted }}> ({list().length})</span>
          </Show>
          <span style={{ fg: theme().primary }}> · inspect graphs</span>
        </text>
      </box>

      <Show when={list().length > 0} fallback={<text fg={theme().textMuted}>Subagent sessions will appear here</text>}>
        <For each={list()}>
          {(item) => {
            const status = () => props.api.state.session.status(item.id)
            const mode = () => sessionMode(item.id)
            return (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={rowBackground(props.api, mode(), status())}
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
          {props.api.tuiConfig.keybinds
            .get("session.child.first")
            .map((binding) => props.api.keys.formatSequence(Array.from(props.api.keymap.parseKeySequence(binding.key))))
            .filter(Boolean)
            .join(", ")}{" "}
          open first · click to inspect
        </text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const unregisterRoute = api.route.register([
    {
      name: graphRoute,
      render: ({ params }) =>
        typeof params?.sessionID === "string" ? (
          <SubagentGraphScreen sessionID={params.sessionID} />
        ) : (
          <box paddingLeft={2} paddingRight={2} paddingTop={1}>
            <text fg={api.theme.current.error}>Missing session ID for subagent graph view</text>
          </box>
        ),
    },
  ])
  api.lifecycle.onDispose(unregisterRoute)

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
