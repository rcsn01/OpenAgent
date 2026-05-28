export const blockedSpawnAgentNames = new Set(["build", "plan", "assistant", "chat", "orchestrator"])

export const openAgentFeatureAgentNames = new Set([
  "deep-research",
  "data-analyst",
  "slides-agent",
  "docs-agent",
  "image-generation-agent",
  "video-generation-agent",
])

export function isSpawnableAgent(agent: { name: string; mode: string }) {
  return agent.mode === "subagent" && !blockedSpawnAgentNames.has(agent.name)
}

export function isSpawnableAgentForCaller(caller: string, agent: { name: string; mode: string }) {
  if (!isSpawnableAgent(agent)) return false
  if (caller !== "assistant" && openAgentFeatureAgentNames.has(agent.name)) return false
  return true
}

export function spawnableAgentError(name: string) {
  return new Error(
    `Agent "${name}" cannot be spawned as a subagent. Use one of the registered subagent specialists instead.`,
  )
}
