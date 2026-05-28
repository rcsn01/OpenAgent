import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { EventHub } from "./events"
import { openAgentHome } from "./home"
import { randomID, rolloutTimestamp } from "./ids"
import { runtimeLog } from "./log"
import {
  apiKeyFromAuthEntry,
  customProviderBaseUrl,
  getStoredApiKey,
  readAuth,
  readConfig,
  removeStoredAuth,
  setStoredApiKey,
  updateConfig,
  type AuthFile,
  type CustomProviderConfig,
  type OpenAgentConfig,
} from "./provider-store"
import { SessionStore } from "./storage"
import type {
  AgentInfo,
  Message,
  Part,
  PermissionRequest,
  PermissionResponse,
  PromptAsyncInput,
  Provider,
  ProviderAuthResponse,
  ProviderModel,
  ProviderListResponse,
  RuntimeContext,
  RuntimeResult,
  Session,
  SessionStatus,
  TextPart,
} from "./types"

const OLLAMA_LOCAL_PROVIDER = "ollama"
const OLLAMA_CLOUD_PROVIDER = "ollama-cloud"
const OLLAMA_LOCAL_API = "http://localhost:11434/api"
const OLLAMA_CLOUD_API = "https://ollama.com/api"
const OLLAMA_CLOUD_FALLBACK_MODELS = ["gpt-oss:120b"]

export type PiCompletion = {
  text: string
}

export type PiAdapter = {
  listProviders(): Promise<ProviderListResponse>
  complete(input: {
    session: Session
    messages: Array<{ role: "user" | "assistant"; content: string }>
    prompt: string
    model?: PromptAsyncInput["model"]
    signal: AbortSignal
  }): Promise<PiCompletion>
}

function ok<T>(data: T): RuntimeResult<T> {
  return { data }
}

function err(error: unknown): RuntimeResult {
  if (error instanceof Error) return { error: { name: error.name, message: error.message } }
  return { error: { message: String(error) } }
}

function cwd(ctx: RuntimeContext) {
  return ctx.directory || process.cwd()
}

function projectFor(directory: string) {
  return {
    id: directory,
    worktree: directory,
    name: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory,
  }
}

function textFromParts(parts: PromptAsyncInput["parts"] = []) {
  return parts
    .map((part) => {
      if (part.type === "text" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text
      if (part.type === "file" && typeof (part as { filename?: unknown }).filename === "string") {
        return `[file: ${(part as { filename: string }).filename}]`
      }
      if (part.type === "agent" && typeof (part as { name?: unknown }).name === "string") {
        return `[agent: ${(part as { name: string }).name}]`
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

type PromptPartInput = NonNullable<PromptAsyncInput["parts"]>[number]

function normalizePart(sessionID: string, messageID: string, part: PromptPartInput): Part {
  if (part.type === "file") {
    return {
      id: part.id,
      sessionID,
      messageID,
      type: "file",
      mime: (part as { mime?: string }).mime,
      filename: (part as { filename?: string }).filename,
      url: (part as { url?: string }).url,
      source: (part as { source?: unknown }).source,
    }
  }
  if (part.type === "agent") {
    return {
      id: part.id,
      sessionID,
      messageID,
      type: "agent",
      name: (part as { name?: string }).name ?? "agent",
      source: (part as { source?: unknown }).source,
    }
  }
  return {
    id: part.id,
    sessionID,
    messageID,
    type: "text",
    text: (part as { text?: string }).text ?? "",
    synthetic: (part as { synthetic?: boolean }).synthetic,
    ignored: (part as { ignored?: boolean }).ignored,
    time: (part as { time?: unknown }).time,
    metadata: (part as { metadata?: unknown }).metadata,
  }
}

export class OpenAgentRuntime {
  readonly store: SessionStore
  readonly events: EventHub
  private adapter: PiAdapter
  private aborters = new Map<string, AbortController>()
  private status = new Map<string, SessionStatus>()
  private permissions = new Map<string, PermissionRequest>()

  constructor(input: { store?: SessionStore; events?: EventHub; adapter?: PiAdapter } = {}) {
    this.store = input.store ?? new SessionStore()
    this.events = input.events ?? new EventHub()
    this.adapter = input.adapter ?? createDefaultPiAdapter()
  }

  async call(method: string, input: unknown, context: RuntimeContext = {}): Promise<RuntimeResult> {
    try {
      switch (method) {
        case "global.health":
          return ok({ healthy: true, version: "openagent-server" })
        case "global.config.get":
        case "config.get":
          return ok(await readConfig())
        case "experimental.console.get":
          return ok({
            activeOrgName: undefined,
            consoleManagedProviders: [],
            switchableOrgCount: 0,
          })
        case "experimental.console.listOrgs":
          return ok({ orgs: [] })
        case "experimental.extensions.list":
          return ok({ installed: [], available: [], servers: {} })
        case "path.get":
          return ok(await this.pathGet(context))
        case "project.list":
        case "project.opened":
          return ok([projectFor(cwd(context))])
        case "project.current":
        case "project.update":
          return ok(projectFor(cwd(context)))
        case "formatter.status":
          return ok({})
        case "vcs.get":
          return ok({})
        case "command.list":
          return ok([])
        case "provider.list":
          return ok(await this.adapter.listProviders())
        case "provider.auth":
          return ok(await providerAuth())
        case "provider.oauth.authorize":
        case "provider.oauth.callback":
          return { error: { message: "OAuth provider linking is not supported yet. Use API key linking.", code: "UNSUPPORTED" } }
        case "auth.set":
          return ok(await this.authSet(input))
        case "auth.remove":
          return ok(await this.authRemove(input))
        case "global.dispose":
          this.events.emit("global", { type: "global.disposed", properties: {} })
          return ok({ ok: true })
        case "app.agents":
          return ok([{ name: "assistant", mode: "primary", description: "Default OpenAgent assistant" }] satisfies AgentInfo[])
        case "session.create":
          return ok(await this.sessionCreate(input, context))
        case "session.list":
          return ok(await this.sessionList(input, context))
        case "session.get":
          return ok(await this.requireSession(input))
        case "session.update":
          return ok(await this.sessionUpdate(input))
        case "session.delete":
          return ok(await this.sessionDelete(input))
        case "session.messages":
          return ok(await this.sessionMessages(input))
        case "session.promptAsync":
          return ok(await this.promptAsync(input))
        case "session.abort":
          return ok(await this.abort(input))
        case "session.status":
          return ok(await this.sessionStatus(input))
        case "session.children":
        case "session.diff":
        case "session.todo":
        case "worktree.list":
        case "mcp.status":
          return ok(method === "mcp.status" ? {} : [])
        case "permission.list":
          return ok([...this.permissions.values()])
        case "permission.respond":
          return ok(await this.permissionRespond(input))
        case "question.list":
        case "lsp.status":
        case "file.list":
        case "find.files":
        case "experimental.plugins.list":
        case "experimental.chat.list":
          return ok([])
        case "file.read":
          return ok(await this.fileRead(input, context))
        case "global.config.update":
          return ok(await this.configUpdate(input))
        default:
          void runtimeLog("warn", "unsupported_runtime_method", { method })
          return { error: { message: `Unsupported runtime method: ${method}`, code: "UNSUPPORTED" } }
      }
    } catch (error) {
      void runtimeLog("error", "runtime_call_failed", {
        method,
        error: error instanceof Error ? error.message : String(error),
      })
      return err(error)
    }
  }

  private async pathGet(context: RuntimeContext) {
    const home = openAgentHome()
    const directory = cwd(context)
    return {
      state: home,
      config: join(home, "config.json"),
      worktree: directory,
      directory,
      home: process.env.HOME || home,
    }
  }

  private async sessionCreate(input: unknown, context: RuntimeContext) {
    const record = (input ?? {}) as { title?: string; parentID?: string; directory?: string }
    const session = await this.store.create({
      directory: record.directory || cwd(context),
      title: record.title,
      parentID: record.parentID,
    })
    this.events.emit(session.directory, { type: "session.created", properties: { info: session } })
    return session
  }

  private async sessionList(input: unknown, context: RuntimeContext) {
    const query = (input ?? {}) as { directory?: string; roots?: boolean; limit?: number; excludeAutomation?: string }
    return this.store.list({
      directory: query.directory || cwd(context),
      roots: query.roots,
      limit: query.limit,
    })
  }

  private async requireSession(input: unknown) {
    const sessionID = (input as { sessionID?: string } | undefined)?.sessionID
    if (!sessionID) throw new Error("sessionID is required")
    const session = await this.store.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  private async sessionUpdate(input: unknown) {
    const record = (input ?? {}) as { sessionID?: string; title?: string }
    if (!record.sessionID) throw new Error("sessionID is required")
    const session = await this.store.update(record.sessionID, { title: record.title })
    this.events.emit(session.directory, { type: "session.updated", properties: { info: session } })
    return session
  }

  private async sessionDelete(input: unknown) {
    const session = await this.requireSession(input)
    const archived = await this.store.archive(session.id)
    this.events.emit(archived.directory, { type: "session.deleted", properties: { info: archived } })
    return archived
  }

  private async sessionMessages(input: unknown) {
    const record = (input ?? {}) as { sessionID?: string; limit?: number; before?: string }
    if (!record.sessionID) throw new Error("sessionID is required")
    const page = await this.store.messages(record.sessionID, { limit: record.limit, before: record.before })
    void runtimeLog("info", "session_messages", {
      sessionID: record.sessionID,
      count: page.items.length,
      cursor: page.cursor,
      limit: record.limit,
      before: record.before,
    })
    return { items: page.items, cursor: page.cursor }
  }

  private async promptAsync(input: unknown) {
    const prompt = input as PromptAsyncInput
    if (!prompt?.sessionID) throw new Error("sessionID is required")
    if (!prompt.model?.providerID || !prompt.model?.modelID) {
      throw new Error("A provider and model are required before sending a prompt.")
    }
    const session = await this.requireSession({ sessionID: prompt.sessionID })
    const messageID = prompt.messageID || randomID("msg")
    const now = Date.now()
    const userMessage: Message = {
      id: messageID,
      sessionID: session.id,
      role: "user",
      time: { created: now, completed: now },
      agent: prompt.agent,
      model: prompt.model ? { ...prompt.model, variant: prompt.variant } : undefined,
    }
    const userParts = (prompt.parts ?? []).map((part) => normalizePart(session.id, messageID, part))
    await this.store.append(session.id, { timestamp: rolloutTimestamp(), type: "turn_context", payload: { model: prompt.model, agent: prompt.agent } })
    await this.persistMessage(session, userMessage, userParts)

    const assistantMessage: Message = {
      id: randomID("msg"),
      sessionID: session.id,
      role: "assistant",
      parentID: userMessage.id,
      time: { created: Date.now() },
      agent: prompt.agent,
      model: prompt.model ? { ...prompt.model, variant: prompt.variant } : undefined,
    }
    const assistantPart: TextPart = {
      id: randomID("part"),
      sessionID: session.id,
      messageID: assistantMessage.id,
      type: "text",
      text: "",
    }
    this.setStatus(session, { type: "busy" })
    this.events.emit(session.directory, { type: "message.updated", properties: { info: assistantMessage } })
    this.events.emit(session.directory, { type: "message.part.updated", properties: { part: assistantPart } })

    void runtimeLog("info", "prompt_started", {
      sessionID: session.id,
      providerID: prompt.model.providerID,
      modelID: prompt.model.modelID,
    })
    const abort = new AbortController()
    this.aborters.set(session.id, abort)
    try {
      const history = await this.messageHistory(session.id)
      const completion = await this.adapter.complete({
        session,
        messages: history,
        prompt: textFromParts(prompt.parts),
        model: prompt.model,
        signal: abort.signal,
      })
      assistantPart.text = completion.text
      assistantMessage.time.completed = Date.now()
      await this.persistMessage(session, assistantMessage, [assistantPart])
      this.setStatus(session, { type: "idle" })
      void runtimeLog("info", "prompt_completed", {
        sessionID: session.id,
        messageID: assistantMessage.id,
        providerID: prompt.model.providerID,
        modelID: prompt.model.modelID,
        chars: completion.text.length,
      })
      return {
        sessionID: session.id,
        messageID: assistantMessage.id,
        messages: [userMessage, assistantMessage],
        parts: [...userParts, assistantPart],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void runtimeLog("error", "prompt_failed", {
        sessionID: session.id,
        providerID: prompt.model.providerID,
        modelID: prompt.model.modelID,
        error: message,
      })
      await this.store.append(session.id, { timestamp: rolloutTimestamp(), type: "error", payload: { sessionID: session.id, message } })
      this.setStatus(session, { type: "idle" })
      this.events.emit(session.directory, { type: "session.error", properties: { sessionID: session.id, error: message } })
      throw error
    } finally {
      this.aborters.delete(session.id)
    }
  }

  private async persistMessage(session: Session, message: Message, parts: Part[]) {
    await this.store.append(session.id, { timestamp: rolloutTimestamp(), type: "message", payload: message })
    this.events.emit(session.directory, { type: "message.updated", properties: { info: message } })
    for (const part of parts) {
      await this.store.append(session.id, { timestamp: rolloutTimestamp(), type: "part", payload: part })
      this.events.emit(session.directory, { type: "message.part.updated", properties: { part } })
    }
    const nextTitle = session.title === "New session" && message.role === "user" ? summarizeTitle(parts) : session.title
    if (nextTitle !== session.title) {
      const updated = await this.store.update(session.id, { title: nextTitle })
      this.events.emit(updated.directory, { type: "session.updated", properties: { info: updated } })
    }
  }

  private async messageHistory(sessionID: string) {
    const page = await this.store.messages(sessionID, { limit: 200 })
    return page.items.map((item) => ({
      role: item.info.role,
      content: item.parts
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    }))
  }

  private async abort(input: unknown) {
    const session = await this.requireSession(input)
    this.aborters.get(session.id)?.abort()
    await this.store.append(session.id, { timestamp: rolloutTimestamp(), type: "abort", payload: { sessionID: session.id } })
    this.setStatus(session, { type: "idle" })
    return { ok: true }
  }

  private async sessionStatus(input: unknown) {
    const sessionID = (input as { sessionID?: string } | undefined)?.sessionID
    if (!sessionID) return {}
    return this.status.get(sessionID) ?? { type: "idle" }
  }

  private setStatus(session: Session, status: SessionStatus) {
    this.status.set(session.id, status)
    this.events.emit(session.directory, { type: "session.status", properties: { sessionID: session.id, status } })
  }

  private async permissionRespond(input: unknown) {
    const response = input as PermissionResponse
    const key = response.permissionID
    const request = this.permissions.get(key)
    if (request) {
      this.permissions.delete(key)
      this.events.emit(request.sessionID, {
        type: "permission.replied",
        properties: { sessionID: request.sessionID, requestID: request.id },
      })
    }
    return { ok: true }
  }

  private async fileRead(input: unknown, context: RuntimeContext) {
    const path = (input as { path?: string } | undefined)?.path
    if (!path) return undefined
    const file = resolve(cwd(context), path)
    const content = await readFile(file, "utf8")
    return { type: "raw", content }
  }

  private async authSet(input: unknown) {
    const record = input as { providerID?: string; auth?: { type?: string; key?: string } } | undefined
    const providerID = record?.providerID?.trim()
    const key = record?.auth?.key?.trim()
    if (!providerID) throw new Error("providerID is required")
    if (record?.auth?.type !== "api") throw new Error("Only API key provider auth is supported.")
    if (!key) throw new Error("API key is required")
    await setStoredApiKey(providerID, key)
    return { ok: true }
  }

  private async authRemove(input: unknown) {
    const providerID = (input as { providerID?: string } | undefined)?.providerID?.trim()
    if (!providerID) throw new Error("providerID is required")
    await removeStoredAuth(providerID)
    return { ok: true }
  }

  private async configUpdate(input: unknown) {
    const patch = ((input as { config?: OpenAgentConfig } | undefined)?.config ?? {}) as OpenAgentConfig
    const next = await updateConfig(patch)
    this.events.emit("global", { type: "global.disposed", properties: {} })
    return next
  }
}

function summarizeTitle(parts: Part[]) {
  const text = parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim()
  if (!text) return "New session"
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

function createDefaultPiAdapter(): PiAdapter {
  return {
    async listProviders() {
      return listProviders()
    },
    async complete(input) {
      if (input.signal.aborted) throw new Error("Aborted")
      const pi = await tryLoadPi()
      if (pi?.complete) return pi.complete(input)
      const suffix = input.prompt.trim() ? input.prompt.trim() : "No prompt text was provided."
      return { text: `OpenAgent runtime is connected. Configure a Pi model/API key to get live model responses.\n\n${suffix}` }
    },
  }
}

async function listProviders(): Promise<ProviderListResponse> {
  const pi = await tryLoadPi()
  if (pi?.listProviders) return pi.listProviders()
  return {
    all: [
      {
        id: "openagent",
        name: "OpenAgent",
        models: {
          fallback: {
            id: "fallback",
            name: "Fallback",
            status: "available",
          },
        },
      },
    ],
    connected: ["openagent"],
    default: { openagent: "fallback" },
  }
}

async function tryLoadPi(): Promise<PiAdapter | undefined> {
  try {
    const ai = await import("@earendil-works/pi-ai")
    const core = await import("@earendil-works/pi-agent-core")
    const getModel = (ai as { getModel?: (provider: string, model: string) => unknown }).getModel
    const Agent = (core as {
      Agent?: new (options?: Record<string, unknown>) => {
        state: { messages: unknown[] }
        prompt(input: string): Promise<void>
        abort(): void
      }
    }).Agent
    return {
      async listProviders() {
        return discoverModels(ai)
      },
      async complete(input) {
        if (!input.model?.providerID || !input.model?.modelID) {
          throw new Error("A provider and model are required before sending a prompt.")
        }
        if (isOllamaProvider(input.model.providerID)) {
          return completeWithOllama(input)
        }
        await assertProviderUsable(ai, input.model.providerID)
        let model: unknown
        try {
          model = getModel?.(input.model.providerID, input.model.modelID)
        } catch {}
        model ??= await customRuntimeModel(input.model.providerID, input.model.modelID)
        if (!model || !Agent) {
          throw new Error(`Model is not available: ${input.model.providerID}/${input.model.modelID}`)
        }
        const initialMessages = input.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: Date.now(),
        }))
        const agent = new Agent({
          sessionId: input.session.id,
          getApiKey,
          initialState: {
            model,
            systemPrompt: "You are OpenAgent, a local coding assistant.",
            thinkingLevel: "off",
            messages: initialMessages,
            tools: [],
          },
        })
        input.signal.addEventListener("abort", () => agent.abort(), { once: true })
        await agent.prompt(input.prompt)
        const assistant = agent.state.messages
          .slice()
          .reverse()
          .find((message): message is { role: "assistant"; content: Array<{ type: string; text?: string; thinking?: string }> } => {
            return !!message && typeof message === "object" && (message as { role?: unknown }).role === "assistant"
          })
        if (!assistant) return { text: "" }
        const text = assistant.content
          .map((content) => {
            if (content.type === "text") return content.text ?? ""
            if (content.type === "thinking") return content.thinking ?? ""
            return ""
          })
          .join("")
        return { text }
      },
    }
  } catch {
    return undefined
  }
}

async function getApiKey(provider: string): Promise<string | undefined> {
  const ai = await import("@earendil-works/pi-ai")
  const envKey = (ai as { getEnvApiKey?: (provider: string) => string | undefined }).getEnvApiKey?.(provider)
  if (envKey) return envKey
  if (provider === OLLAMA_CLOUD_PROVIDER) {
    const key = process.env.OLLAMA_API_KEY
    if (key) return key
  }
  const stored = await getStoredApiKey(provider)
  if (stored) return stored
  const config = (await readConfig()).provider?.[provider]
  for (const env of config?.env ?? []) {
    const value = process.env[env]
    if (value) return value
  }
  return undefined
}

async function discoverModels(ai: Record<string, unknown>): Promise<ProviderListResponse> {
  const getProviders = ai.getProviders as (() => string[]) | undefined
  const getModels = ai.getModels as ((provider: string) => unknown[]) | undefined
  const getEnvApiKey = ai.getEnvApiKey as ((provider: string) => string | undefined) | undefined
  const config = await readConfig()
  const auth = await readAuth()
  const disabled = new Set(config.disabled_providers ?? [])
  const providers: ProviderListResponse = { all: [], connected: [], default: {} }

  if (getProviders && getModels) {
    for (const providerID of getProviders()) {
      const models: Record<string, ProviderModel> = {}
      try {
        for (const model of getModels(providerID)) {
          const next = piModel(model)
          if (next) models[next.id] = next
        }
      } catch {}
      if (Object.keys(models).length === 0) continue
      const source = disabled.has(providerID)
        ? undefined
        : getEnvApiKey?.(providerID)
          ? "env"
          : apiKeyFromAuthEntry(auth[providerID])
            ? "api"
            : undefined
      providers.all.push({
        id: providerID,
        name: providerName(providerID),
        models,
        source,
      })
      providers.default[providerID] = Object.keys(models)[0]
      if (source) providers.connected.push(providerID)
    }
  }

  await addOllamaProviders(providers, {
    auth,
    disabled,
  })

  for (const [providerID, providerConfig] of Object.entries(config.provider ?? {})) {
    if (!providerConfig) continue
    const custom = customProvider(providerID, providerConfig, {
      disabled: disabled.has(providerID),
      hasAuth: !!apiKeyFromAuthEntry(auth[providerID]),
      hasEnv: (providerConfig.env ?? []).some((env) => !!process.env[env]),
    })
    if (!custom) continue
    const existing = providers.all.findIndex((provider) => provider.id === providerID)
    if (existing >= 0) providers.all[existing] = custom.provider
    else providers.all.push(custom.provider)
    providers.default[providerID] = custom.defaultModel
    if (custom.connected && !providers.connected.includes(providerID)) providers.connected.push(providerID)
  }

  return providers
}

async function providerAuth(): Promise<ProviderAuthResponse> {
  const pi = await tryLoadPi()
  const list = pi ? await pi.listProviders() : await listProviders()
  return Object.fromEntries(
    list.all.map((provider) => [
      provider.id,
      [
        {
          type: "api" as const,
          label: "API key",
        },
      ],
    ]),
  )
}

function piModel(value: unknown): ProviderModel | undefined {
  if (!value || typeof value !== "object") return undefined
  const model = value as Record<string, unknown>
  const id = typeof model.id === "string" ? model.id : undefined
  if (!id) return undefined
  const contextWindow = typeof model.contextWindow === "number" ? model.contextWindow : undefined
  const maxTokens = typeof model.maxTokens === "number" ? model.maxTokens : undefined
  const cost = model.cost && typeof model.cost === "object" ? (model.cost as ProviderModel["cost"]) : undefined
  return {
    id,
    name: typeof model.name === "string" ? model.name : id,
    status: "available",
    context: contextWindow,
    contextWindow,
    limit: contextWindow ? { context: contextWindow } : undefined,
    maxTokens,
    cost,
  }
}

function providerName(providerID: string) {
  const names: Record<string, string> = {
    "amazon-bedrock": "Amazon Bedrock",
    "azure-openai-responses": "Azure OpenAI",
    "cloudflare-ai-gateway": "Cloudflare AI Gateway",
    "cloudflare-workers-ai": "Cloudflare Workers AI",
    "github-copilot": "GitHub Copilot",
    "google-vertex": "Google Vertex",
    "kimi-coding": "Kimi Coding",
    "minimax-cn": "MiniMax CN",
    "moonshotai-cn": "Moonshot AI CN",
    ollama: "Ollama",
    "ollama-cloud": "Ollama Cloud",
    "opencode-go": "opencode Go",
    "openai": "OpenAI",
    "openai-codex": "OpenAI Codex",
    "openrouter": "OpenRouter",
    "vercel-ai-gateway": "Vercel AI Gateway",
    "xai": "xAI",
  }
  return (
    names[providerID] ??
    providerID
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  )
}

function customProvider(
  providerID: string,
  config: CustomProviderConfig,
  state: { disabled: boolean; hasAuth: boolean; hasEnv: boolean },
): { provider: Provider; defaultModel?: string; connected: boolean } | undefined {
  const models = Object.fromEntries(
    Object.entries(config.models ?? {})
      .filter(([id]) => !!id)
      .map(([id, model]) => [
        id,
        {
          id,
          name: model?.name ?? id,
          status: "available" as const,
          context: 128000,
          contextWindow: 128000,
          limit: { context: 128000 },
        },
      ]),
  )
  if (Object.keys(models).length === 0) return undefined
  const connected = !state.disabled && (state.hasAuth || state.hasEnv)
  return {
    provider: {
      id: providerID,
      name: config.name ?? providerName(providerID),
      models,
      source: connected ? "custom" : undefined,
    },
    defaultModel: Object.keys(models)[0],
    connected,
  }
}

async function customRuntimeModel(providerID: string, modelID: string) {
  const config = (await readConfig()).provider?.[providerID]
  const entry = config?.models?.[modelID]
  const baseUrl = config && customProviderBaseUrl(config)
  if (!config || !entry || !baseUrl) return undefined
  return {
    id: modelID,
    name: entry.name ?? modelID,
    api: "openai-completions",
    provider: providerID,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    headers: config.options?.headers,
  }
}

async function assertProviderUsable(ai: Record<string, unknown>, providerID: string) {
  const config = await readConfig()
  if (config.disabled_providers?.includes(providerID)) throw new Error(`Provider is disabled: ${providerID}`)
  const getEnvApiKey = ai.getEnvApiKey as ((provider: string) => string | undefined) | undefined
  if (getEnvApiKey?.(providerID)) return
  if (await getStoredApiKey(providerID)) return
  const providerConfig = config.provider?.[providerID]
  if ((providerConfig?.env ?? []).some((env) => !!process.env[env])) return
  throw new Error(`Provider is not connected or is missing an API key: ${providerID}`)
}

function isOllamaProvider(providerID: string) {
  return providerID === OLLAMA_LOCAL_PROVIDER || providerID === OLLAMA_CLOUD_PROVIDER
}

async function addOllamaProviders(
  providers: ProviderListResponse,
  input: {
    auth: AuthFile
    disabled: Set<string>
  },
) {
  const localModels = await listOllamaModels({ api: OLLAMA_LOCAL_API })
  addProvider(providers, {
    provider: {
      id: OLLAMA_LOCAL_PROVIDER,
      name: "Ollama",
      models: modelsFromOllama(localModels),
      source: localModels.length > 0 && !input.disabled.has(OLLAMA_LOCAL_PROVIDER) ? "config" : undefined,
    },
    connected: localModels.length > 0 && !input.disabled.has(OLLAMA_LOCAL_PROVIDER),
  })

  const cloudKey = process.env.OLLAMA_API_KEY || apiKeyFromAuthEntry(input.auth[OLLAMA_CLOUD_PROVIDER])
  const cloudModels = cloudKey ? await listOllamaModels({ api: OLLAMA_CLOUD_API, apiKey: cloudKey }) : []
  const cloudModelIDs = cloudModels.length > 0 ? cloudModels : OLLAMA_CLOUD_FALLBACK_MODELS
  addProvider(providers, {
    provider: {
      id: OLLAMA_CLOUD_PROVIDER,
      name: "Ollama Cloud",
      models: modelsFromOllama(cloudModelIDs),
      source: input.disabled.has(OLLAMA_CLOUD_PROVIDER) ? undefined : process.env.OLLAMA_API_KEY ? "env" : cloudKey ? "api" : undefined,
    },
    connected: !!cloudKey && !input.disabled.has(OLLAMA_CLOUD_PROVIDER),
  })
}

function addProvider(
  list: ProviderListResponse,
  input: {
    provider: Provider
    connected: boolean
  },
) {
  const modelIDs = Object.keys(input.provider.models)
  const existing = list.all.findIndex((provider) => provider.id === input.provider.id)
  if (existing >= 0) list.all[existing] = input.provider
  else list.all.push(input.provider)
  list.default[input.provider.id] = modelIDs[0]
  if (input.connected && !list.connected.includes(input.provider.id)) list.connected.push(input.provider.id)
  if (!input.connected) list.connected = list.connected.filter((id) => id !== input.provider.id)
}

function modelsFromOllama(modelIDs: string[]) {
  return Object.fromEntries(
    modelIDs.map((id) => [
      id,
      {
        id,
        name: id,
        status: "available" as const,
        context: 128000,
        contextWindow: 128000,
        limit: { context: 128000 },
      },
    ]),
  )
}

function signalWithTimeout(signal: AbortSignal, ms: number) {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error("Ollama request timed out"))
  }, ms)
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener("abort", abort, { once: true })
  const cleanup = () => {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
  }
  controller.signal.addEventListener("abort", cleanup, { once: true })
  return { signal: controller.signal, timedOut: () => timedOut, cleanup }
}

async function listOllamaModels(input: { api: string; apiKey?: string }) {
  try {
    const headers: Record<string, string> = {}
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`
    const response = await fetch(`${input.api}/tags`, {
      headers,
      signal: AbortSignal.timeout(700),
    })
    if (!response.ok) return []
    const data = (await response.json()) as { models?: Array<{ name?: unknown; model?: unknown }> }
    return (data.models ?? [])
      .map((model) => (typeof model.name === "string" ? model.name : typeof model.model === "string" ? model.model : ""))
      .filter(Boolean)
  } catch {
    return []
  }
}

async function completeWithOllama(input: Parameters<PiAdapter["complete"]>[0]): Promise<PiCompletion> {
  const providerID = input.model?.providerID
  const modelID = input.model?.modelID
  if (!providerID || !modelID) throw new Error("A provider and model are required before sending a prompt.")
  const cloud = providerID === OLLAMA_CLOUD_PROVIDER
  const apiKey = cloud ? await getApiKey(OLLAMA_CLOUD_PROVIDER) : undefined
  if (cloud && !apiKey) throw new Error("Ollama Cloud is missing an API key. Connect Ollama Cloud or set OLLAMA_API_KEY.")
  const api = cloud ? OLLAMA_CLOUD_API : OLLAMA_LOCAL_API
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const messages = input.messages
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
  if (messages.length === 0) messages.push({ role: "user", content: input.prompt })

  let response: Response
  const request = signalWithTimeout(input.signal, 120_000)
  const started = Date.now()
  void runtimeLog("info", "ollama_request_started", {
    providerID,
    modelID,
    cloud,
    messageCount: messages.length,
  })
  try {
    response = await fetch(`${api}/chat`, {
      method: "POST",
      headers,
      signal: request.signal,
      body: JSON.stringify({
        model: modelID,
        messages,
        stream: false,
      }),
    })
  } catch (error) {
    void runtimeLog("error", "ollama_request_threw", {
      providerID,
      modelID,
      cloud,
      error: error instanceof Error ? error.message : String(error),
      timedOut: request.timedOut(),
      ms: Date.now() - started,
    })
    if (!input.signal.aborted && request.timedOut()) {
      throw new Error("Ollama did not return within 120 seconds. Try a smaller local model or check Ollama Cloud connectivity.", {
        cause: error,
      })
    }
    if (!cloud) {
      throw new Error("Local Ollama is not reachable at http://localhost:11434. Start Ollama and pull a model, then try again.", {
        cause: error,
      })
    }
    throw error
  } finally {
    request.cleanup()
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: { content?: string }
    response?: string
  }
  if (!response.ok) {
    void runtimeLog("error", "ollama_request_failed", {
      providerID,
      modelID,
      cloud,
      status: response.status,
      error: data.error,
      ms: Date.now() - started,
    })
    throw new Error(data.error || `Ollama request failed with HTTP ${response.status}`)
  }
  void runtimeLog("info", "ollama_request_completed", {
    providerID,
    modelID,
    cloud,
    status: response.status,
    chars: (data.message?.content ?? data.response ?? "").length,
    ms: Date.now() - started,
  })
  return { text: data.message?.content ?? data.response ?? "" }
}
