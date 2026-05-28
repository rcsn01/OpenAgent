import { randomBytes } from "node:crypto"

export function randomID(prefix: string) {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "")
  return `${prefix}_${now}_${randomBytes(4).toString("hex")}`
}

export function rolloutTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function rolloutFileTimestamp(date = new Date()) {
  return rolloutTimestamp(date).replace(/:/g, "-").replace("Z", "")
}
