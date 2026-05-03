import os from "os"
import path from "path"
import { defineConfig } from "drizzle-kit"
import { xdgData } from "xdg-basedir"

const dataDir = path.join(xdgData ?? path.join(os.homedir(), ".local", "share"), "opencode")

function databaseUrl() {
  const configured = process.env.OPENCODE_DB
  if (!configured) return path.join(dataDir, "opencode.db")
  if (configured === ":memory:" || path.isAbsolute(configured)) return configured
  return path.join(dataDir, configured)
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: databaseUrl(),
  },
})
