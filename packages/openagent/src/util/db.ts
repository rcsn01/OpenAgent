import { Effect } from "effect"
import { Database } from "@/storage/db"

export type DbClient = Parameters<typeof Database.use>[0] extends (trx: infer D) => unknown ? D : never

export const db = <T>(fn: (db: DbClient) => T) => Effect.sync(() => Database.use(fn))
