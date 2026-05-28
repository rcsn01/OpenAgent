import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { openAgentHome } from "./home"

type LogLevel = "info" | "warn" | "error"

export async function runtimeLog(level: LogLevel, message: string, fields: Record<string, unknown> = {}) {
  try {
    const home = openAgentHome()
    await mkdir(home, { recursive: true })
    await appendFile(
      join(home, "server.log"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...fields,
      })}\n`,
      { mode: 0o600 },
    )
  } catch {
    // Logging must never affect runtime behavior.
  }
}
