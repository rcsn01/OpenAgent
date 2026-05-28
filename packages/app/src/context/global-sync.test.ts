import { describe, expect, test } from "bun:test"
import type { Session } from "@openagent-ai/sdk/v2/client"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import {
  estimateRootSessionTotal,
  loadRootSessionsWithFallback,
  preserveLoadedAutomationSessions,
} from "./global-sync/session-load"

const session = (input: { id: string; source?: "user" | "automation"; title?: string; archived?: number }) =>
  ({
    id: input.id,
    title: input.title ?? input.id,
    source: input.source ?? "user",
    time: { created: 1, updated: 1, archived: input.archived },
  }) as Session

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number; excludeAutomation?: "true" }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10, excludeAutomation: "true" }])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number; excludeAutomation?: "true" }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25, excludeAutomation: "true" },
      { directory: "dir", roots: true, excludeAutomation: "true" },
    ])
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("preserveLoadedAutomationSessions", () => {
  test("keeps loaded automation roots across root-list refreshes", () => {
    const result = preserveLoadedAutomationSessions({
      sessions: [session({ id: "ses_user" })],
      existing: [session({ id: "ses_auto", source: "automation" }), session({ id: "ses_old" })],
    })

    expect(result.map((item) => item.id)).toEqual(["ses_auto", "ses_user"])
  })

  test("does not preserve archived automations", () => {
    const result = preserveLoadedAutomationSessions({
      sessions: [session({ id: "ses_user" })],
      existing: [session({ id: "ses_auto", source: "automation", archived: 10 })],
    })

    expect(result.map((item) => item.id)).toEqual(["ses_user"])
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})
