import type { ExtensionBundle } from "@/extensions/registry"
import { extensionInstallActions } from "@/extensions/registry"

export type ExtensionInstallClient = {
  experimental: {
    install: (bundle: ExtensionBundle) => Promise<unknown>
  }
  mcp: {
    connect: (input: { name: string }) => Promise<unknown>
    auth: {
      authenticate: (input: { name: string }) => Promise<unknown>
    }
  }
}

export type ExtensionSetupValues = Record<string, string | undefined>

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

function cloneBundle(bundle: ExtensionBundle): ExtensionBundle {
  return JSON.parse(JSON.stringify(bundle)) as ExtensionBundle
}

function envPlaceholder(value: unknown) {
  if (typeof value !== "string") return
  const match = value.match(/^\{env:([^}]+)\}$/)
  return match?.[1]
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

  const next = cloneBundle(bundle)
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

export async function installExtension(input: {
  bundle: ExtensionBundle
  client: ExtensionInstallClient
  refresh: () => Promise<void>
  setup?: ExtensionSetupValues
}) {
  const bundle = applySetupValues(input.bundle, input.setup)
  assertSuccessfulAction(await input.client.experimental.install(bundle), bundle.id)
  await Promise.all(
    extensionInstallActions(bundle).map(async (server) => {
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
  await input.refresh()
}
