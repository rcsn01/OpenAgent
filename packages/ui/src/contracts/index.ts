export type Result<T = any> = {
  data?: T
  error?: any
  response?: Response
}

export type Session = {
  id: string
  parentID?: string
  title: string
  directory?: string
  source?: "user" | "automation"
  time: {
    created: number
    updated?: number
    archived?: number
  }
  [key: string]: any
}

export type ProviderModel = {
  id: string
  name?: string
  status?: "available" | "deprecated" | "unavailable"
  provider?: Provider
  [key: string]: any
}

export type Provider = {
  id: string
  name?: string
  models: Record<string, ProviderModel>
  [key: string]: any
}

export type Agent = {
  name: string
  mode: "primary" | "subagent" | "all"
  description?: string
  [key: string]: any
}

export type ProviderListResponse = {
  all: Provider[]
  connected: string[]
  default: Record<string, string | undefined>
  [key: string]: any
}

export type ProviderAuthResponse = Record<string, any>
export type ProviderAuthMethod = any
export type ProviderAuthAuthorization = any

export type Path = {
  state: string
  config: string
  worktree: string
  directory: string
  home: string
  [key: string]: any
}

export type Project = {
  id: string
  worktree: string
  name?: string
  icon?: { url?: string; override?: string; color?: string; [key: string]: any }
  sandboxes?: string[]
  [key: string]: any
}

export type FileNode = {
  name: string
  path: string
  type?: "file" | "directory"
  children?: FileNode[]
  [key: string]: any
}

export type FileContent = any

export type TextPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: any
  metadata?: any
  [key: string]: any
}

export type FilePart = {
  id: string
  sessionID: string
  messageID: string
  type: "file"
  mime?: string
  filename?: string
  url?: string
  source?: any
  [key: string]: any
}

export type AgentPart = {
  id: string
  sessionID: string
  messageID: string
  type: "agent"
  name: string
  source?: any
  [key: string]: any
}

export type AgentPartInput = {
  type: "agent"
  name: string
  source?: any
  [key: string]: any
}

export type FilePartInput = {
  type: "file"
  mime?: string
  filename?: string
  url?: string
  source?: any
  [key: string]: any
}

export type TextPartInput = {
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
  time?: any
  metadata?: any
  [key: string]: any
}

export type ReasoningPart = {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text?: string
  [key: string]: any
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
    input?: any
    output?: any
    error?: string
    metadata?: any
    [key: string]: any
  }
  [key: string]: any
}

export type Part = TextPart | FilePart | AgentPart | ReasoningPart | ToolPart | ({ id: string; type: string } & Record<string, any>)

export type MessageBase = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
    [key: string]: any
  }
  agent?: string
  model?: {
    providerID: string
    modelID: string
    variant?: string
    [key: string]: any
  }
  [key: string]: any
}

export type UserMessage = MessageBase & { role: "user" }
export type AssistantMessage = MessageBase & { role: "assistant" }
export type Message = UserMessage | AssistantMessage

export type SnapshotFileDiff = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  [key: string]: any
}
export type VcsFileDiff = SnapshotFileDiff
export type Todo = { id: string; [key: string]: any }

export type PermissionRequest = {
  id: string
  sessionID: string
  permission?: string
  patterns?: string[]
  metadata?: Record<string, any>
  always?: string[]
  [key: string]: any
}

export type QuestionAnswer = any
export type QuestionInfo = any
export type QuestionRequest = {
  id: string
  sessionID: string
  questions?: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string }>
  }>
  [key: string]: any
}

export type SessionStatus =
  | { type: "idle"; [key: string]: any }
  | { type: "busy"; [key: string]: any }
  | { type: "retry"; attempt: number; message: string; next: number; action?: any; [key: string]: any }

export type Config = Record<string, any>
export type VcsInfo = { branch?: string; [key: string]: any }
export type SessionGraphsResponse = any
export type McpStatus = any
export type LspStatus = any
export type FormatterStatus = any
export type Command = any
export type ConsoleState = Record<string, any>
export type ExperimentalExtensionsListResponse = {
  installed: any[]
  available: any[]
  servers: Record<string, any>
}
export type ExperimentalExtensionsInstallData = any
export type AutomationListResponse = any
export type OpencodeClient = any

export type EventBase<TType extends string = string, TProperties = any> = {
  type: TType
  properties: TProperties
}

export type EventSessionError = EventBase<"session.error", { sessionID?: string; error?: string }>

export type Event =
  | EventBase<"server.connected", { url: string }>
  | EventBase<"global.disposed", Record<string, never> | undefined>
  | EventBase<"project.updated" | "project.opened" | "project.closed", Project>
  | EventBase<"session.created" | "session.updated" | "session.deleted", { info: Session }>
  | EventBase<"session.status", { sessionID: string; status: SessionStatus }>
  | EventSessionError
  | EventBase<"message.updated", { info: Message }>
  | EventBase<"message.removed", { sessionID: string; messageID: string }>
  | EventBase<"message.part.updated", { part: Part }>
  | EventBase<"message.part.removed", { messageID: string; partID: string }>
  | EventBase<"message.part.delta", { messageID: string; partID: string; field: string; delta: string }>
  | EventBase<"permission.asked", PermissionRequest>
  | EventBase<"permission.replied", { sessionID: string; requestID: string }>
  | EventBase<"question.asked", QuestionRequest>
  | EventBase<"question.replied" | "question.rejected", { sessionID: string; requestID: string }>
  | EventBase<"todo.updated", { sessionID: string; todos: Todo[] }>
  | EventBase<"session.diff", { sessionID: string; diff: SnapshotFileDiff[] }>
  | EventBase<"vcs.branch.updated", { branch?: string }>
  | EventBase<"lsp.updated", any>
  | EventBase<"server.instance.disposed", any>
  | EventBase<string, any>

export type GlobalEvent = Event
