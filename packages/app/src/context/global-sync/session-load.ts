import type { Session } from "@openagent-ai/sdk/v2/client"
import type { RootLoadArgs } from "./types"
import { cmp, isAutomationSession } from "./utils"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({
      directory: input.directory,
      roots: true,
      limit: input.limit,
      excludeAutomation: "true",
    })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list({ directory: input.directory, roots: true, excludeAutomation: "true" })
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}

export function preserveLoadedAutomationSessions(input: { sessions: Session[]; existing: Session[] }) {
  const ids = new Set(input.sessions.map((session) => session.id))
  const preserved = input.existing.filter(
    (session) => !session.parentID && !session.time?.archived && isAutomationSession(session) && !ids.has(session.id),
  )
  if (preserved.length === 0) return input.sessions
  return [...input.sessions, ...preserved].sort((a, b) => cmp(a.id, b.id))
}
