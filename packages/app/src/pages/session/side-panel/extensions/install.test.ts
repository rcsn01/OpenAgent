import { describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/sdk/v2/client"
import type { ExtensionBundle } from "@/extensions/registry"
import {
  applySetupValues,
  installExtension,
  managedSkillPath,
  missingSetupVariables,
  removeExtension,
  validateBundleSkills,
} from "./install"

function googleBundle(overrides: Partial<ExtensionBundle> = {}) {
  return {
    id: "google-calendar",
    version: "2.0.0",
    name: "Google Calendar",
    mcp: {
      google_workspace_calendar: {
        type: "local",
        command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
        environment: {
          GOOGLE_OAUTH_CLIENT_ID: "{env:GOOGLE_OAUTH_CLIENT_ID}",
          GOOGLE_OAUTH_CLIENT_SECRET: "{env:GOOGLE_OAUTH_CLIENT_SECRET}",
          MCP_ENABLE_OAUTH21: "true",
        },
      },
    },
    skills: [
      {
        path: "skills/general/SKILL.md",
        content: "---\nname: google-calendar:general\ndescription: Demo\n---\n",
      },
    ],
    ...overrides,
  } as ExtensionBundle
}

function memoryStorage() {
  const values = new Map<string, string>()
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => {
      values.clear()
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size
    },
  })
}

function harness(input: { config?: Config; updateError?: Error } = {}) {
  const calls: string[] = []
  let config = input.config ?? {}
  const files = new Map<string, string>()
  const storage = memoryStorage()
  return {
    calls,
    files,
    storage,
    client: {
      config: {
        get: async () => ({ data: config }),
        update: async (next: Config) => {
          calls.push("config.update")
          if (input.updateError) throw input.updateError
          config = next
          return { data: config }
        },
      },
      mcp: {
        connect: async ({ name }: { name: string }) => {
          calls.push(`connect:${name}`)
          return { data: { status: "connected" } }
        },
        auth: {
          authenticate: async ({ name }: { name: string }) => {
            calls.push(`authenticate:${name}`)
            return { data: { status: "connected" } }
          },
        },
      },
    },
    filesystem: {
      writeExtensionSkillFile: async (_directory: string, extensionID: string, relativePath: string, content: string) => {
        calls.push(`write:${managedSkillPath(extensionID, relativePath)}`)
        files.set(managedSkillPath(extensionID, relativePath), content)
      },
      removeExtensionSkillRoot: async (_directory: string, extensionID: string) => {
        calls.push(`remove:${extensionID}`)
        for (const key of Array.from(files.keys())) {
          if (key.startsWith(`${managedSkillPath(extensionID, "").slice(0, -1)}/`)) files.delete(key)
        }
      },
    },
    config: () => config,
  }
}

describe("installExtension", () => {
  test("writes managed skills, merges MCP config, connects, and refreshes", async () => {
    const h = harness({ config: { mcp: { existing: { type: "local", command: ["existing"] } } } })
    const calls = h.calls

    await installExtension({
      directory: "/repo",
      bundle: googleBundle(),
      client: h.client,
      filesystem: h.filesystem,
      refresh: async () => {
        calls.push("refresh")
      },
      setup: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      },
      storage: h.storage,
    })

    expect(calls).toEqual([
      "write:.agents/skills/extensions/google-calendar/skills/general/SKILL.md",
      "config.update",
      "connect:google_workspace_calendar",
      "refresh",
    ])
    expect(h.config().mcp).toMatchObject({
      existing: { type: "local", command: ["existing"] },
      google_workspace_calendar: {
        type: "local",
        command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
        environment: {
          GOOGLE_OAUTH_CLIENT_ID: "client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
          MCP_ENABLE_OAUTH21: "true",
        },
      },
    })
  })

  test("remote OAuth MCPs authenticate after install", async () => {
    const h = harness()
    await installExtension({
      directory: "/repo",
      bundle: googleBundle({
        mcp: {
          remote_auth: { type: "remote", url: "https://example.com/mcp" },
        },
      }),
      client: h.client,
      filesystem: h.filesystem,
      refresh: async () => undefined,
      setup: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      },
      storage: h.storage,
    })

    expect(h.calls).toContain("authenticate:remote_auth")
    expect(h.calls).not.toContain("connect:remote_auth")
  })

  test("requires setup values for env placeholders before installing", async () => {
    const h = harness()
    await expect(
      installExtension({
        directory: "/repo",
        bundle: googleBundle(),
        client: h.client,
        filesystem: h.filesystem,
        refresh: async () => undefined,
      }),
    ).rejects.toThrow("Enter GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET in Setup before installing Google Calendar.")

    expect(h.calls).toEqual([])
  })

  test("applies setup values to extension environment", () => {
    const bundle = googleBundle()
    expect(missingSetupVariables(bundle, { GOOGLE_OAUTH_CLIENT_ID: "client-id" })).toEqual(["GOOGLE_OAUTH_CLIENT_SECRET"])

    const next = applySetupValues(bundle, {
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    })

    const nextServer = next.mcp.google_workspace_calendar
    const originalServer = bundle.mcp.google_workspace_calendar
    expect(nextServer && "environment" in nextServer ? nextServer.environment : undefined).toMatchObject({
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      MCP_ENABLE_OAUTH21: "true",
    })
    expect(originalServer && "environment" in originalServer ? originalServer.environment?.GOOGLE_OAUTH_CLIENT_ID : undefined).toBe(
      "{env:GOOGLE_OAUTH_CLIENT_ID}",
    )
  })

  test("rejects path traversal and invalid skill frontmatter", () => {
    expect(() =>
      validateBundleSkills(
        googleBundle({
          skills: [{ path: "../SKILL.md", content: "---\nname: bad\ndescription: Bad\n---\n" }],
        }),
      ),
    ).toThrow("cannot traverse")

    expect(() =>
      validateBundleSkills(
        googleBundle({
          skills: [{ path: "skills/bad/SKILL.md", content: "---\nname: bad\n---\n" }],
        }),
      ),
    ).toThrow("description")
  })

  test("rolls back managed skills when config update fails", async () => {
    const h = harness({ updateError: new Error("config failed") })
    await expect(
      installExtension({
        directory: "/repo",
        bundle: googleBundle(),
        client: h.client,
        filesystem: h.filesystem,
        refresh: async () => undefined,
        setup: {
          GOOGLE_OAUTH_CLIENT_ID: "client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        },
        storage: h.storage,
      }),
    ).rejects.toThrow("config failed")

    expect(h.calls).toEqual([
      "write:.agents/skills/extensions/google-calendar/skills/general/SKILL.md",
      "config.update",
      "remove:google-calendar",
    ])
    expect(h.files.size).toBe(0)
  })
})

describe("removeExtension", () => {
  test("removes owned MCP config and managed skill root", async () => {
    const h = harness({
      config: {
        mcp: {
          google_workspace_calendar: { type: "local", command: ["uvx", "workspace-mcp"] },
          existing: { type: "local", command: ["existing"] },
        },
      },
    })
    h.files.set(".agents/skills/extensions/google-calendar/skills/general/SKILL.md", "content")

    await removeExtension({
      directory: "/repo",
      bundle: googleBundle(),
      client: h.client,
      filesystem: h.filesystem,
      refresh: async () => {
        h.calls.push("refresh")
      },
      storage: h.storage,
    })

    expect(h.config().mcp).toEqual({
      existing: { type: "local", command: ["existing"] },
    })
    expect(h.calls).toEqual(["config.update", "remove:google-calendar", "refresh"])
  })
})
