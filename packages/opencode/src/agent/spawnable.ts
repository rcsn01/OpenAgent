export const blockedSpawnAgentNames = new Set(["build", "plan", "assistant", "chat", "orchestrator"])

export function isSpawnableAgent(agent: { name: string; mode: string }) {
  return agent.mode === "subagent" && !blockedSpawnAgentNames.has(agent.name)
}

export function spawnableAgentError(name: string) {
  return new Error(
    `Agent "${name}" cannot be spawned as a subagent. Use one of the registered subagent specialists instead.`,
  )
}
