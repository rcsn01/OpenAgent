import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  automationMemoryDir,
  automationMemoryFile,
  automationMemoryPermission,
  automationPrompt,
  ensureAutomationMemoryFile,
  nextRunAt,
  removeAutomationMemory,
  type Automation,
  type AutomationID,
} from "../../src/automation/automation"

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

  test("schedules weekday time to Monday after the Friday time has passed", () => {
    const from = new Date("2026-05-15T10:00:00").getTime()
    const next = nextRunAt({ type: "weekday", time: "09:30" }, from)
    expect(new Date(next).getDay()).toBe(1)
    expect(new Date(next).getHours()).toBe(9)
    expect(new Date(next).getMinutes()).toBe(30)
  })
})

describe("automation memory", () => {
  test("stores memory under the hidden automation data directory", async () => {
    const prev = Global.Path.data
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-automation-memory-"))
    try {
      Global.Path.data = root
      const automationID = "atm_test" as AutomationID
      expect(automationMemoryDir(automationID)).toBe(path.join(root, "automations", automationID))
      expect(automationMemoryFile(automationID)).toBe(path.join(root, "automations", automationID, "memory.md"))
    } finally {
      Global.Path.data = prev
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("creates and deletes memory.md for an automation", async () => {
    const prev = Global.Path.data
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-automation-memory-"))
    try {
      Global.Path.data = root
      const automationID = "atm_lifecycle" as AutomationID
      const file = await ensureAutomationMemoryFile(automationID)
      expect(file).toBe(automationMemoryFile(automationID))
      expect(await fs.readFile(file, "utf8")).toBe("")

      await fs.writeFile(file, "# Durable notes\n", "utf8")
      await removeAutomationMemory(automationID)
      await expect(fs.stat(file)).rejects.toThrow()
    } finally {
      Global.Path.data = prev
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("wraps prompt with memory path but not memory contents", () => {
    const automation = {
      id: "atm_prompt" as AutomationID,
      directory: "/repo",
      name: "Ping",
      prompt: "Ping the repo.",
      schedule: { type: "interval", minutes: 5 },
      status: "active",
      nextRunAt: 1,
      lastRunAt: Date.parse("2026-05-15T09:04:50.382Z"),
      time: { created: 1, updated: 1 },
    } satisfies Automation.Info

    const prompt = automationPrompt({ automation, memoryFile: "/data/automations/atm_prompt/memory.md" })
    expect(prompt).toContain("Automation: Ping")
    expect(prompt).toContain("Automation ID: atm_prompt")
    expect(prompt).toContain("Automation memory: /data/automations/atm_prompt/memory.md")
    expect(prompt).toContain("Last run: 2026-05-15T09:04:50.382Z")
    expect(prompt).toContain("Before doing work, read the automation memory file if it exists.")
    expect(prompt).toContain("At the end of the run, update the memory file")
    expect(prompt).toContain("Ping the repo.")
    expect(prompt).not.toContain("# Durable notes")
  })

  test("grants session-scoped access to the automation memory file", () => {
    const memoryFile = "/data/automations/atm_permission/memory.md"
    const rules = automationMemoryPermission({ memoryFile, worktree: "/workspace/project" })

    expect(rules).toContainEqual({
      permission: "external_directory",
      pattern: "/data/automations/atm_permission/*",
      action: "allow",
    })
    expect(rules).toContainEqual({
      permission: "read",
      pattern: memoryFile,
      action: "allow",
    })
    expect(rules).toContainEqual({
      permission: "edit",
      pattern: path.relative("/workspace/project", memoryFile),
      action: "allow",
    })
  })
})
