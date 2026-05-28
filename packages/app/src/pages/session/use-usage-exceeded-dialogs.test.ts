import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@openagent-ai/sdk/v2"
import {
  shouldShowUsageExceededDialog,
  usageExceededAction,
  usageExceededCooldownMs,
} from "./usage-exceeded-dialogs"

describe("usage exceeded dialogs", () => {
  test("filters retry actions by provider and reason", () => {
    const status = (provider: string, reason: string): SessionStatus => ({
      type: "retry",
      attempt: 1,
      message: "retrying",
      next: Date.now(),
      action: {
        provider,
        reason,
        title: "Limit",
        message: "Limited",
        label: "Open",
      },
    })

    expect(usageExceededAction(status("opencode", "free_tier_limit"))?.reason).toBe("free_tier_limit")
    expect(usageExceededAction(status("opencode-go", "account_rate_limit"))?.reason).toBe("account_rate_limit")
    expect(usageExceededAction(status("anthropic", "free_tier_limit"))).toBeUndefined()
    expect(usageExceededAction(status("opencode", "other"))).toBeUndefined()
    expect(usageExceededAction({ type: "busy" })).toBeUndefined()
  })

  test("applies cooldown and don't-show flags", () => {
    const now = usageExceededCooldownMs + 1_000
    expect(shouldShowUsageExceededDialog({ lastSeen: {}, dontShow: {} }, "free_tier_limit", now)).toBe(true)
    expect(
      shouldShowUsageExceededDialog(
        { lastSeen: { free_tier_limit: now - usageExceededCooldownMs + 1 }, dontShow: {} },
        "free_tier_limit",
        now,
      ),
    ).toBe(false)
    expect(
      shouldShowUsageExceededDialog(
        { lastSeen: { free_tier_limit: now - usageExceededCooldownMs }, dontShow: {} },
        "free_tier_limit",
        now,
      ),
    ).toBe(true)
    expect(shouldShowUsageExceededDialog({ lastSeen: {}, dontShow: { free_tier_limit: true } }, "free_tier_limit")).toBe(
      false,
    )
  })
})
