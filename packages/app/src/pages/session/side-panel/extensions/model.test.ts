import { describe, expect, test } from "bun:test"
import type { Config, McpStatus } from "@opencode-ai/sdk/v2/client"
import { buildExtensionsPanelModel } from "./model"
import { managedSkillPath } from "./install"
import type { ExtensionRegistryEntry } from "@/extensions/registry"

const skill = {
  path: "skills/calendar/SKILL.md",
  content: "---\nname: google-calendar:general\ndescription: Manage calendar workflows\n---\n",
}

const registryEntry = (input: Partial<ExtensionRegistryEntry> & Pick<ExtensionRegistryEntry, "id" | "version" | "name">) =>
  ({
    id: input.id,
    version: input.version,
    name: input.name,
    description: input.description,
    tags: input.tags ?? [],
    setup: input.setup,
    mcp: input.mcp ?? {},
    skills: input.skills ?? [],
  }) satisfies ExtensionRegistryEntry

describe("buildExtensionsPanelModel", () => {
  test("derives installed state from config and managed skills", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "google-calendar",
          version: "2.0.0",
          name: "Google Calendar",
          description: "Registry description",
          tags: ["schedule"],
          mcp: {
            google_workspace_calendar: {
              type: "local",
              command: ["uvx", "workspace-mcp"],
            },
          },
          skills: [skill],
        }),
      ],
      config: {
        mcp: {
          google_workspace_calendar: {
            type: "local",
            command: ["uvx", "workspace-mcp"],
          },
        },
      } satisfies Config,
      live: {
        google_workspace_calendar: { status: "connected" } satisfies McpStatus,
      },
      metadata: {
        "google-calendar": {
          installedAt: 1,
          skillRoot: ".agents/skills/extensions/google-calendar",
          mcpKeys: ["google_workspace_calendar"],
        },
      },
      skillFiles: {
        [managedSkillPath("google-calendar", skill.path)]: true,
      },
    })

    expect(model).toHaveLength(1)
    expect(model[0]).toMatchObject({
      id: "google-calendar",
      name: "Google Calendar",
      version: "2.0.0",
      installed: true,
      active: true,
      available: true,
      needsRepair: false,
      tags: ["schedule"],
    })
    expect(model[0]?.servers[0]).toMatchObject({
      key: "google_workspace_calendar",
      action: "disconnect",
      status: { status: "connected" },
    })
  })

  test("sorts installed extensions before available extensions", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({ id: "alpha", version: "1.0.0", name: "Alpha", mcp: {}, skills: [] }),
        registryEntry({
          id: "beta",
          version: "1.0.0",
          name: "Beta",
          mcp: { beta_mcp: { type: "local", command: ["beta"] } },
          skills: [skill],
        }),
      ],
      config: { mcp: { beta_mcp: { type: "local", command: ["beta"] } } },
      live: {},
      skillFiles: {
        [managedSkillPath("beta", skill.path)]: true,
      },
    })

    expect(model.map((item) => `${item.installed ? "installed" : "available"}:${item.id}`)).toEqual([
      "installed:beta",
      "available:alpha",
    ])
  })

  test("maps auth-needed states to authenticate actions", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "mail",
          version: "1.0.0",
          name: "Mail",
          mcp: { mail_main: { type: "remote", url: "https://example.com/mcp" } },
        }),
      ],
      config: {},
      live: {
        mail_main: { status: "needs_auth" },
      },
    })

    expect(model[0]?.servers[0]?.action).toBe("authenticate")
  })

  test("marks metadata drift as repair needed", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "google-calendar",
          version: "1.0.0",
          name: "Google Calendar",
          mcp: { google_workspace_calendar: { type: "local", command: ["uvx", "workspace-mcp"] } },
          skills: [skill],
        }),
      ],
      config: { mcp: { google_workspace_calendar: { type: "local", command: ["uvx", "workspace-mcp"] } } },
      live: {},
      metadata: {
        "google-calendar": {
          installedAt: 1,
          skillRoot: ".agents/skills/extensions/google-calendar",
          mcpKeys: ["google_workspace_calendar"],
        },
      },
      skillFiles: {},
    })

    expect(model[0]).toMatchObject({
      installed: false,
      needsRepair: true,
    })
  })

  test("keeps setup metadata on bundled extensions and indexes it for search", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "google-calendar",
          version: "1.0.0",
          name: "Google Calendar",
          setup: {
            prerequisites: ["Python 3.10+ installed"],
            environment: ["GOOGLE_OAUTH_CLIENT_ID"],
            steps: ["Click Connect after installing the extension."],
            links: [{ label: "Workspace MCP docs", href: "https://github.com/taylorwilsdon/google_workspace_mcp" }],
          },
          mcp: {
            google_workspace_calendar: {
              type: "local",
              enabled: false,
              command: ["uvx", "workspace-mcp"],
            },
          },
          skills: [skill],
        }),
      ],
      config: {},
      live: {},
    })

    expect(model[0]).toMatchObject({
      id: "google-calendar",
      setup: {
        prerequisites: ["Python 3.10+ installed"],
        environment: ["GOOGLE_OAUTH_CLIENT_ID"],
      },
    })
    expect(model[0]?.servers[0]?.action).toBe("connect")
    expect(model[0]?.search).toContain("GOOGLE_OAUTH_CLIENT_ID")
    expect(model[0]?.search).toContain("Workspace MCP docs")
    expect(model[0]?.skills).toEqual([
      {
        name: "google-calendar:general",
        description: "Manage calendar workflows",
        location: "skills/calendar/SKILL.md",
        installed: false,
      },
    ])
  })

  test("marks unsupported backend-only MCP configs unavailable", () => {
    const model = buildExtensionsPanelModel({
      registry: [
        registryEntry({
          id: "computer-use",
          version: "1.0.0",
          name: "Computer Use",
          mcp: { computer_use: { type: "builtin", id: "computer-use" } },
          skills: [skill],
        }),
      ],
      config: {},
      live: {},
    })

    expect(model[0]).toMatchObject({
      available: false,
      installed: false,
    })
    expect(model[0]?.bundle).toBeUndefined()
  })
})
