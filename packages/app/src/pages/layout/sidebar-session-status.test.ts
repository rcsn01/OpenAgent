import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@opencode-ai/ui/contracts"
import { sidebarSessionStatus } from "./sidebar-session-status"

describe("sidebarSessionStatus", () => {
  test("treats explicit busy and retry statuses as running", () => {
    expect(sidebarSessionStatus({ status: { type: "busy" } as SessionStatus })).toBe("running")
    expect(
      sidebarSessionStatus({
        status: { type: "retry", attempt: 1, message: "Retrying", next: Date.now() } as SessionStatus,
      }),
    ).toBe("running")
  })

  test("does not infer running without an explicit running status", () => {
    expect(sidebarSessionStatus({ status: { type: "idle" } as SessionStatus })).toBeUndefined()
    expect(sidebarSessionStatus({ status: undefined })).toBeUndefined()
  })

  test("uses unseen response notifications as done", () => {
    expect(sidebarSessionStatus({ status: { type: "idle" } as SessionStatus, unseenCount: 1 })).toBe("done")
  })

  test("prioritizes pending interaction and errors over running or done", () => {
    expect(
      sidebarSessionStatus({
        status: { type: "busy" } as SessionStatus,
        unseenCount: 1,
        hasPendingInteraction: true,
      }),
    ).toBe("pending")
    expect(
      sidebarSessionStatus({
        status: { type: "busy" } as SessionStatus,
        unseenCount: 1,
        hasPendingInteraction: true,
        hasUnseenError: true,
      }),
    ).toBe("error")
  })
})
