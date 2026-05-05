import { describe, expect, test } from "bun:test"
import { extensionInstallActions, OFFICIAL_EXTENSIONS } from "./registry"

function frontmatterValue(content: string, key: string) {
  return content.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1]
}

describe("OFFICIAL_EXTENSIONS", () => {
  test("includes a bundled Google Calendar extension with the expected MCP config", () => {
    const extension = OFFICIAL_EXTENSIONS.find((item) => item.id === "google-calendar")
    const server = extension?.mcp.google_workspace_calendar

    expect(extension).toMatchObject({
      id: "google-calendar",
      version: "2.0.1",
      name: "Google Calendar",
      tags: expect.arrayContaining(["google", "calendar", "tasks"]),
      setup: {
        prerequisites: expect.arrayContaining(["Python 3.10+ installed"]),
        environment: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
      },
    })
    expect(server).toEqual({
      type: "local",
      enabled: true,
      command: [
        "uvx",
        "workspace-mcp",
        "--transport",
        "streamable-http",
        "--permissions",
        "calendar:full",
        "tasks:full",
        "--tool-tier",
        "extended",
      ],
      transport: {
        type: "streamable-http",
        host: "localhost",
        path: "/mcp",
        portEnv: "WORKSPACE_MCP_PORT",
      },
      oauth: {},
      environment: {
        GOOGLE_OAUTH_CLIENT_ID: "{env:GOOGLE_OAUTH_CLIENT_ID}",
        GOOGLE_OAUTH_CLIENT_SECRET: "{env:GOOGLE_OAUTH_CLIENT_SECRET}",
        MCP_ENABLE_OAUTH21: "true",
        WORKSPACE_MCP_HOST: "localhost",
        OAUTHLIB_INSECURE_TRANSPORT: "1",
      },
    })
  })

  test("ships the five Google Calendar skills with prefixed names", () => {
    const extension = OFFICIAL_EXTENSIONS.find((item) => item.id === "google-calendar")
    const skills = extension?.skills ?? []

    expect(skills).toHaveLength(5)
    expect(skills.map((item) => item.path)).toEqual([
      "skills/general/SKILL.md",
      "skills/daily-brief/SKILL.md",
      "skills/free-up-time/SKILL.md",
      "skills/group-scheduler/SKILL.md",
      "skills/meeting-prep/SKILL.md",
    ])
    expect(skills.map((item) => frontmatterValue(item.content, "name"))).toEqual([
      "google-calendar:general",
      "google-calendar:daily-brief",
      "google-calendar:free-up-time",
      "google-calendar:group-scheduler",
      "google-calendar:meeting-prep",
    ])
    expect(skills.map((item) => frontmatterValue(item.content, "description"))).toEqual([
      "Manage Google Calendar events and Google Tasks with one shared Workspace MCP backend.",
      "Prepare a daily schedule summary from calendar events, open tasks, and available focus time.",
      "Find ways to create more usable time by combining free/busy analysis with task and event review.",
      "Coordinate meeting times across attendees and calendars using free/busy information.",
      "Prepare for upcoming meetings by reviewing event details, related work, and follow-up tasks.",
    ])
  })

  test("authenticates the bundled Google Calendar MCP immediately after install", () => {
    const extension = OFFICIAL_EXTENSIONS.find((item) => item.id === "google-calendar")

    expect(extensionInstallActions(extension!)).toEqual([{ key: "google_workspace_calendar", action: "authenticate" }])
  })

  test("uses authenticate for remote OAuth servers and connect otherwise", () => {
    expect(
      extensionInstallActions({
        id: "mixed",
        version: "1.0.0",
        name: "Mixed",
        mcp: {
          remote_auth: { type: "remote", url: "https://example.com/mcp" },
          remote_plain: { type: "remote", url: "https://example.com/plain", oauth: false },
          local_auth: {
            type: "local",
            command: ["demo"],
            transport: { type: "streamable-http", host: "127.0.0.1", path: "/mcp", portEnv: "DEMO_PORT" },
            oauth: {},
          },
          local_tool: { type: "local", command: ["demo"] },
        },
        skills: [{ path: "skills/demo/SKILL.md", content: "---\nname: mixed:demo\ndescription: Demo\n---\n" }],
      } as any),
    ).toEqual([
      { key: "remote_auth", action: "authenticate" },
      { key: "remote_plain", action: "connect" },
      { key: "local_auth", action: "authenticate" },
      { key: "local_tool", action: "connect" },
    ])
  })
})
