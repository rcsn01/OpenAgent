import { describe, expect, test } from "bun:test"
import type { ExtensionBundle } from "@/extensions/registry"
import { installExtension } from "./session-extensions-install"

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
    })

    expect(calls).toEqual(["install", "authenticate:google_workspace_calendar", "connect:google_workspace_calendar", "refresh"])
  })
})
