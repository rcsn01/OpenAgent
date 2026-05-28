import { createReadStream } from "node:fs"
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { createInterface } from "node:readline"
import { openAgentHome } from "./home"
import { randomID, rolloutFileTimestamp, rolloutTimestamp } from "./ids"
import type { Message, MessageWithParts, Part, RolloutLine, Session, SessionIndex, SessionIndexEntry } from "./types"

const INDEX_VERSION = 1 as const

function emptyIndex(): SessionIndex {
  return { version: INDEX_VERSION, rebuiltAt: Date.now(), entries: {} }
}

function compareMessages(a: Message, b: Message) {
  const aTime = a.time?.created ?? 0
  const bTime = b.time?.created ?? 0
  return aTime - bTime || a.id.localeCompare(b.id)
}

function dayPath(root: string, date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return join(root, "sessions", year, month, day)
}

function archivedPath(root: string, activePath: string) {
  const rel = relative(join(root, "sessions"), activePath)
  return join(root, "archived_sessions", rel)
}

function parseLine(line: string): RolloutLine | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<RolloutLine>
    if (!parsed || typeof parsed !== "object") return
    if (typeof parsed.timestamp !== "string") return
    if (typeof parsed.type !== "string") return
    return parsed as RolloutLine
  } catch {
    return
  }
}

async function walkJsonl(dir: string): Promise<string[]> {
  const fs = await import("node:fs/promises")
  const out: string[] = []
  async function walk(current: string) {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (entry) => {
        const next = join(current, entry.name)
        if (entry.isDirectory()) return walk(next)
        if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(next)
      }),
    )
  }
  await walk(dir)
  return out
}

export class SessionStore {
  readonly root: string
  private indexCache: SessionIndex | undefined

  constructor(root = openAgentHome()) {
    this.root = root
  }

  private get indexPath() {
    return join(this.root, "index.json")
  }

  async ensure() {
    await mkdir(this.root, { recursive: true })
    await mkdir(join(this.root, "sessions"), { recursive: true })
    await mkdir(join(this.root, "archived_sessions"), { recursive: true })
  }

  async create(input: { directory?: string; title?: string; parentID?: string } = {}) {
    await this.ensure()
    const now = Date.now()
    const id = randomID("ses")
    const directory = input.directory || process.cwd()
    const session: Session = {
      id,
      parentID: input.parentID,
      title: input.title || "New session",
      directory,
      source: "user",
      time: {
        created: now,
        updated: now,
      },
    }
    const dir = dayPath(this.root)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `rollout-${rolloutFileTimestamp()}-${id}.jsonl`)
    await this.appendPath(path, { timestamp: rolloutTimestamp(), type: "session_meta", payload: session })
    await this.upsertIndex({
      id,
      path,
      session,
      messageCount: 0,
      updated: now,
    })
    return session
  }

  async append(sessionID: string, line: RolloutLine) {
    const entry = await this.getIndexEntry(sessionID)
    if (!entry) throw new Error(`Session not found: ${sessionID}`)
    await this.appendPath(entry.path, line)
    await this.indexFromFile(entry.path).then((next) => this.upsertIndex(next))
  }

  private async appendPath(path: string, line: RolloutLine) {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify(line) + "\n", "utf8")
  }

  async get(sessionID: string) {
    const entry = await this.getIndexEntry(sessionID)
    return entry?.session
  }

  async update(sessionID: string, patch: Partial<Pick<Session, "title">>) {
    const session = await this.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    const next: Session = {
      ...session,
      ...patch,
      time: { ...session.time, updated: Date.now() },
    }
    await this.append(sessionID, { timestamp: rolloutTimestamp(), type: "session_meta", payload: next })
    return next
  }

  async archive(sessionID: string) {
    const entry = await this.getIndexEntry(sessionID)
    if (!entry) throw new Error(`Session not found: ${sessionID}`)
    const session: Session = {
      ...entry.session,
      time: { ...entry.session.time, archived: Date.now(), updated: Date.now() },
    }
    await this.append(entry.id, { timestamp: rolloutTimestamp(), type: "session_meta", payload: session })
    const latest = await this.getIndexEntry(sessionID)
    if (!latest) return session
    const target = archivedPath(this.root, latest.path)
    await mkdir(dirname(target), { recursive: true })
    await rename(latest.path, target).catch(async () => {
      await writeFile(target, await readFile(latest.path))
      await unlink(latest.path)
    })
    await this.upsertIndex({ ...latest, path: target, archived: true, session })
    return session
  }

  async list(input: { directory?: string; roots?: boolean; limit?: number; includeArchived?: boolean } = {}) {
    const index = await this.readIndex()
    const list = Object.values(index.entries)
      .filter((entry) => input.includeArchived || !entry.session.time.archived)
      .filter((entry) => !input.directory || entry.session.directory === input.directory)
      .filter((entry) => !input.roots || !entry.session.parentID)
      .sort((a, b) => a.session.id.localeCompare(b.session.id))
      .map((entry) => entry.session)
    return typeof input.limit === "number" ? list.slice(Math.max(0, list.length - input.limit)) : list
  }

  async messages(sessionID: string, input: { limit?: number; before?: string } = {}) {
    const entry = await this.getIndexEntry(sessionID)
    if (!entry) return { items: [] as MessageWithParts[], cursor: undefined as string | undefined }
    const { messages, parts } = await this.readMessages(entry.path)
    let list = messages.sort(compareMessages)
    if (input.before) {
      const index = list.findIndex((message) => message.id === input.before)
      list = index === -1 ? list.filter((message) => message.id < input.before!) : list.slice(0, index)
    }
    const limit = input.limit ?? 100
    const page = list.slice(Math.max(0, list.length - limit))
    const cursor = page.length > 0 && page[0] !== list[0] ? page[0]!.id : undefined
    return {
      items: page.map((info) => ({ info, parts: (parts.get(info.id) ?? []).sort((a, b) => a.id.localeCompare(b.id)) })),
      cursor,
    }
  }

  async rebuildIndex() {
    await this.ensure()
    const files = [
      ...(await walkJsonl(join(this.root, "sessions"))),
      ...(await walkJsonl(join(this.root, "archived_sessions"))),
    ]
    const index = emptyIndex()
    for (const file of files) {
      const entry = await this.indexFromFile(file)
      if (entry) index.entries[entry.id] = entry
    }
    this.indexCache = index
    await this.writeIndex(index)
    return index
  }

  async readIndex() {
    if (this.indexCache && !(await this.isIndexStale(this.indexCache))) return this.indexCache
    let index: SessionIndex | undefined
    try {
      index = JSON.parse(await readFile(this.indexPath, "utf8")) as SessionIndex
    } catch {
      return this.rebuildIndex()
    }
    if (!index || index.version !== INDEX_VERSION || (await this.isIndexStale(index))) {
      return this.rebuildIndex()
    }
    this.indexCache = index
    return index
  }

  async getIndexEntry(sessionID: string) {
    const index = await this.readIndex()
    return index.entries[sessionID]
  }

  private async isIndexStale(index: SessionIndex) {
    let indexStat: Awaited<ReturnType<typeof stat>>
    try {
      indexStat = await stat(this.indexPath)
    } catch {
      return true
    }
    for (const entry of Object.values(index.entries)) {
      try {
        const file = await stat(entry.path)
        if (file.mtimeMs > indexStat.mtimeMs + 5) return true
      } catch {
        return true
      }
    }
    const known = new Set(Object.values(index.entries).map((entry) => entry.path))
    const files = [
      ...(await walkJsonl(join(this.root, "sessions"))),
      ...(await walkJsonl(join(this.root, "archived_sessions"))),
    ]
    if (files.some((file) => !known.has(file))) return true
    return false
  }

  private async upsertIndex(entry: SessionIndexEntry | undefined) {
    if (!entry) return
    const index = await this.readIndex().catch(() => emptyIndex())
    index.entries[entry.id] = entry
    index.rebuiltAt = Date.now()
    this.indexCache = index
    await this.writeIndex(index)
  }

  private async writeIndex(index: SessionIndex) {
    await mkdir(dirname(this.indexPath), { recursive: true })
    await writeFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 })
  }

  private async indexFromFile(path: string): Promise<SessionIndexEntry | undefined> {
    const { session, messages } = await this.readRollout(path)
    if (!session) return
    const archived = path.includes("/archived_sessions/") || !!session.time.archived
    return {
      id: session.id,
      path,
      archived,
      session,
      messageCount: messages.size,
      updated: session.time.updated,
    }
  }

  private async readMessages(path: string) {
    const { messages, parts } = await this.readRollout(path)
    return {
      messages: [...messages.values()],
      parts,
    }
  }

  async readRollout(path: string) {
    const messages = new Map<string, Message>()
    const parts = new Map<string, Part[]>()
    let session: Session | undefined
    let stream: ReturnType<typeof createReadStream>
    try {
      stream = createReadStream(path, "utf8")
    } catch {
      return { session, messages, parts }
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      const parsed = parseLine(line)
      if (!parsed) continue
      if (parsed.type === "session_meta") session = parsed.payload
      if (parsed.type === "message") messages.set(parsed.payload.id, parsed.payload)
      if (parsed.type === "part") {
        const list = parts.get(parsed.payload.messageID) ?? []
        const idx = list.findIndex((item) => item.id === parsed.payload.id)
        if (idx === -1) list.push(parsed.payload)
        else list[idx] = parsed.payload
        parts.set(parsed.payload.messageID, list)
      }
    }
    return { session, messages, parts }
  }
}
