import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { startServer } from "../src/http"
import { authTokenFromCredentials } from "../src/shared-client"

let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openagent-http-"))
})

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe("HTTP runtime API", () => {
  test("serves health and authenticated RPC", async () => {
    const server = await startServer({ home: dir, token: "test-token", port: 0 })
    try {
      expect(await fetch(`${server.metadata.url}/health`).then((r) => r.status)).toBe(200)
      expect(await fetch(`${server.metadata.url}/rpc/session.list`, { method: "POST" }).then((r) => r.status)).toBe(401)
      const response = await fetch(`${server.metadata.url}/rpc/session.create`, {
        method: "POST",
        headers: {
          authorization: `Basic ${authTokenFromCredentials({ username: "openagent", password: "test-token" })}`,
          "content-type": "application/json",
          "x-openagent-directory": "/repo",
        },
        body: "{}",
      })
      const body = (await response.json()) as { data: { directory: string } }
      expect(response.status).toBe(200)
      expect(body.data.directory).toBe("/repo")
    } finally {
      server.stop()
    }
  })
})
