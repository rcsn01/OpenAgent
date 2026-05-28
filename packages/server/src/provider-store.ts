import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { authPath, configPath, openAgentHome } from "./home"

export type AuthEntry =
  | string
  | {
      type?: string
      key?: string
      apiKey?: string
      api_key?: string
      token?: string
    }

export type AuthFile = Record<string, AuthEntry | undefined>

export type CustomProviderConfig = {
  npm?: string
  name?: string
  env?: string[]
  options?: {
    baseURL?: string
    baseUrl?: string
    headers?: Record<string, string>
  }
  models?: Record<string, { name?: string } | undefined>
}

export type OpenAgentConfig = {
  provider?: Record<string, CustomProviderConfig | undefined>
  disabled_providers?: string[]
  model?: string
  [key: string]: unknown
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object") return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

async function writePrivateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
}

export function apiKeyFromAuthEntry(value: AuthEntry | undefined) {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  for (const key of ["key", "apiKey", "api_key", "token"] as const) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate
  }
}

export async function readAuth(home = openAgentHome()): Promise<AuthFile> {
  return readJson<AuthFile>(authPath(home), {})
}

export async function getStoredApiKey(providerID: string, home = openAgentHome()) {
  return apiKeyFromAuthEntry((await readAuth(home))[providerID])
}

export async function setStoredApiKey(providerID: string, key: string, home = openAgentHome()) {
  const auth = await readAuth(home)
  auth[providerID] = { type: "api", key }
  await writePrivateJson(authPath(home), auth)
}

export async function removeStoredAuth(providerID: string, home = openAgentHome()) {
  const auth = await readAuth(home)
  delete auth[providerID]
  await writePrivateJson(authPath(home), auth)
}

export async function readConfig(home = openAgentHome()): Promise<OpenAgentConfig> {
  return readJson<OpenAgentConfig>(configPath(home), {})
}

export async function updateConfig(patch: OpenAgentConfig, home = openAgentHome()) {
  const current = await readConfig(home)
  const next: OpenAgentConfig = {
    ...current,
    ...patch,
  }

  if (current.provider || patch.provider) {
    next.provider = Object.assign({}, current.provider, patch.provider)
  }

  if (patch.disabled_providers) {
    next.disabled_providers = [...patch.disabled_providers]
  }

  await writePrivateJson(configPath(home), next)
  return next
}

export function customProviderBaseUrl(config: CustomProviderConfig) {
  const value = config.options?.baseURL ?? config.options?.baseUrl
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
