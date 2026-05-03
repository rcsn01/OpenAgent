import { Effect } from "effect"
import { Database } from "@/storage/db"

export type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

export function db<T>(fn: (db: DbClient) => T) {
  return Effect.sync(() => Database.use(fn))
}