import { describe, expect, test } from "bun:test"
import { extensionInstallActions, OFFICIAL_EXTENSIONS } from "./registry"

function frontmatterValue(content: string, key: string) {
  return content.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1]
}

describe("OFFICIAL_EXTENSIONS", () => {
  test("ships the requested user-facing extensions", () => {
    expect(OFFICIAL_EXTENSIONS.map((item) => item.id)).toEqual([
      "computer-use",
      "gmail",
      "google-drive",
      "teams",
      "outlook",
      "google-calendar",
    ])
  })

  test("includes a native Computer Use extension", () => {
    const extension = OFFICIAL_EXTENSIONS.find((item) => item.id === "computer-use")
    expect(extension).toMatchObject({
      name: "Computer Use",
      mcp: {
        computer_use: {
          type: "builtin",
          id: "computer-use",
          enabled: true,
        },
      },
    })
    expect(extension?.skills.map((item) => frontmatterValue(item.content, "name"))).toEqual(["computer-use:general"])
    expect(extension?.skills[0]?.content).toContain("your first action after loading this skill must be a Computer Use tool call")
    expect(extension?.skills[0]?.content).toContain("Never infer success from a tool returning no output")
    expect(extension?.skills[0]?.content).toContain("When sending a message, confirm only after you can see the sent message bubble")
    expect(extension?.skills[0]?.content).toContain("click tool supports either element_index/element_id")
    expect(extension?.skills[0]?.content).toContain("Element indexes are snapshots, not stable IDs")
    expect(extension?.skills[0]?.content).toContain("For Calculator and similar keypad apps, prefer keyboard input")
    expect(extension?.skills[0]?.content).toContain("always pass the app name or bundle identifier")
    expect(extension?.skills[0]?.content).toContain("Do not compile or run helper programs")
    expect(extensionInstallActions(extension!)).toEqual([{ key: "computer_use", action: "connect" }])
  })

  test("includes Gmail and Drive as individual Google Workspace extensions", () => {
    const gmail = OFFICIAL_EXTENSIONS.find((item) => item.id === "gmail")
    const drive = OFFICIAL_EXTENSIONS.find((item) => item.id === "google-drive")

    expect(gmail?.mcp.google_workspace_gmail).toMatchObject({
      type: "local",
      command: expect.arrayContaining(["workspace-mcp", "gmail:send"]),
      oauth: {},
    })
    expect(drive?.mcp.google_workspace_drive).toMatchObject({
      type: "local",
      command: expect.arrayContaining(["workspace-mcp", "drive:full"]),
      oauth: {},
    })
    expect(extensionInstallActions(gmail!)).toEqual([{ key: "google_workspace_gmail", action: "authenticate" }])
    expect(extensionInstallActions(drive!)).toEqual([{ key: "google_workspace_drive", action: "authenticate" }])
  })

  test("includes Teams and Outlook with Microsoft Graph tool filters", () => {
    const teams = OFFICIAL_EXTENSIONS.find((item) => item.id === "teams")
    const outlook = OFFICIAL_EXTENSIONS.find((item) => item.id === "outlook")

    expect(teams?.mcp.microsoft_teams).toMatchObject({
      type: "local",
      command: ["uvx", "graph-mcp"],
      tool_filter: {
        allow_prefixes: expect.arrayContaining(["chat_", "teams_", "channel_", "presence_", "search_"]),
      },
    })
    expect(outlook?.mcp.microsoft_outlook).toMatchObject({
      type: "local",
      command: ["uvx", "graph-mcp"],
      tool_filter: {
        allow_prefixes: expect.arrayContaining(["mail_", "calendar_", "meeting_", "files_"]),
      },
    })
  })

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
          builtin_tool: { type: "builtin", id: "computer-use" },
        },
        skills: [{ path: "skills/demo/SKILL.md", content: "---\nname: mixed:demo\ndescription: Demo\n---\n" }],
      } as any),
    ).toEqual([
      { key: "remote_auth", action: "authenticate" },
      { key: "remote_plain", action: "connect" },
      { key: "local_auth", action: "authenticate" },
      { key: "local_tool", action: "connect" },
      { key: "builtin_tool", action: "connect" },
    ])
  })
})
