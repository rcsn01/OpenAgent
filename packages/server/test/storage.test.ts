import { appendFile, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rolloutTimestamp } from "../src/ids"
import { SessionStore } from "../src/storage"
import type { Message, TextPart } from "../src/types"

let dir = ""

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openagent-store-"))
})

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe("SessionStore", () => {
  test("creates, appends, resumes, and rebuilds the index", async () => {
    const store = new SessionStore(dir)
    const session = await store.create({ directory: "/repo", title: "Test" })
    const message: Message = {
      id: "msg_1",
      sessionID: session.id,
      role: "user",
      time: { created: 1 },
    }
    const part: TextPart = {
      id: "part_1",
      sessionID: session.id,
      messageID: message.id,
      type: "text",
      text: "hello",
    }
    await store.append(session.id, { timestamp: rolloutTimestamp(), type: "message", payload: message })
    await store.append(session.id, { timestamp: rolloutTimestamp(), type: "part", payload: part })

    expect(await store.list({ directory: "/repo" })).toMatchObject([{ id: session.id, title: "Test" }])
    expect((await store.messages(session.id)).items).toEqual([{ info: message, parts: [part] }])

    const rebuilt = await new SessionStore(dir).rebuildIndex()
    expect(Object.keys(rebuilt.entries)).toEqual([session.id])
  })

  test("archives sessions out of active listings", async () => {
    const store = new SessionStore(dir)
    const session = await store.create({ directory: "/repo" })
    await store.archive(session.id)
    expect(await store.list({ directory: "/repo" })).toEqual([])
    expect(await store.list({ directory: "/repo", includeArchived: true })).toHaveLength(1)
  })

  test("tolerates malformed JSONL while scanning", async () => {
    const store = new SessionStore(dir)
    const session = await store.create({ directory: "/repo" })
    const entry = await store.getIndexEntry(session.id)
    await appendFile(entry!.path, "{not-json}\n")
    const rebuilt = await store.rebuildIndex()
    expect(rebuilt.entries[session.id]?.session.id).toBe(session.id)
  })

  test("orders messages by creation time instead of ID format", async () => {
    const store = new SessionStore(dir)
    const session = await store.create({ directory: "/repo" })
    const first: Message = {
      id: "msg_f",
      sessionID: session.id,
      role: "user",
      time: { created: 1 },
    }
    const second: Message = {
      id: "msg_2",
      sessionID: session.id,
      role: "assistant",
      time: { created: 2 },
    }
    await store.append(session.id, { timestamp: rolloutTimestamp(), type: "message", payload: first })
    await store.append(session.id, { timestamp: rolloutTimestamp(), type: "message", payload: second })

    expect((await store.messages(session.id)).items.map((item) => item.info.id)).toEqual(["msg_f", "msg_2"])
    const page = await store.messages(session.id, { limit: 1 })
    expect(page.items.map((item) => item.info.id)).toEqual(["msg_2"])
    expect((await store.messages(session.id, { before: page.cursor })).items.map((item) => item.info.id)).toEqual([
      "msg_f",
    ])
  })
})
