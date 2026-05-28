import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"

export const GeneralChatTable = sqliteTable(
  "general_chat",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    directory: text().notNull().unique(),
  },
  (table) => [index("general_chat_directory_idx").on(table.directory)],
)

