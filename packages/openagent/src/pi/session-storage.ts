import {
  Session,
  SessionError,
  uuidv7,
  type SessionMetadata,
  type SessionStorage,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core"
import { asc, desc, eq, sql } from "@/storage/db"
import * as Database from "@/storage/db"
import { PiSessionEntryTable, PiSessionStateTable, SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"

type EntryData = Omit<SessionTreeEntry, "id" | "parentId" | "timestamp" | "type">

function timestampToMillis(timestamp: string) {
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : Date.now()
}

function entryData(entry: SessionTreeEntry): EntryData {
  const { id: _id, parentId: _parentId, timestamp: _timestamp, type: _type, ...data } = entry
  return data
}

function rowToEntry(row: typeof PiSessionEntryTable.$inferSelect): SessionTreeEntry {
  return {
    ...(row.data as EntryData),
    id: row.id,
    parentId: row.parent_id,
    timestamp: new Date(row.time_created).toISOString(),
    type: row.type,
  } as SessionTreeEntry
}

function leafIdAfterEntry(entry: SessionTreeEntry) {
  return entry.type === "leaf" ? entry.targetId : entry.id
}

function generateEntryId(sessionID: SessionID) {
  for (let i = 0; i < 100; i++) {
    const id = uuidv7().slice(0, 8)
    const existing = Database.use((db) =>
      db
        .select({ id: PiSessionEntryTable.id })
        .from(PiSessionEntryTable)
        .where(eq(PiSessionEntryTable.id, id))
        .get(),
    )
    if (!existing) return id
  }
  return `${sessionID}-${uuidv7()}`
}

export class OpenAgentPiSessionStorage<TMetadata extends SessionMetadata = SessionMetadata>
  implements SessionStorage<TMetadata>
{
  constructor(
    readonly sessionID: SessionID,
    private readonly initialMetadata?: TMetadata,
  ) {}

  static session<TMetadata extends SessionMetadata = SessionMetadata>(sessionID: SessionID, metadata?: TMetadata) {
    return new Session<TMetadata>(new OpenAgentPiSessionStorage(sessionID, metadata))
  }

  async getMetadata(): Promise<TMetadata> {
    return Database.use((db) => {
      const state = db
        .select({ metadata: PiSessionStateTable.metadata })
        .from(PiSessionStateTable)
        .where(eq(PiSessionStateTable.session_id, this.sessionID))
        .get()
      if (state) return state.metadata as TMetadata

      const session = db
        .select({
          id: SessionTable.id,
          time_created: SessionTable.time_created,
          directory: SessionTable.directory,
          path: SessionTable.path,
          parent_id: SessionTable.parent_id,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, this.sessionID))
        .get()
      if (!session) throw new SessionError("not_found", `Session ${this.sessionID} not found`)

      const metadata = (this.initialMetadata ?? {
        id: session.id,
        createdAt: new Date(session.time_created).toISOString(),
        cwd: session.directory,
        path: session.path ?? session.directory,
        parentSessionPath: session.parent_id ?? undefined,
      }) as TMetadata
      const now = Date.now()
      db.insert(PiSessionStateTable)
        .values({
          session_id: this.sessionID,
          leaf_id: null,
          metadata,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoNothing()
        .run()
      return metadata
    })
  }

  async getLeafId(): Promise<string | null> {
    const leafID = Database.use((db) =>
      db
        .select({ leaf_id: PiSessionStateTable.leaf_id })
        .from(PiSessionStateTable)
        .where(eq(PiSessionStateTable.session_id, this.sessionID))
        .get(),
    )?.leaf_id
    if (!leafID) return null
    const entry = await this.getEntry(leafID)
    if (!entry) throw new SessionError("invalid_session", `Entry ${leafID} not found`)
    return leafID
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !(await this.getEntry(leafId))) {
      throw new SessionError("not_found", `Entry ${leafId} not found`)
    }
    const entry: SessionTreeEntry = {
      type: "leaf",
      id: await this.createEntryId(),
      parentId: await this.getLeafId(),
      timestamp: new Date().toISOString(),
      targetId: leafId,
    }
    await this.insertEntry(entry, leafId)
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.sessionID)
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    await this.insertEntry(entry, leafIdAfterEntry(entry))
  }

  private async insertEntry(entry: SessionTreeEntry, leafId: string | null): Promise<void> {
    await this.getMetadata()
    Database.transaction((db) => {
      db.insert(PiSessionEntryTable)
        .values({
          id: entry.id,
          session_id: this.sessionID,
          parent_id: entry.parentId,
          type: entry.type,
          time_created: timestampToMillis(entry.timestamp),
          data: entryData(entry),
        })
        .run()
      db.update(PiSessionStateTable)
        .set({ leaf_id: leafId, time_updated: Date.now() })
        .where(eq(PiSessionStateTable.session_id, this.sessionID))
        .run()
    })
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return Database.use((db) => {
      const row = db
        .select()
        .from(PiSessionEntryTable)
        .where(eq(PiSessionEntryTable.id, id))
        .get()
      return row && row.session_id === this.sessionID ? rowToEntry(row) : undefined
    })
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return Database.use((db) =>
      db
        .select()
        .from(PiSessionEntryTable)
        .where(
          sql`${PiSessionEntryTable.session_id} = ${this.sessionID} and ${PiSessionEntryTable.type} = ${type}`,
        )
        .orderBy(asc(PiSessionEntryTable.time_created), asc(PiSessionEntryTable.id))
        .all()
        .map((row) => rowToEntry(row) as Extract<SessionTreeEntry, { type: TType }>),
    )
  }

  async getLabel(id: string): Promise<string | undefined> {
    const entries = await this.findEntries("label")
    const label = entries.filter((entry) => entry.targetId === id).at(-1)?.label?.trim()
    return label || undefined
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return []
    const path: SessionTreeEntry[] = []
    let current = await this.getEntry(leafId)
    if (!current) throw new SessionError("not_found", `Entry ${leafId} not found`)
    while (current) {
      path.unshift(current)
      if (!current.parentId) break
      const parent = await this.getEntry(current.parentId)
      if (!parent) throw new SessionError("invalid_session", `Entry ${current.parentId} not found`)
      current = parent
    }
    return path
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return Database.use((db) =>
      db
        .select()
        .from(PiSessionEntryTable)
        .where(eq(PiSessionEntryTable.session_id, this.sessionID))
        .orderBy(asc(PiSessionEntryTable.time_created), asc(PiSessionEntryTable.id))
        .all()
        .map(rowToEntry),
    )
  }

  async getLatestEntry(): Promise<SessionTreeEntry | undefined> {
    return Database.use((db) => {
      const row = db
        .select()
        .from(PiSessionEntryTable)
        .where(eq(PiSessionEntryTable.session_id, this.sessionID))
        .orderBy(desc(PiSessionEntryTable.time_created), desc(PiSessionEntryTable.id))
        .limit(1)
        .get()
      return row ? rowToEntry(row) : undefined
    })
  }
}
