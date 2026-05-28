import type { SessionStatus } from "@opencode-ai/ui/contracts"

export type UsageExceededReason = "free_tier_limit" | "account_rate_limit"
export type UsageExceededState = {
  lastSeen: Partial<Record<UsageExceededReason, number>>
  dontShow: Partial<Record<UsageExceededReason, boolean>>
}

export const usageExceededCooldownMs = 24 * 60 * 60 * 1000

const reasons = new Set<UsageExceededReason>(["free_tier_limit", "account_rate_limit"])
const providers = new Set(["opencode", "opencode-go"])

const isReason = (value: string): value is UsageExceededReason => reasons.has(value as UsageExceededReason)

export function usageExceededAction(status: SessionStatus) {
  if (status.type !== "retry") return

  const action = status.action
  if (!action) return
  if (!providers.has(action.provider)) return
  if (!isReason(action.reason)) return

  return { ...action, reason: action.reason }
}

export function shouldShowUsageExceededDialog(
  store: UsageExceededState,
  reason: UsageExceededReason,
  now = Date.now(),
) {
  if (store.dontShow[reason]) return false
  const last = store.lastSeen[reason] ?? 0
  return now - last >= usageExceededCooldownMs
}
