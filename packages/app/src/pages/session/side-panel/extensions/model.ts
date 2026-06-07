import type { Config, McpStatus } from "@opencode-ai/sdk/v2/client"
import type { ExtensionBundle, ExtensionRegistryEntry, ExtensionSetup } from "@/extensions/registry"
import { supportedMcp, managedSkillPath, type ExtensionMetadata } from "./install"

export type ExtensionPanelServer = {
  key: string
  status: McpStatus
  tools: Array<{ name: string }>
  action: "authenticate" | "connect" | "disconnect"
  supported: boolean
  configured: boolean
}
export type ExtensionPanelSkill = {
  name: string
  description?: string
  location?: string
  installed: boolean
}
export type ExtensionPanelItem = {
  id: string
  name: string
  description?: string
  version: string
  installed: boolean
  active: boolean
  available: boolean
  needsRepair: boolean
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

function defaultStatus(configured: boolean): McpStatus {
  return { status: configured ? "disabled" : "disabled" }
}

function isOAuthCapable(config: ExtensionBundle["mcp"][string] | undefined) {
  if (!config) return false
  if (config.type === "remote") return config.oauth !== false
  return false
}

function serverAction(status: McpStatus["status"], config?: ExtensionBundle["mcp"][string]): ExtensionPanelServer["action"] {
  if (status === "connected") return "disconnect"
  if (status === "needs_auth" || status === "needs_client_registration") return "authenticate"
  if (status === "disabled" && isOAuthCapable(config)) return "authenticate"
  return "connect"
}

function registrySkills(input: {
  bundle: ExtensionRegistryEntry
  skillFiles: Record<string, boolean>
}): ExtensionPanelSkill[] {
  return input.bundle.skills.map((skill) => {
    const location = skill.path
    return {
      name: frontmatterValue(skill.content, "name") ?? skill.path,
      description: frontmatterValue(skill.content, "description"),
      location,
      installed: input.skillFiles[managedSkillPath(input.bundle.id, location)] === true,
    }
  })
}

function itemFromRegistry(input: {
  item: ExtensionRegistryEntry
  config: Config
  live: Record<string, McpStatus>
  metadata?: ExtensionMetadata
  skillFiles: Record<string, boolean>
}): ExtensionPanelItem {
  const bundle = installBundle(input.item)
  const supported = supportedMcp(bundle)
  const expectedMcpKeys = Object.keys(supported)
  const supportedAll = expectedMcpKeys.length === Object.keys(bundle.mcp).length
  const configuredMcp = expectedMcpKeys.every((key) => !!input.config.mcp?.[key])
  const skills = registrySkills({ bundle: input.item, skillFiles: input.skillFiles })
  const installedSkills = skills.every((skill) => skill.installed)
  const hasManagedArtifacts = expectedMcpKeys.length > 0 || skills.length > 0
  const installed = supportedAll && hasManagedArtifacts && configuredMcp && installedSkills
  const needsRepair = !!input.metadata && !installed

  const servers = Object.entries(bundle.mcp).map(([key, registryConfig]) => {
    const supportedServer = key in supported
    const configured = !!input.config.mcp?.[key]
    const status = input.live[key] ?? defaultStatus(configured)
    return {
      key,
      status,
      tools: [],
      supported: supportedServer,
      configured,
      action: serverAction(status.status, registryConfig),
    }
  })
  const tags = input.item.tags ?? []

  return {
    id: input.item.id,
    name: input.item.name,
    description: input.item.description,
    version: input.item.version,
    installed,
    active: installed && servers.length > 0 && servers.every((server) => server.status.status === "connected"),
    available: supportedAll,
    needsRepair,
    installed_at: input.metadata?.installedAt,
    tags,
    setup: input.item.setup,
    search: [input.item.id, input.item.name, input.item.description, ...tags, ...setupSearch(input.item.setup)]
      .filter(Boolean)
      .join(" "),
    bundle: supportedAll ? bundle : undefined,
    servers,
    skills,
  }
}

export function buildExtensionsPanelModel(input: {
  registry: ExtensionRegistryEntry[]
  config: Config
  live: Record<string, McpStatus>
  metadata?: Record<string, ExtensionMetadata>
  skillFiles?: Record<string, boolean>
}) {
  return input.registry
    .map((item) =>
      itemFromRegistry({
        item,
        config: input.config,
        live: input.live,
        metadata: input.metadata?.[item.id],
        skillFiles: input.skillFiles ?? {},
      }),
    )
    .toSorted((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      if (a.needsRepair !== b.needsRepair) return a.needsRepair ? -1 : 1
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    })
}
