import type { Config } from "@opencode-ai/sdk/v2/client"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { ExtensionBundle, ExtensionMcpConfig } from "@/extensions/registry"
import { extensionInstallActions } from "@/extensions/registry"

export const EXTENSION_SKILL_ROOT = ".agents/skills/extensions"

export type ExtensionInstallClient = {
  config: {
    get: () => Promise<unknown>
    update: (config: Config) => Promise<unknown>
  }
  mcp: {
    connect: (input: { name: string }) => Promise<unknown>
    auth: {
      authenticate: (input: { name: string }) => Promise<unknown>
    }
  }
}

export type ExtensionInstallFilesystem = {
  writeExtensionSkillFile: (projectDirectory: string, extensionID: string, relativePath: string, content: string) => Promise<void>
  readExtensionSkillFile?: (projectDirectory: string, extensionID: string, relativePath: string) => Promise<string>
  removeExtensionSkillRoot: (projectDirectory: string, extensionID: string) => Promise<void>
}

export type ExtensionMetadata = {
  installedAt: number
  skillRoot: string
  mcpKeys: string[]
}

export type ExtensionSetupValues = Record<string, string | undefined>
export type ExtensionProjectMetadata = Record<string, ExtensionMetadata>
type StorageLike = SyncStorage | AsyncStorage | undefined

const METADATA_STORAGE = "opencode.extensions.dat"
const metadataKey = (directory: string) => `extensions:${directory}`

function unwrapClientResult(result: unknown) {
  if (typeof result === "object" && result !== null && "data" in result) return result.data
  return result
}

function readActionResult(result: unknown, name: string) {
  const data = unwrapClientResult(result)
  if (typeof data !== "object" || data === null) return data
  if ("error" in data && typeof data.error === "string" && data.error.trim()) throw new Error(data.error)
  if ("message" in data && typeof data.message === "string" && data.message.trim()) throw new Error(data.message)
  return data
}

function assertSuccessfulAction(result: unknown, name: string) {
  const data = readActionResult(result, name)
  if (typeof data !== "object" || data === null) return data
  if (!("status" in data) || typeof data.status !== "string" || data.status === "connected") return data
  throw new Error(`MCP server ${name} returned ${data.status.replaceAll("_", " ")}`)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function envPlaceholder(value: unknown) {
  if (typeof value !== "string") return
  const match = value.match(/^\{env:([^}]+)\}$/)
  return match?.[1]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function configFromResult(result: unknown): Config {
  const data = unwrapClientResult(result)
  if (!isRecord(data)) return {}
  return data as Config
}

function storageFrom(input: { storage?: (name?: string) => StorageLike }) {
  return input.storage?.(METADATA_STORAGE)
}

async function storageGet(storage: StorageLike, key: string) {
  const value = storage?.getItem(key)
  return value instanceof Promise ? await value : value
}

async function storageSet(storage: StorageLike, key: string, value: string) {
  const result = storage?.setItem(key, value)
  if (result instanceof Promise) await result
}

export async function readExtensionProjectMetadata(input: {
  directory: string
  storage?: (name?: string) => StorageLike
}): Promise<ExtensionProjectMetadata> {
  const raw = await storageGet(storageFrom(input), metadataKey(input.directory))
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return {}
    const next: ExtensionProjectMetadata = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue
      const installedAt = typeof value.installedAt === "number" && Number.isFinite(value.installedAt) ? value.installedAt : undefined
      const skillRoot = typeof value.skillRoot === "string" ? value.skillRoot : undefined
      const mcpKeys = Array.isArray(value.mcpKeys) ? value.mcpKeys.filter((item): item is string => typeof item === "string") : []
      if (!installedAt || !skillRoot) continue
      next[id] = { installedAt, skillRoot, mcpKeys }
    }
    return next
  } catch {
    return {}
  }
}

export async function writeExtensionProjectMetadata(input: {
  directory: string
  metadata: ExtensionProjectMetadata
  storage?: (name?: string) => StorageLike
}) {
  await storageSet(storageFrom(input), metadataKey(input.directory), JSON.stringify(input.metadata))
}

export function managedSkillRoot(extensionID: string) {
  return `${EXTENSION_SKILL_ROOT}/${extensionID}`
}

export function managedSkillPath(extensionID: string, relativePath: string) {
  return `${managedSkillRoot(extensionID)}/${relativePath}`
}

function invalidPathSegment(segment: string) {
  return !segment || segment === "." || segment === ".."
}

export function validateSkillPath(path: string) {
  if (!path.endsWith("/SKILL.md")) throw new Error(`Extension skill path must end with SKILL.md: ${path}`)
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`Extension skill path must be relative: ${path}`)
  }
  const normalized = path.replaceAll("\\", "/")
  if (normalized.split("/").some(invalidPathSegment)) throw new Error(`Extension skill path cannot traverse directories: ${path}`)
  return normalized
}

function frontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) throw new Error("Extension skills must include YAML frontmatter.")
  const block = match[1] ?? ""
  const value = (key: string) => block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim()
  if (!value("name")) throw new Error("Extension skill frontmatter must include name.")
  if (!value("description")) throw new Error("Extension skill frontmatter must include description.")
}

export function validateBundleSkills(bundle: ExtensionBundle) {
  const seen = new Set<string>()
  for (const skill of bundle.skills) {
    const path = validateSkillPath(skill.path)
    if (seen.has(path)) throw new Error(`Extension contains duplicate skill path: ${path}`)
    seen.add(path)
    frontmatter(skill.content)
  }
}

export function supportedMcpConfig(config: ExtensionBundle["mcp"][string]): ExtensionMcpConfig | undefined {
  if (config.type === "builtin") return
  return clone(config)
}

export function supportedMcp(bundle: ExtensionBundle) {
  return Object.fromEntries(
    Object.entries(bundle.mcp).flatMap(([key, config]) => {
      const supported = supportedMcpConfig(config)
      return supported ? [[key, supported] as const] : []
    }),
  )
}

export function missingSetupVariables(bundle: ExtensionBundle, setup?: ExtensionSetupValues) {
  const missing = new Set<string>()

  for (const config of Object.values(bundle.mcp)) {
    if (!("environment" in config)) continue
    for (const value of Object.values(config.environment ?? {})) {
      const variable = envPlaceholder(value)
      if (!variable) continue
      if (!setup?.[variable]?.trim()) missing.add(variable)
    }
  }

  return [...missing]
}

export function applySetupValues(bundle: ExtensionBundle, setup?: ExtensionSetupValues) {
  const missing = missingSetupVariables(bundle, setup)
  if (missing.length) {
    throw new Error(`Enter ${missing.join(", ")} in Setup before installing ${bundle.name}.`)
  }

  const next = clone(bundle)
  for (const config of Object.values(next.mcp)) {
    if (!("environment" in config)) continue
    const environment = config.environment
    if (!environment) continue
    for (const [key, value] of Object.entries(environment)) {
      const variable = envPlaceholder(value)
      if (!variable) continue
      environment[key] = setup?.[variable]?.trim() ?? ""
    }
  }
  return next
}

function mergeConfigMcp(config: Config, mcp: Record<string, ExtensionMcpConfig>): Config {
  return {
    ...config,
    mcp: {
      ...(config.mcp ?? {}),
      ...mcp,
    },
  }
}

function removeConfigMcp(config: Config, keys: string[]): Config {
  const current = { ...(config.mcp ?? {}) }
  for (const key of keys) delete current[key]
  const next: Config = { ...config, mcp: current }
  if (Object.keys(current).length === 0) delete next.mcp
  return next
}

async function writeSkills(input: {
  directory: string
  bundle: ExtensionBundle
  filesystem: ExtensionInstallFilesystem
}) {
  validateBundleSkills(input.bundle)
  for (const skill of input.bundle.skills) {
    await input.filesystem.writeExtensionSkillFile(input.directory, input.bundle.id, validateSkillPath(skill.path), skill.content)
  }
}

async function connectServers(input: { bundle: ExtensionBundle; client: ExtensionInstallClient }) {
  await Promise.all(
    extensionInstallActions(input.bundle).map(async (server) => {
      if (server.action === "authenticate") {
        const authenticated = readActionResult(await input.client.mcp.auth.authenticate({ name: server.key }), server.key)
        if (
          typeof authenticated === "object" &&
          authenticated !== null &&
          "status" in authenticated &&
          authenticated.status === "disabled"
        ) {
          return assertSuccessfulAction(await input.client.mcp.connect({ name: server.key }), server.key)
        }
        return assertSuccessfulAction(authenticated, server.key)
      }
      return assertSuccessfulAction(await input.client.mcp.connect({ name: server.key }), server.key)
    }),
  )
}

export async function installExtension(input: {
  directory: string
  bundle: ExtensionBundle
  client: ExtensionInstallClient
  filesystem: ExtensionInstallFilesystem
  refresh: () => Promise<void>
  setup?: ExtensionSetupValues
  storage?: (name?: string) => StorageLike
}) {
  const bundle = applySetupValues(input.bundle, input.setup)
  const mcp = supportedMcp(bundle)
  const mcpKeys = Object.keys(mcp)
  if (mcpKeys.length !== Object.keys(bundle.mcp).length) {
    throw new Error(`${bundle.name} includes MCP entries that are not supported by this OpenAgent build.`)
  }

  await writeSkills({ directory: input.directory, bundle, filesystem: input.filesystem })
  try {
    const previous = configFromResult(await input.client.config.get())
    await input.client.config.update(mergeConfigMcp(previous, mcp))

    const metadata = await readExtensionProjectMetadata(input)
    metadata[bundle.id] = {
      installedAt: Date.now(),
      skillRoot: managedSkillRoot(bundle.id),
      mcpKeys,
    }
    await writeExtensionProjectMetadata({ ...input, metadata })
    await connectServers({ bundle, client: input.client })
    await input.refresh()
  } catch (error) {
    await input.filesystem.removeExtensionSkillRoot(input.directory, bundle.id).catch(() => undefined)
    throw error
  }
}

export async function removeExtension(input: {
  directory: string
  bundle: ExtensionBundle
  client: Pick<ExtensionInstallClient, "config">
  filesystem: ExtensionInstallFilesystem
  refresh: () => Promise<void>
  storage?: (name?: string) => StorageLike
}) {
  const metadata = await readExtensionProjectMetadata(input)
  const owned = metadata[input.bundle.id]
  const mcpKeys = owned?.mcpKeys.length ? owned.mcpKeys : Object.keys(supportedMcp(input.bundle))
  const previous = configFromResult(await input.client.config.get())
  await input.client.config.update(removeConfigMcp(previous, mcpKeys))
  try {
    await input.filesystem.removeExtensionSkillRoot(input.directory, input.bundle.id)
    delete metadata[input.bundle.id]
    await writeExtensionProjectMetadata({ ...input, metadata })
    await input.refresh()
  } catch (error) {
    await input.client.config.update(previous).catch(() => undefined)
    throw error
  }
}
