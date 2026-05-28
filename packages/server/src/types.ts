export type RuntimeResult<T = unknown> = {
  data?: T
  error?: RuntimeErrorShape
}

export type RuntimeErrorShape = {
  name?: string
  message: string
  code?: string
  data?: unknown
}

export type OpenAgentPath = {
  state: string
  config: string
  worktree: string
  directory: string
  home: string
}

export type ProviderModel = {
  id: string
  name?: string
  status?: "available" | "deprecated" | "unavailable"
  provider?: Provider
  context?: number
  contextWindow?: number
  limit?: {
    context?: number
  }
  maxTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  family?: string
  release_date?: string
  latest?: boolean
  variants?: Record<string, unknown>
}

export type Provider = {
  id: string
  name?: string
  models: Record<string, ProviderModel>
  source?: "env" | "api" | "config" | "custom"
}

export type ProviderListResponse = {
  all: Provider[]
  connected: string[]
  default: Record<string, string | undefined>
}

export type ProviderAuthMethod =
  | {
      type: "api"
      label?: string
    }
  | {
      type: "oauth"
      label?: string
      prompts?: unknown[]
    }

export type ProviderAuthResponse = Record<string, ProviderAuthMethod[]>

export type AgentInfo = {
  name: string
  mode: "primary" | "subagent" | "all"
  description?: string
}

export type Session = {
  id: string
  parentID?: string
  title: string
  directory: string
  source: "user" | "automation"
  time: {
    created: number
    updated: number
    archived?: number
  }
}

export type Message = {
  id: string
  sessionID: string
  parentID?: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  agent?: string
  model?: {
    providerID: string
    modelID: string
    variant?: string
  }
  error?: string
}

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: unknown
  metadata?: unknown
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime?: string
  filename?: string
  url?: string
  source?: unknown
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: unknown
}

export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  tool: string
  callID?: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input?: unknown
    output?: unknown
    error?: string
    metadata?: unknown
  }
}

export type Part = TextPart | FilePart | AgentPart | ToolPart

export type MessageWithParts = {
  info: Message
  parts: Part[]
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number; action?: unknown }

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

export type PermissionResponse = {
  sessionID: string
  permissionID: string
  response: "allow" | "deny"
  remember?: boolean
}

export type Event =
  | { type: "server.connected"; properties: { url: string } }
  | { type: "global.disposed"; properties?: Record<string, never> }
  | { type: "project.updated"; properties: Project }
  | { type: "project.opened"; properties: Project }
  | { type: "project.closed"; properties: Project }
  | { type: "session.created"; properties: { info: Session } }
  | { type: "session.updated"; properties: { info: Session } }
  | { type: "session.deleted"; properties: { info: Session } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }
  | { type: "session.error"; properties: { sessionID?: string; error: string } }
  | { type: "message.updated"; properties: { info: Message } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: Part } }
  | { type: "message.part.removed"; properties: { messageID: string; partID: string } }
  | { type: "message.part.delta"; properties: { messageID: string; partID: string; field: string; delta: string } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string } }

export type Project = {
  id: string
  worktree: string
  name?: string
  icon?: Record<string, unknown>
  sandboxes?: string[]
}

export type RolloutLine =
  | { timestamp: string; type: "session_meta"; payload: Session }
  | { timestamp: string; type: "turn_context"; payload: Record<string, unknown> }
  | { timestamp: string; type: "message"; payload: Message }
  | { timestamp: string; type: "part"; payload: Part }
  | { timestamp: string; type: "event"; payload: Event }
  | { timestamp: string; type: "abort"; payload: { sessionID: string; message?: string } }
  | { timestamp: string; type: "error"; payload: { sessionID?: string; message: string; stack?: string } }

export type SessionIndexEntry = {
  id: string
  path: string
  archived?: boolean
  session: Session
  messageCount: number
  updated: number
}

export type SessionIndex = {
  version: 1
  rebuiltAt: number
  entries: Record<string, SessionIndexEntry>
}

export type PromptAsyncInput = {
  sessionID: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  messageID?: string
  parts?: Array<Partial<Part> & { id: string; type: string }>
  variant?: string
}

export type RuntimeContext = {
  directory?: string
}

export type RpcHandler = (input: unknown, context: RuntimeContext) => Promise<RuntimeResult> | RuntimeResult
