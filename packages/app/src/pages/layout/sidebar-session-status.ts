import type { SessionStatus } from "@opencode-ai/ui/contracts"

export type SidebarSessionStatus = "running" | "done" | "pending" | "error" | undefined

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
