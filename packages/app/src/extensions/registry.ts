import type { ExperimentalExtensionsInstallData } from "@opencode-ai/sdk/v2/client"

export type ExtensionBundle = NonNullable<ExperimentalExtensionsInstallData["body"]>

export type ExtensionRegistryEntry = ExtensionBundle & {
  tags?: string[]
}

// Official extension bundles ship with the app. Leave this empty until a bundle is ready to ship.
export const OFFICIAL_EXTENSIONS: ExtensionRegistryEntry[] = []
