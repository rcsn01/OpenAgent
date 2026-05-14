import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"
import type { Automation, AutomationID, AutomationRunID } from "./automation"

export const AutomationTable = sqliteTable(
  "automation",
  {
    id: text().$type<AutomationID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    name: text().notNull(),
    prompt: text().notNull(),
    schedule: text({ mode: "json" }).notNull().$type<Automation.Schedule>(),
    status: text().$type<Automation.Status>().notNull(),
    next_run_at: integer().notNull(),
    last_run_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_project_idx").on(table.project_id),
    index("automation_directory_idx").on(table.directory),
    index("automation_due_idx").on(table.status, table.next_run_at),
  ],
)

export const AutomationRunTable = sqliteTable(
  "automation_run",
  {
    id: text().$type<AutomationRunID>().primaryKey(),
    automation_id: text()
      .$type<AutomationID>()
      .notNull()
      .references(() => AutomationTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    status: text().$type<Automation.RunStatus>().notNull(),
    error: text(),
    started_at: integer().notNull(),
    completed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_run_automation_idx").on(table.automation_id),
    index("automation_run_status_idx").on(table.status),
  ],
)
