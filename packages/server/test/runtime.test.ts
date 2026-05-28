import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EventHub } from "../src/events"
import { OpenAgentRuntime, type PiAdapter } from "../src/runtime"
import { SessionStore } from "../src/storage"

let dir = ""
let oldHome: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openagent-runtime-"))
  oldHome = process.env.OPENAGENT_HOME
  process.env.OPENAGENT_HOME = dir
})

afterEach(async () => {
  if (oldHome === undefined) delete process.env.OPENAGENT_HOME
  else process.env.OPENAGENT_HOME = oldHome
  if (dir) await rm(dir, { recursive: true, force: true })
})

const adapter: PiAdapter = {
  async listProviders() {
    return {
      all: [{ id: "mock", name: "Mock", models: { echo: { id: "echo", name: "Echo", status: "available" } } }],
      connected: ["mock"],
      default: { mock: "echo" },
    }
  },
  async complete(input) {
    return { text: `echo: ${input.prompt}` }
  },
}

describe("OpenAgentRuntime", () => {
  test("handles create/list/prompt/messages/status/delete", async () => {
    const events = new EventHub()
    const seen: string[] = []
    events.on((_directory, event) => seen.push(event.type))
    const runtime = new OpenAgentRuntime({ store: new SessionStore(dir), events, adapter })

    const created = await runtime.call("session.create", {}, { directory: "/repo" })
    const session = created.data as { id: string }
    expect(session.id).toStartWith("ses_")
    expect((await runtime.call("session.list", { directory: "/repo" }, { directory: "/repo" })).data).toHaveLength(1)

    const prompted = await runtime.call(
      "session.promptAsync",
      {
        sessionID: session.id,
        messageID: "msg_user",
        model: { providerID: "mock", modelID: "echo" },
        parts: [{ id: "part_user", type: "text", text: "hello" }],
      },
      { directory: "/repo" },
    )
    expect(prompted.error).toBeUndefined()
    const messages = await runtime.call("session.messages", { sessionID: session.id })
    const items = (messages.data as { items: Array<{ info: { id: string; role: string; parentID?: string } }> }).items
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.info.role === "assistant")?.info.parentID).toBe("msg_user")
    expect(await runtime.call("session.status", { sessionID: session.id })).toMatchObject({ data: { type: "idle" } })
    expect(seen).toContain("message.part.updated")

    await runtime.call("session.delete", { sessionID: session.id })
    expect((await runtime.call("session.list", { directory: "/repo" }, { directory: "/repo" })).data).toEqual([])
  })

  test("stores provider auth, merges custom provider config, and emits refresh events", async () => {
    const events = new EventHub()
    const seen: string[] = []
    events.on((_directory, event) => seen.push(event.type))
    const runtime = new OpenAgentRuntime({ store: new SessionStore(dir), events })

    const authMethods = await runtime.call("provider.auth", {})
    const authMap = authMethods.data as Record<string, unknown>
    expect(Object.keys(authMap).length).toBeGreaterThan(0)
    expect(authMap.ollama).toBeDefined()
    expect(authMap["ollama-cloud"]).toBeDefined()

    const providerList = await runtime.call("provider.list", {})
    const ollamaProviders = (providerList.data as { all: Array<{ id: string; models: Record<string, unknown> }> }).all.filter((item) =>
      item.id.startsWith("ollama"),
    )
    expect(ollamaProviders.map((item) => item.id)).toContain("ollama")
    expect(ollamaProviders.map((item) => item.id)).toContain("ollama-cloud")
    expect(ollamaProviders.find((item) => item.id === "ollama-cloud")?.models["gpt-oss:120b"]).toBeDefined()

    const updated = await runtime.call("global.config.update", {
      config: {
        provider: {
          "local-openai": {
            npm: "@ai-sdk/openai-compatible",
            name: "Local OpenAI",
            options: { baseURL: "http://localhost:11434/v1" },
            models: { "local-model": { name: "Local Model" } },
          },
        },
      },
    })
    expect(updated.error).toBeUndefined()
    expect(seen).toContain("global.disposed")

    const disconnected = await runtime.call("provider.list", {})
    expect((disconnected.data as { connected: string[] }).connected).not.toContain("local-openai")

    const set = await runtime.call("auth.set", {
      providerID: "local-openai",
      auth: { type: "api", key: "test-key" },
    })
    expect(set.error).toBeUndefined()
    const auth = JSON.parse(await readFile(join(dir, "auth.json"), "utf8")) as Record<string, { key?: string }>
    expect(auth["local-openai"]?.key).toBe("test-key")

    const connected = await runtime.call("provider.list", {})
    expect((connected.data as { connected: string[] }).connected).toContain("local-openai")
    const provider = (connected.data as { all: Array<{ id: string; models: Record<string, unknown>; source?: string }> }).all.find(
      (item) => item.id === "local-openai",
    )
    expect(provider?.source).toBe("custom")
    expect(provider?.models["local-model"]).toBeDefined()

    await runtime.call("auth.remove", { providerID: "local-openai" })
    const removed = await runtime.call("provider.list", {})
    expect((removed.data as { connected: string[] }).connected).not.toContain("local-openai")
  })
})
