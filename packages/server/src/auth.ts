import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { openAgentHome, serverMetadataPath } from "./home"

export type ServerMetadata = {
  url: string
  host: string
  port: number
  token: string
  pid: number
  updated: number
}

export function parseBasicAuth(header: string | null) {
  if (!header?.startsWith("Basic ")) return
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
    const idx = decoded.indexOf(":")
    if (idx === -1) return
    return {
      username: decoded.slice(0, idx),
      password: decoded.slice(idx + 1),
    }
  } catch {
    return
  }
}

export async function readServerMetadata(home = openAgentHome()) {
  try {
    return JSON.parse(await readFile(serverMetadataPath(home), "utf8")) as ServerMetadata
  } catch {
    return undefined
  }
}

export async function writeServerMetadata(metadata: ServerMetadata, home = openAgentHome()) {
  const path = serverMetadataPath(home)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 })
}

export function createToken() {
  return randomBytes(32).toString("base64url")
}

export function isAuthorized(request: Request, token: string) {
  const url = new URL(request.url)
  const queryToken = url.searchParams.get("token")
  if (queryToken === token) return true
  const authToken = url.searchParams.get("auth_token")
  if (authToken) {
    try {
      const decoded = Buffer.from(authToken, "base64").toString("utf8")
      if (decoded.endsWith(`:${token}`)) return true
    } catch {}
  }
  const auth = parseBasicAuth(request.headers.get("authorization"))
  return auth?.password === token
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": "Basic realm=\"OpenAgent\"",
    },
  })
}
