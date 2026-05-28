import type { ExperimentalExtensionsListResponse, McpStatus } from "@openagent-ai/sdk/v2/client"
import type { ExtensionBundle, ExtensionRegistryEntry, ExtensionSetup } from "@/extensions/registry"

export type InstalledExtension = ExperimentalExtensionsListResponse["extensions"][number]
export type InstalledExtensionServer = InstalledExtension["servers"][number]
export type ExtensionPanelServer = InstalledExtensionServer & {
  action: "authenticate" | "connect" | "disconnect"
}
export type ExtensionPanelSkill = {
  name: string
  description?: string
  location?: string
}
export type ExtensionPanelItem = {
  id: string
  name: string
  description?: string
  version: string
  installed: boolean
  active: boolean
  available: boolean
  config_path?: string
  installed_at?: number
  tags: string[]
  setup?: ExtensionSetup
  search: string
  bundle?: ExtensionBundle
  servers: ExtensionPanelServer[]
  skills: ExtensionPanelSkill[]
}

function setupSearch(setup?: ExtensionSetup) {
  return [
    ...(setup?.prerequisites ?? []),
    ...(setup?.environment ?? []),
    ...(setup?.steps ?? []),
    ...(setup?.links ?? []).flatMap((link) => [link.label, link.href]),
  ]
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function installBundle(item: ExtensionRegistryEntry): ExtensionBundle {
  return {
    id: item.id,
    version: item.version,
    name: item.name,
    description: item.description,
    mcp: item.mcp,
    skills: item.skills,
  }
}

function frontmatterValue(content: string, key: string) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim()
}

function registrySkills(bundle?: ExtensionRegistryEntry | ExtensionBundle): ExtensionPanelSkill[] {
  return (bundle?.skills ?? []).map((skill) => ({
    name: frontmatterValue(skill.content, "name") ?? skill.path,
    description: frontmatterValue(skill.content, "description"),
    location: skill.path,
  }))
}

function installedSkills(item: InstalledExtension, bundle?: ExtensionRegistryEntry): ExtensionPanelSkill[] {
  if (item.skills.length > 0) {
    return item.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
    }))
  }
  return registrySkills(bundle)
}

function isOAuthCapable(config: ExtensionBundle["mcp"][string] | undefined) {
  if (!config) return false
  if (config.type === "remote") return config.oauth !== false
  if (config.type === "builtin") return false
  return config.transport?.type === "streamable-http" && !!config.oauth
}

function serverAction(
  status: McpStatus["status"],
  config?: ExtensionBundle["mcp"][string],
): ExtensionPanelServer["action"] {
  if (status === "connected") return "disconnect"
  if (status === "needs_auth" || status === "needs_client_registration") return "authenticate"
  if (status === "disabled" && isOAuthCapable(config)) return "authenticate"
  return "connect"
}

function installedItem(
  item: InstalledExtension,
  registry: Map<string, ExtensionRegistryEntry>,
  live: Record<string, McpStatus>,
): ExtensionPanelItem {
  const bundle = registry.get(item.id)
  const tags = bundle?.tags ?? []
  const servers = item.servers.map((server) => {
    const status = live[server.key] ?? server.status
    return {
      ...server,
      status,
      action: serverAction(status.status, bundle?.mcp[server.key]),
    }
  })

  return {
    id: item.id,
    name: bundle?.name ?? item.name,
    description: bundle?.description ?? item.description,
    version: bundle?.version ?? item.version,
    installed: true,
    active: servers.every((server) => server.status.status === "connected"),
    available: !!bundle,
    config_path: item.config_path,
    installed_at: finiteNumber(item.installed_at),
    tags,
    setup: bundle?.setup,
    search: [item.id, bundle?.name, item.name, bundle?.description, item.description, ...tags, ...setupSearch(bundle?.setup)]
      .filter(Boolean)
      .join(" "),
    bundle: bundle ? installBundle(bundle) : undefined,
    servers,
    skills: installedSkills(item, bundle),
  }
}

function availableItem(item: ExtensionRegistryEntry): ExtensionPanelItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    version: item.version,
    installed: false,
    active: false,
    available: true,
    tags: item.tags ?? [],
    setup: item.setup,
    search: [item.id, item.name, item.description, ...(item.tags ?? []), ...setupSearch(item.setup)].filter(Boolean).join(" "),
    bundle: installBundle(item),
    servers: Object.keys(item.mcp).map((key) => ({
      key,
      status: { status: "disabled" as const },
      tools: [],
      action: "connect" as const,
    })),
    skills: registrySkills(item),
  }
}

export function buildExtensionsPanelModel(input: {
  registry: ExtensionRegistryEntry[]
  installed: InstalledExtension[]
  live: Record<string, McpStatus>
}) {
  const registry = new Map(input.registry.map((item) => [item.id, item] as const))
  const installed = input.installed.map((item) => installedItem(item, registry, input.live))
  const installedIDs = new Set(installed.map((item) => item.id))
  const available = input.registry.filter((item) => !installedIDs.has(item.id)).map(availableItem)
  return [...installed, ...available].toSorted((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}
