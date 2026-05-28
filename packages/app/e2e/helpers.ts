import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { Page, TestInfo } from "@playwright/test"
import { createOpenAgentClient, type Session } from "@openagent-ai/sdk/v2/client"

const execFileAsync = promisify(execFile)
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4197"
const serverBaseURL = process.env.PLAYWRIGHT_SERVER_BASE_URL ?? `http://${serverHost}:${serverPort}`

const defaultProjectAgent = "build"
const defaultChatAgent = "chat"
const defaultModel = {
  providerID: "opencode",
  modelID: "big-pickle",
}

type PromptTarget = {
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
}

export function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export function sdk(directory?: string) {
  return createOpenAgentClient({
    baseUrl: serverBaseURL,
    ...(directory ? { directory } : {}),
  })
}

export async function createGitProject(
  testInfo: TestInfo,
  name: string,
  files: Record<string, string> = { "README.md": `# ${name}\n` },
) {
  const directory = testInfo.outputPath(name)
  await fs.mkdir(directory, { recursive: true })

  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const target = path.join(directory, file)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    }),
  )

  await execFileAsync("git", ["init", "-b", "main"], { cwd: directory })
  await execFileAsync("git", ["config", "user.email", "e2e@example.com"], { cwd: directory })
  await execFileAsync("git", ["config", "user.name", "OpenAgent E2E"], { cwd: directory })
  await execFileAsync("git", ["add", "."], { cwd: directory })
  await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: directory })

  return directory
}

export async function createProjectSession(input: { directory: string; prompt?: string; title?: string } & PromptTarget) {
  const client = sdk(input.directory)
  const created = await client.session.create(input.title ? { title: input.title } : undefined)

  if (input.prompt) {
    await client.session.prompt({
      sessionID: created.data.id,
      parts: [{ type: "text", text: input.prompt }],
      agent: input.agent ?? defaultProjectAgent,
      model: input.model ?? defaultModel,
    })
    await waitForProjectTurn({
      directory: input.directory,
      sessionID: created.data.id,
      userText: input.prompt,
    })
  }

  return created.data
}

export async function createGeneralChat(input?: { prompt?: string } & PromptTarget) {
  const client = sdk()
  const created = await client.experimental.chat.create()

  if (input?.prompt) {
    await client.session.prompt({
      sessionID: created.data.rootSessionID,
      parts: [{ type: "text", text: input.prompt }],
      agent: input.agent ?? defaultChatAgent,
      model: input.model ?? defaultModel,
    })
  }

  return created.data
}

export async function getGeneralChat(sessionID: string) {
  return sdk().experimental.chat.get({ sessionID }).then((result) => result.data)
}

export async function getSessionMessages(directory: string, sessionID: string) {
  return sdk(directory).session.messages({ sessionID }).then((result) => result.data ?? [])
}

export function messageText(message: { parts?: Array<{ type: string; text?: string }> }) {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .trim()
}

export async function waitForProjectTurn(input: {
  directory: string
  sessionID: string
  userText: string
  assistantText?: RegExp
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? 30_000
  const start = Date.now()
  let lastMessages:
    | Array<{
        role: string
        completed: unknown
        text: string
      }>
    | undefined

  while (Date.now() - start < timeoutMs) {
    const messages = await getSessionMessages(input.directory, input.sessionID)
    lastMessages = messages.map((message) => ({
      role: message.info.role,
      completed: message.info.time.completed,
      text: messageText(message),
    }))

    const matchingUsers = messages.filter(
      (message) => message.info.role === "user" && messageText(message).includes(input.userText),
    )
    const completedAssistants = messages.filter((message) => {
      if (message.info.role !== "assistant") return false
      if (typeof message.info.time.completed !== "number") return false
      if (!input.assistantText) return true
      return input.assistantText.test(messageText(message))
    })

    if (matchingUsers.length === 1 && completedAssistants.length > 0) {
      return {
        messages,
        user: matchingUsers[0],
        assistants: completedAssistants,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(
    [
      `Timed out waiting for project turn ${input.sessionID} to complete`,
      `directory: ${input.directory}`,
      `messages: ${JSON.stringify(lastMessages ?? [], null, 2)}`,
    ].join("\n"),
  )
}

export async function waitForGeneralChatTurn(input: {
  sessionID: string
  userText: string
  assistantText?: RegExp
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? 30_000
  const start = Date.now()
  let lastDirectory = ""
  let lastMessages:
    | Array<{
        role: string
        completed: unknown
        text: string
      }>
    | undefined

  while (Date.now() - start < timeoutMs) {
    const chat = await getGeneralChat(input.sessionID)
    if (!chat?.directory) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }

    lastDirectory = chat.directory

    const messages = await getSessionMessages(chat.directory, input.sessionID)
    lastMessages = messages.map((message) => ({
      role: message.info.role,
      completed: message.info.time.completed,
      text: messageText(message),
    }))
    const matchingUsers = messages.filter(
      (message) => message.info.role === "user" && messageText(message).includes(input.userText),
    )
    const completedAssistants = messages.filter((message) => {
      if (message.info.role !== "assistant") return false
      if (typeof message.info.time.completed !== "number") return false
      if (!input.assistantText) return true
      return input.assistantText.test(messageText(message))
    })

    if (matchingUsers.length === 1 && completedAssistants.length > 0) {
      return {
        chat,
        messages,
        user: matchingUsers[0],
        assistants: completedAssistants,
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(
    [
      `Timed out waiting for general chat turn ${input.sessionID} to complete`,
      `directory: ${lastDirectory || "<unresolved>"}`,
      `messages: ${JSON.stringify(lastMessages ?? [], null, 2)}`,
    ].join("\n"),
  )
}

export async function deleteGeneralChats() {
  const client = sdk()
  const list = await client.experimental.chat.list()

  await Promise.all(
    (list.data ?? []).map((chat) =>
      client.experimental.chat.delete({
        sessionID: chat.rootSessionID,
      }),
    ),
  )
}

export async function deleteProjectSessions(directory: string) {
  const client = sdk(directory)
  const sessions = await client.session.list()

  await Promise.all(
    (sessions.data ?? []).map((session) =>
      client.session.delete({
        sessionID: session.id,
      }),
    ),
  )
}

export async function seedAppState(
  page: Page,
  input: {
    projects?: Array<{ worktree: string; expanded?: boolean; pinned?: boolean }>
    lastProject?: string
    sidebar?: { opened?: boolean; width?: number }
    layoutPage?: Record<string, unknown>
  },
) {
  await page.addInitScript((state) => {
    const markerKey = "__opencode_e2e_seed__"
    const marker = JSON.stringify(state)

    if (sessionStorage.getItem(markerKey) === marker) return

    sessionStorage.setItem(markerKey, marker)
    localStorage.clear()

    const serverState = {
      list: [],
      projects: {
        local: (state.projects ?? []).map((project) => ({
          worktree: project.worktree,
          expanded: project.expanded ?? true,
          pinned: project.pinned ?? false,
        })),
      },
      lastProject: state.lastProject ? { local: state.lastProject } : {},
    }

    const layoutState = {
      sidebar: {
        opened: state.sidebar?.opened ?? true,
        width: state.sidebar?.width ?? 256,
        workspaces: {},
        workspacesDefault: false,
      },
      mobileSidebar: {
        opened: false,
      },
    }

    localStorage.setItem("opencode.global.dat:server", JSON.stringify(serverState))
    localStorage.setItem("opencode.global.dat:layout", JSON.stringify(layoutState))

    if (state.layoutPage) {
      localStorage.setItem("opencode.global.dat:layout.page", JSON.stringify(state.layoutPage))
    }
  }, input)
}

export function sessionRoute(directory: string, session: Pick<Session, "id"> | { id: string }) {
  return `/${base64Url(directory)}/session/${session.id}`
}
