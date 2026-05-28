import type { SessionStatus } from "@openagent-ai/sdk/v2/client"

export type SidebarSessionStatus = "running" | "done" | "pending" | "error" | undefined
export type SidebarGlow = "working" | "done" | "needs-input" | "failed"

export const sidebarSessionGlow = {
  running: "working",
  done: "done",
  pending: "needs-input",
  error: "failed",
} as const satisfies Record<Exclude<SidebarSessionStatus, undefined>, SidebarGlow>

export function sidebarSessionStatus(input: {
  status?: SessionStatus
  hasPendingInteraction?: boolean
  hasUnseenError?: boolean
  unseenCount?: number
}): SidebarSessionStatus {
  if (input.hasUnseenError) return "error"
  if (input.hasPendingInteraction) return "pending"

  const status = input.status
  if (status?.type === "busy" || status?.type === "retry") return "running"

  if ((input.unseenCount ?? 0) > 0) return "done"
  return undefined
}
