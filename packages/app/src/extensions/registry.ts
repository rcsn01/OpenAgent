import type { ExperimentalExtensionsInstallData } from "@opencode-ai/sdk/v2/client"

export type ExtensionBundle = NonNullable<ExperimentalExtensionsInstallData["body"]>

export type ExtensionSetup = {
  prerequisites?: string[]
  environment?: string[]
  steps?: string[]
  links?: Array<{
    label: string
    href: string
  }>
}

export type ExtensionRegistryEntry = ExtensionBundle & {
  tags?: string[]
  setup?: ExtensionSetup
}

export type ExtensionInstallAction = {
  key: string
  action: "authenticate" | "connect"
}

function installAction(config: ExtensionBundle["mcp"][string]): ExtensionInstallAction["action"] {
  if (config.type === "remote") {
    return config.oauth !== false ? "authenticate" : "connect"
  }

  if (config.transport?.type === "streamable-http" && config.oauth) {
    return "authenticate"
  }

  return "connect"
}

function skill(input: {
  slug: string
  title: string
  name: string
  description: string
  body: string[]
}): ExtensionBundle["skills"][number] {
  return {
    path: `skills/${input.slug}/SKILL.md`,
    content: ["---", `name: ${input.name}`, `description: ${input.description}`, "---", "", `# ${input.title}`, "", ...input.body].join("\n"),
  }
}

export function extensionInstallActions(bundle: ExtensionBundle): ExtensionInstallAction[] {
  return Object.entries(bundle.mcp).map(([key, config]) => ({
    key,
    action: installAction(config),
  }))
}

const googleCalendar = {
  id: "google-calendar",
  version: "2.0.0",
  name: "Google Calendar",
  description: "Google Calendar and Google Tasks for planning, scheduling, and meeting workflows.",
  tags: ["google", "calendar", "tasks", "scheduling", "productivity"],
  setup: {
    prerequisites: ["Python 3.10+ installed", "uv or uvx installed", "Google Cloud OAuth credentials created"],
    environment: ["GOOGLE_OAUTH_CLIENT_ID"],
    steps: [
      "Create a Google OAuth client in Google Cloud for a local desktop workflow.",
      "Export GOOGLE_OAUTH_CLIENT_ID before launching OpenCode Desktop.",
      "Install the extension to launch Google sign-in for google_workspace_calendar.",
    ],
    links: [{ label: "Workspace MCP docs", href: "https://github.com/taylorwilsdon/google_workspace_mcp" }],
  },
  mcp: {
    google_workspace_calendar: {
      type: "local" as const,
      enabled: false,
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
        type: "streamable-http" as const,
        host: "127.0.0.1",
        path: "/mcp",
        portEnv: "WORKSPACE_MCP_PORT",
      },
      oauth: {},
      environment: {
        GOOGLE_OAUTH_CLIENT_ID: "{env:GOOGLE_OAUTH_CLIENT_ID}",
        MCP_ENABLE_OAUTH21: "true",
        WORKSPACE_MCP_HOST: "127.0.0.1",
        OAUTHLIB_INSECURE_TRANSPORT: "1",
      },
    },
  },
  skills: [
    skill({
      slug: "general",
      title: "Google Calendar",
      name: "google-calendar:general",
      description: "Manage Google Calendar events and Google Tasks with one shared Workspace MCP backend.",
      body: [
        "Use this skill for general Google Calendar and Google Tasks work.",
        "",
        "Always use the `google_workspace_calendar` MCP server.",
        "",
        "## Workflow",
        "",
        "1. Confirm the relevant date range, timezone, and calendars when the request is ambiguous.",
        "2. Read existing events or tasks before mutating them when the current state matters.",
        "3. Use Calendar for time-bound commitments and Tasks for actionable follow-ups.",
        "4. Confirm destructive changes like deleting events or tasks before applying them.",
        "5. Summarize any changes you made, including new tasks, rescheduled meetings, or conflicts you noticed.",
      ],
    }),
    skill({
      slug: "daily-brief",
      title: "Daily Brief",
      name: "google-calendar:daily-brief",
      description: "Prepare a daily schedule summary from calendar events, open tasks, and available focus time.",
      body: [
        "Use this skill when the user wants a plan for today or another specific day.",
        "",
        "Always use the `google_workspace_calendar` MCP server.",
        "",
        "## Workflow",
        "",
        "1. Gather the day's calendar events, open tasks, and any obvious time gaps.",
        "2. Call out conflicts, back-to-back meetings, travel gaps, and overdue or urgent tasks.",
        "3. Suggest where tasks can attach to existing meetings or open focus windows.",
        "4. Only create new tasks or calendar blocks if the user explicitly asks you to apply the plan.",
      ],
    }),
    skill({
      slug: "free-up-time",
      title: "Free Up Time",
      name: "google-calendar:free-up-time",
      description: "Find ways to create more usable time by combining free/busy analysis with task and event review.",
      body: [
        "Use this skill when the user wants to make room in their schedule.",
        "",
        "Always use the `google_workspace_calendar` MCP server.",
        "",
        "## Workflow",
        "",
        "1. Inspect existing events, open tasks, and current focus windows before proposing changes.",
        "2. Use `query_freebusy` when you need a fast picture of open time across one or more calendars.",
        "3. Suggest the lowest-friction options first, such as moving flexible meetings, protecting focus time, or converting work into tasks.",
        "4. Present recommendations before making edits unless the user explicitly asks you to apply them.",
      ],
    }),
    skill({
      slug: "group-scheduler",
      title: "Group Scheduler",
      name: "google-calendar:group-scheduler",
      description: "Coordinate meeting times across attendees and calendars using free/busy information.",
      body: [
        "Use this skill when the user wants help finding or booking a time for multiple people.",
        "",
        "Always use the `google_workspace_calendar` MCP server.",
        "",
        "## Workflow",
        "",
        "1. Confirm attendees, meeting length, timezone, and any date constraints.",
        "2. Use `query_freebusy` to compare availability across the relevant calendars.",
        "3. Prefer returning two to five ranked options with a brief rationale before booking.",
        "4. Only create the meeting once the user has chosen an option or explicitly asked you to book the best one.",
      ],
    }),
    skill({
      slug: "meeting-prep",
      title: "Meeting Prep",
      name: "google-calendar:meeting-prep",
      description: "Prepare for upcoming meetings by reviewing event details, related work, and follow-up tasks.",
      body: [
        "Use this skill when the user wants to prepare for an upcoming meeting.",
        "",
        "Always use the `google_workspace_calendar` MCP server.",
        "",
        "## Workflow",
        "",
        "1. Review the target meeting's timing, attendees, notes, and nearby schedule constraints.",
        "2. Surface related tasks, prep gaps, and any missing buffers before the meeting starts.",
        "3. Suggest a concise prep plan, including reading, task follow-ups, or focus time if useful.",
        "4. If the user asks, create prep tasks or calendar blocks tied to the meeting.",
      ],
    }),
  ],
} satisfies ExtensionRegistryEntry

export const OFFICIAL_EXTENSIONS: ExtensionRegistryEntry[] = [googleCalendar]
