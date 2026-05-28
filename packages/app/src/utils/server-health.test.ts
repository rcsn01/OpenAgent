import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { checkServerHealth } from "./server-health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

describe("checkServerHealth", () => {
  test("returns the frontend-only runtime health without fetching", async () => {
    let called = false
    const fetch = (async () => {
      called = true
      throw new Error("should not fetch")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(called).toBe(false)
    expect(result).toEqual({ healthy: true, version: "frontend-only" })
  })
})
