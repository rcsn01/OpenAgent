import type { Config } from "@/config/config"

export const openswarmAgents = [
  "virtual-assistant",
  "deep-research",
  "data-analyst",
  "slides-agent",
  "docs-agent",
  "image-generation-agent",
  "video-generation-agent",
] as const

export type CommunicationMode = "send_message" | "transfer"
export type Flow = {
  from: string
  to: string
  modes: CommunicationMode[]
}

export function defaultFlows(): Flow[] {
  const recipients = [...openswarmAgents]
  const sendMessage = recipients.map((to) => ({
    from: "assistant",
    to,
    modes: ["send_message" as const],
  }))
  const transfer = recipients.map((to) => ({
    from: "assistant",
    to,
    modes: ["transfer" as const],
  }))
  return [...sendMessage, ...transfer]
}

export function flows(cfg: Pick<Config.Info, "agent_communication">): Flow[] {
  const configured = cfg.agent_communication?.flows
  if (!configured?.length) return defaultFlows()
  return configured.map((flow) => ({
    from: flow.from,
    to: flow.to,
    modes: [...flow.modes],
  }))
}

export function allowedRecipients(
  cfg: Pick<Config.Info, "agent_communication">,
  from: string,
  mode: CommunicationMode,
) {
  return flows(cfg)
    .filter((flow) => flow.from === from && flow.modes.includes(mode))
    .map((flow) => flow.to)
    .toSorted((a, b) => a.localeCompare(b))
}

export function isAllowed(
  cfg: Pick<Config.Info, "agent_communication">,
  from: string,
  to: string,
  mode: CommunicationMode,
) {
  return flows(cfg).some((flow) => flow.from === from && flow.to === to && flow.modes.includes(mode))
}

export function isOpenSwarmAgent(agent: string) {
  return (openswarmAgents as readonly string[]).includes(agent)
}
