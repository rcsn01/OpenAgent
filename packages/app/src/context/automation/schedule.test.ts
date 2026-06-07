import { describe, expect, test } from "bun:test"
import { advanceAutomationRunAt, nextAutomationRunAt } from "./schedule"

const local = (iso: string) => new Date(iso).getTime()

describe("automation schedule", () => {
  test("calculates the next daily run", () => {
    expect(nextAutomationRunAt({ type: "daily", time: "09:00" }, local("2026-06-07T08:00:00"))).toBe(
      local("2026-06-07T09:00:00"),
    )
    expect(nextAutomationRunAt({ type: "daily", time: "09:00" }, local("2026-06-07T10:00:00"))).toBe(
      local("2026-06-08T09:00:00"),
    )
  })

  test("calculates weekday runs", () => {
    expect(nextAutomationRunAt({ type: "weekday", time: "09:00" }, local("2026-06-05T10:00:00"))).toBe(
      local("2026-06-08T09:00:00"),
    )
  })

  test("calculates weekly runs", () => {
    expect(nextAutomationRunAt({ type: "weekly", day: 1, time: "09:00" }, local("2026-06-07T10:00:00"))).toBe(
      local("2026-06-08T09:00:00"),
    )
  })

  test("calculates interval runs", () => {
    expect(nextAutomationRunAt({ type: "interval", minutes: 15 }, local("2026-06-07T10:00:00"))).toBe(
      local("2026-06-07T10:15:00"),
    )
  })

  test("advances overdue schedules to a single next future occurrence", () => {
    expect(
      advanceAutomationRunAt(
        { type: "daily", time: "09:00" },
        local("2026-06-01T09:00:00"),
        local("2026-06-07T10:00:00"),
      ),
    ).toBe(local("2026-06-08T09:00:00"))
  })
})
