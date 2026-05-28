import type { Config } from "@/config/config"

export const openswarmAgents = [
  "deep-research",
  "data-analyst",
  "slides-agent",
  "docs-agent",
  "image-generation-agent",
  "video-generation-agent",
] as const

export const sendMessageAgents = ["general", ...openswarmAgents] as const

export type CommunicationMode = "send_message"
export type Flow = {
  from: string
  to: string
  modes: CommunicationMode[]
}

export function defaultFlows(): Flow[] {
  const sendMessage = [...sendMessageAgents].map((to) => ({
    from: "assistant",
    to,
    modes: ["send_message" as const],
  }))
  return sendMessage
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
