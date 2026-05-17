import { describe, expect, test } from "bun:test"
import { parse as parseJsonc } from "jsonc-parser"
import { patchJsonc } from "../../src/extension"

describe("extension config JSONC patching", () => {
  test("preserves empty objects like OAuth config", () => {
    const text = `{
  "mcp": {}
}
`

    const patched = patchJsonc(text, {
      mcp: {
        google_workspace_gmail: {
          type: "local",
          command: ["uvx", "workspace-mcp"],
          transport: {
            type: "streamable-http",
            host: "localhost",
            path: "/mcp",
            portEnv: "WORKSPACE_MCP_PORT",
          },
          oauth: {},
        },
      },
    })

    const data = parseJsonc(patched) as {
      mcp?: {
        google_workspace_gmail?: {
          oauth?: unknown
        }
      }
    }

    expect(data.mcp?.google_workspace_gmail?.oauth).toEqual({})
  })
})
