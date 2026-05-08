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

export async function installExtension(input: {
  bundle: ExtensionBundle
  client: ExtensionInstallClient
  refresh: () => Promise<void>
}) {
  assertSuccessfulAction(await input.client.experimental.install(input.bundle), input.bundle.id)
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
  await input.refresh()
}
