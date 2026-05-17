import { describe, expect, test } from "bun:test"
import type { ExtensionBundle } from "@/extensions/registry"
import { applySetupValues, installExtension, missingSetupVariables } from "./install"

function googleBundle() {
  return {
    id: "google-calendar",
    version: "2.0.0",
    name: "Google Calendar",
    mcp: {
      google_workspace_calendar: {
        type: "local",
        command: ["uvx", "workspace-mcp", "--transport", "streamable-http"],
        transport: {
          type: "streamable-http",
          host: "127.0.0.1",
          path: "/mcp",
          portEnv: "WORKSPACE_MCP_PORT",
        },
        oauth: {},
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
  } as unknown as ExtensionBundle
}

describe("installExtension", () => {
  test("installing Google Calendar triggers MCP authentication instead of plain connect", async () => {
    const calls: string[] = []

    await installExtension({
      bundle: googleBundle(),
      client: {
        experimental: {
          install: async () => {
            calls.push("install")
          },
        },
        mcp: {
          connect: async ({ name }) => {
            calls.push(`connect:${name}`)
          },
          auth: {
            authenticate: async ({ name }) => {
              calls.push(`authenticate:${name}`)
            },
          },
        },
      },
      refresh: async () => {
        calls.push("refresh")
      },
      setup: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      },
    })

    expect(calls).toEqual(["install", "authenticate:google_workspace_calendar", "refresh"])
    expect(calls).not.toContain("connect:google_workspace_calendar")
  })

  test("structured authentication failures surface as real errors", async () => {
    const calls: string[] = []

    await expect(
      installExtension({
        bundle: googleBundle(),
        client: {
          experimental: {
            install: async () => {
              calls.push("install")
              return { data: true }
            },
          },
          mcp: {
            connect: async ({ name }) => {
              calls.push(`connect:${name}`)
              return { data: true }
            },
            auth: {
              authenticate: async ({ name }) => {
                calls.push(`authenticate:${name}`)
                return {
                  data: {
                    status: "failed",
                    error: "Google sign-in did not complete",
                  },
                }
              },
            },
          },
        },
        refresh: async () => {
          calls.push("refresh")
        },
        setup: {
          GOOGLE_OAUTH_CLIENT_ID: "client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        },
      }),
    ).rejects.toThrow("Google sign-in did not complete")

    expect(calls).toEqual(["install", "authenticate:google_workspace_calendar"])
  })

  test("disabled auth responses immediately follow through with connect", async () => {
    const calls: string[] = []

    await installExtension({
      bundle: googleBundle(),
      client: {
        experimental: {
          install: async () => {
            calls.push("install")
            return { data: true }
          },
        },
        mcp: {
          connect: async ({ name }) => {
            calls.push(`connect:${name}`)
            return { data: true }
          },
          auth: {
            authenticate: async ({ name }) => {
              calls.push(`authenticate:${name}`)
              return {
                data: {
                  status: "disabled",
                },
              }
            },
          },
        },
      },
      refresh: async () => {
        calls.push("refresh")
      },
      setup: {
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
      },
    })

    expect(calls).toEqual(["install", "authenticate:google_workspace_calendar", "connect:google_workspace_calendar", "refresh"])
  })

  test("requires setup values for env placeholders before installing", async () => {
    await expect(
      installExtension({
        bundle: googleBundle(),
        client: {
          experimental: {
            install: async () => {
              throw new Error("should not install")
            },
          },
          mcp: {
            connect: async () => undefined,
            auth: {
              authenticate: async () => undefined,
            },
          },
        },
        refresh: async () => undefined,
      }),
    ).rejects.toThrow("Enter GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET in Setup before installing Google Calendar.")
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
})
