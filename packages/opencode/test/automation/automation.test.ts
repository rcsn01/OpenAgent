import { describe, expect, test } from "bun:test"
import { nextRunAt, type Automation } from "../../src/automation/automation"

describe("automation schedule", () => {
  test("schedules daily time for today when still ahead", () => {
    const from = new Date("2026-05-15T08:00:00").getTime()
    const next = nextRunAt({ type: "daily", time: "09:30" }, from)
    expect(new Date(next).toISOString()).toBe(new Date("2026-05-15T09:30:00").toISOString())
  })

  test("schedules daily time for tomorrow when already passed", () => {
    const from = new Date("2026-05-15T10:00:00").getTime()
    const next = nextRunAt({ type: "daily", time: "09:30" }, from)
    expect(new Date(next).toISOString()).toBe(new Date("2026-05-16T09:30:00").toISOString())
  })

  test("schedules weekly time to the next requested day", () => {
    const from = new Date("2026-05-15T10:00:00").getTime()
    const schedule: Automation.Schedule = { type: "weekly", day: 1, time: "09:30" }
    const next = nextRunAt(schedule, from)
    expect(new Date(next).getDay()).toBe(1)
    expect(new Date(next).getHours()).toBe(9)
    expect(new Date(next).getMinutes()).toBe(30)
  })

  test("schedules intervals from the provided time", () => {
    const from = new Date("2026-05-15T10:00:00").getTime()
    expect(nextRunAt({ type: "interval", minutes: 30 }, from)).toBe(from + 30 * 60_000)
  })
})
