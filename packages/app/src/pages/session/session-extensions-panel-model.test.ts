import { describe, expect, test } from "bun:test"
import type { ExperimentalExtensionsListResponse, McpStatus } from "@opencode-ai/sdk/v2/client"
import { buildExtensionsPanelModel } from "./session-extensions-panel-model"
import type { ExtensionRegistryEntry } from "@/extensions/registry"

const registryEntry = (input: Partial<ExtensionRegistryEntry> & Pick<ExtensionRegistryEntry, "id" | "version" | "name">) =>
  ({
    id: input.id,
    version: input.version,
    name: input.name,
    description: input.description,
    tags: input.tags ?? [],
    mcp: input.mcp ?? {},
    skills: input.skills ?? [],
  }) satisfies ExtensionRegistryEntry

const installedEntry = (
  input: Partial<ExperimentalExtensionsListResponse["extensions"][number]> &
    Pick<ExperimentalExtensionsListResponse["extensions"][number], "id" | "version" | "name">,
) =>
  ({
    id: input.id,
    version: input.version,
    name: input.name,
    description: input.description,
    installed: true,
    active: input.active ?? false,
    installed_at: input.installed_at ?? 1,
    config_path: input.config_path ?? "/repo/.opencode/opencode.json",
    skill_roots: input.skill_roots ?? [],
    servers: input.servers ?? [],
    skills: input.skills ?? [],
  }) satisfies ExperimentalExtensionsListResponse["extensions"][number]

describe("buildExtensionsPanelModel", () => {
  test("merges registry metadata into installed extensions", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "calendar",
          version: "2.0.0",
          name: "Calendar",
          description: "Registry description",
          tags: ["schedule"],
        }),
      ],
      installed: [
        installedEntry({
          id: "calendar",
          version: "1.0.0",
          name: "Old Calendar",
          description: "Installed description",
          servers: [
            {
              key: "calendar-main",
              status: { status: "disabled" },
              tools: [{ name: "list_events", description: "List events" }],
            },
          ],
        }),
      ],
      live: {
        "calendar-main": { status: "connected" } satisfies McpStatus,
      },
    })

    expect(model).toHaveLength(1)
    expect(model[0]).toMatchObject({
      id: "calendar",
      name: "Calendar",
      version: "2.0.0",
      active: true,
      available: true,
      tags: ["schedule"],
    })
    expect(model[0]?.servers[0]).toMatchObject({
      key: "calendar-main",
      action: "disconnect",
      status: { status: "connected" },
    })
  })

  test("includes registry-only extensions after installed ones", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({ id: "alpha", version: "1.0.0", name: "Alpha" }),
        registryEntry({ id: "beta", version: "1.0.0", name: "Beta" }),
      ],
      installed: [installedEntry({ id: "beta", version: "1.0.0", name: "Beta" })],
      live: {},
    })

    expect(model.map((item) => `${item.installed ? "installed" : "available"}:${item.id}`)).toEqual([
      "installed:beta",
      "available:alpha",
    ])
  })

  test("maps auth-needed states to authenticate actions", () => {
    const model = buildExtensionsPanelModel({
      registry: [],
      installed: [
        installedEntry({
          id: "mail",
          version: "1.0.0",
          name: "Mail",
          servers: [
            {
              key: "mail-main",
              status: { status: "needs_auth" },
              tools: [],
            },
          ],
        }),
      ],
      live: {},
    })

    expect(model[0]?.servers[0]?.action).toBe("authenticate")
  })
})
