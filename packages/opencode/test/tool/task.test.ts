import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session/session"
import { SessionBackgroundTask } from "../../src/session/background-task"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskExecution } from "../../src/session/task-execution"
import {
  BackgroundTaskCancelTool,
  BackgroundTaskGetTool,
  BackgroundTaskListTool,
} from "../../src/tool/background_task_manage"
import { BackgroundTaskGraphTool } from "../../src/tool/background_task_graph"
import {
  BackgroundTaskGraphCancelTool,
  BackgroundTaskGraphGetTool,
  BackgroundTaskGraphListTool,
} from "../../src/tool/background_task_graph_manage"
import { BackgroundTaskTool } from "../../src/tool/background_task"
import { SendMessageTool } from "@/tool/send_message"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { TransferTool } from "@/tool/transfer"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    TaskExecution.defaultLayer,
    SessionBackgroundTask.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned", agentName = "build") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: agentName,
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: agentName,
    agent: agentName,
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel() {},
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.live("description sorts subagents by name and is stable across calls", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const assistant = yield* agent.get("assistant")
          const registry = yield* ToolRegistry.Service
          const get = Effect.fnUntraced(function* (agentInfo: typeof build) {
            const tools = yield* registry.tools({ ...ref, agent: agentInfo })
            return {
              task: tools.find((tool) => tool.id === TaskTool.id)?.description ?? "",
              background: tools.find((tool) => tool.id === BackgroundTaskTool.id)?.description ?? "",
            }
          })
          const buildTools = yield* registry.tools({ ...ref, agent: build })
          const first = yield* get(assistant)
          const second = yield* get(assistant)
          const ids = (yield* registry.ids()).sort()

          expect(first).toEqual(second)
          expect(buildTools.find((tool) => tool.id === BackgroundTaskTool.id)).toBeUndefined()
          expect(ids).toEqual(expect.arrayContaining(["background_task", "background_task_cancel", "background_task_get", "background_task_list", "task"]))
          expect(first.task).not.toContain("- build:")
          expect(first.task).not.toContain("- plan:")
          expect(first.task).not.toContain("- assistant:")
          expect(first.task).not.toContain("- chat:")

          const alpha = first.task.indexOf("- alpha: Alpha agent")
          const explore = first.task.indexOf("- explore:")
          const general = first.task.indexOf("- general:")
          const zebra = first.task.indexOf("- zebra: Zebra agent")

          expect(alpha).toBeGreaterThan(-1)
          expect(explore).toBeGreaterThan(alpha)
          expect(general).toBeGreaterThan(explore)
          expect(zebra).toBeGreaterThan(general)
          expect(first.background).toContain("keeps running while you continue the current task")
          expect(first.background).toContain("- alpha: Alpha agent")
        }),
      {
        config: {
          agent: {
            zebra: {
              description: "Zebra agent",
              mode: "subagent",
            },
            alpha: {
              description: "Alpha agent",
              mode: "subagent",
            },
          },
        },
      },
    ),
  )

  it.live("description hides denied subagents for the caller", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const assistant = yield* agent.get("assistant")
          const registry = yield* ToolRegistry.Service
          const buildTools = yield* registry.tools({ ...ref, agent: build })
          const assistantTools = yield* registry.tools({ ...ref, agent: assistant })
          const buildDescription = buildTools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
          const description = assistantTools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
          const backgroundDescription = assistantTools.find((tool) => tool.id === BackgroundTaskTool.id)?.description ?? ""

          expect(buildTools.find((tool) => tool.id === TaskTool.id)).toBeDefined()
          expect(buildDescription).toContain("- alpha: Alpha agent")
          expect(buildDescription).not.toContain("- zebra: Zebra agent")
          expect(description).toContain("- alpha: Alpha agent")
          expect(description).not.toContain("- zebra: Zebra agent")
          expect(backgroundDescription).toContain("- alpha: Alpha agent")
          expect(backgroundDescription).not.toContain("- zebra: Zebra agent")
        }),
      {
        config: {
          permission: {
            task: {
              "*": "allow",
              zebra: "deny",
            },
          },
          agent: {
            zebra: {
              description: "Zebra agent",
              mode: "subagent",
            },
            alpha: {
              description: "Alpha agent",
              mode: "subagent",
            },
          },
        },
      },
    ),
  )

  it.live("build receives blocking task while only assistant receives orchestration tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const plan = yield* agent.get("plan")
        const assistant = yield* agent.get("assistant")
        const registry = yield* ToolRegistry.Service
        const buildIDs = new Set((yield* registry.tools({ ...ref, agent: build })).map((tool) => tool.id))
        const planIDs = new Set((yield* registry.tools({ ...ref, agent: plan })).map((tool) => tool.id))
        const assistantIDs = new Set((yield* registry.tools({ ...ref, agent: assistant })).map((tool) => tool.id))

        expect(buildIDs.has(TaskTool.id)).toBe(true)
        expect(buildIDs.has(BackgroundTaskTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskGraphTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskListTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskGetTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskCancelTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskGraphListTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskGraphGetTool.id)).toBe(false)
        expect(buildIDs.has(BackgroundTaskGraphCancelTool.id)).toBe(false)
        expect(buildIDs.has(SendMessageTool.id)).toBe(false)
        expect(buildIDs.has(TransferTool.id)).toBe(false)

        expect(planIDs.has(TaskTool.id)).toBe(false)
        expect(planIDs.has(BackgroundTaskTool.id)).toBe(false)
        expect(planIDs.has(BackgroundTaskGraphTool.id)).toBe(false)

        expect(assistantIDs.has(TaskTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskGraphTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskListTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskGetTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskCancelTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskGraphListTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskGraphGetTool.id)).toBe(true)
        expect(assistantIDs.has(BackgroundTaskGraphCancelTool.id)).toBe(true)
        expect(assistantIDs.has(SendMessageTool.id)).toBe(true)
        expect(assistantIDs.has(TransferTool.id)).toBe(true)
      }),
    ),
  )

  it.live("execute resumes an existing task session from task_id", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: child.id,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(child.id)
        expect(result.metadata.sessionId).toBe(child.id)
        expect(result.output).toContain(`task_id: ${child.id}`)
        expect(seen?.sessionID).toBe(child.id)
      }),
    ),
  )

  it.live("build can execute blocking task for a spawnable subagent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed("Build task", "build")
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ text: "general complete", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "ask general",
            prompt: "inspect this from build",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, bypassAgentCheck: true },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(seen?.agent).toBe("general")
        expect(seen?.sessionID).toBe(kids[0]?.id)
        expect(result.output).toContain("general complete")
      }),
    ),
  )

  it.live("execute rejects primary agents as subagents", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const promptOps = stubOps()

        for (const name of ["build", "plan", "assistant", "chat", "orchestrator"]) {
          const exit = yield* def
            .execute(
              {
                description: "blocked spawn",
                prompt: "try to run",
                subagent_type: name,
              },
              {
                sessionID: chat.id,
                messageID: assistant.id,
                agent: "assistant",
                abort: new AbortController().signal,
                extra: { promptOps, bypassAgentCheck: true },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.exit)

          expect(exit._tag).toBe("Failure")
        }
      }),
    ),
  )

  it.live("execute asks by default and skips checks when bypassed", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const calls: unknown[] = []
        const promptOps = stubOps()

        const exec = (extra?: Record<string, any>) =>
          def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "general",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps, ...extra },
              messages: [],
              metadata: () => Effect.void,
              ask: (input) =>
                Effect.sync(() => {
                  calls.push(input)
                }),
            },
          )

        yield* exec()
        yield* exec({ bypassAgentCheck: true })

        expect(calls).toHaveLength(1)
        expect(calls[0]).toEqual({
          permission: "task",
          patterns: ["general"],
          always: ["*"],
          metadata: {
            description: "inspect bug",
            subagent_type: "general",
          },
        })
      }),
    ),
  )

  it.live("execute creates a child when task_id does not exist", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            task_id: "ses_missing",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(result.metadata.sessionId)
        expect(result.metadata.sessionId).not.toBe("ses_missing")
        expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
        expect(seen?.sessionID).toBe(result.metadata.sessionId)
      }),
    ),
  )

  it.live("execute can start a background subagent and deliver its result later", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed("Pinned", "assistant")
        const tool = yield* BackgroundTaskTool
        const def = yield* tool.init()
        const childStarted = defer<void>()
        const childRelease = defer<void>()
        const delivered = defer<SessionPrompt.PromptInput>()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            extra: {
              promptOps: {
                cancel() {},
                resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
                prompt: (input) => {
                  if (input.sessionID === chat.id) {
                    return Effect.sync(() => {
                      delivered.resolve(input)
                      return reply(input, "parent delivery")
                    })
                  }
                  return Effect.promise(async () => {
                    childStarted.resolve()
                    await childRelease.promise
                    return reply(input, "background done")
                  })
                },
              } satisfies TaskPromptOps,
            },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.metadata.status).toBe("running")
        expect(result.metadata.executionMode).toBe("background")
        expect(result.output).toContain("mode: background")
        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)

        yield* Effect.promise(() => childStarted.promise)

        let deliveredBeforeChildFinished = false
        void delivered.promise.then(() => {
          deliveredBeforeChildFinished = true
        })
        yield* Effect.promise(() => Promise.resolve())
        expect(deliveredBeforeChildFinished).toBe(false)

        yield* Effect.sync(() => childRelease.resolve())

        const followup = yield* Effect.promise(() => delivered.promise)
        expect(followup.sessionID).toBe(chat.id)
        expect(followup.parts[0]).toMatchObject({ type: "text", synthetic: true })
        expect(followup.parts[0]?.type).toBe("text")
        if (followup.parts[0]?.type !== "text") throw new Error("Expected synthetic text part")
        expect(followup.parts[0].text).toContain("<background_task")
        expect(followup.parts[0].text).toContain("background done")
      }),
    ),
  )

  it.live("execute shapes child permissions for task, todowrite, and primary tools", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

          const result = yield* def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "reviewer",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const child = yield* sessions.get(result.metadata.sessionId)
          expect(child.parentID).toBe(chat.id)
          expect(child.permission).toEqual([
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "bash",
              pattern: "*",
              action: "allow",
            },
            {
              permission: "read",
              pattern: "*",
              action: "allow",
            },
          ])
          expect(seen?.tools).toEqual({
            todowrite: false,
            bash: false,
            read: false,
          })
        }),
      {
        config: {
          agent: {
            reviewer: {
              mode: "subagent",
              permission: {
                task: "allow",
              },
            },
          },
          experimental: {
            primary_tools: ["bash", "read"],
          },
        },
      },
    ),
  )

  it.live("background task management tools can list, inspect, and cancel tasks", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed("Pinned", "assistant")
        const start = yield* BackgroundTaskTool
        const list = yield* BackgroundTaskListTool
        const get = yield* BackgroundTaskGetTool
        const cancel = yield* BackgroundTaskCancelTool
        const startDef = yield* start.init()
        const listDef = yield* list.init()
        const getDef = yield* get.init()
        const cancelDef = yield* cancel.init()
        const childStarted = defer<void>()
        const childRelease = defer<void>()
        const asks: unknown[] = []

        const started = yield* startDef.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            extra: {
              promptOps: {
                cancel() {},
                resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
                prompt: (input) =>
                  Effect.promise(async () => {
                    childStarted.resolve()
                    await childRelease.promise
                    return reply(input, "background done")
                  }),
              } satisfies TaskPromptOps,
            },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        yield* Effect.promise(() => childStarted.promise)

        const listed = yield* listDef.execute(
          {},
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(listed.metadata.count).toBe(1)
        expect(listed.output).toContain(`id="${started.metadata.sessionId}"`)
        expect(listed.output).toContain('status="running"')

        const inspected = yield* getDef.execute(
          { task_id: started.metadata.sessionId },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(inspected.metadata.found).toBe(true)
        expect(inspected.metadata.task?.status).toBe("running")

        const cancelled = yield* cancelDef.execute(
          { task_id: started.metadata.sessionId },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                asks.push(input)
              }),
          },
        )

        expect(asks).toEqual([
          {
            permission: "task",
            patterns: ["general"],
            always: ["general"],
            metadata: {
              task_id: started.metadata.sessionId,
              description: "inspect bug",
              subagent_type: "general",
            },
          },
        ])
        expect(cancelled.metadata.cancelled).toBe(true)
        expect(cancelled.output).toContain("status: cancelled")

        const afterCancel = yield* listDef.execute(
          {},
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(afterCancel.metadata.count).toBe(0)

        yield* Effect.sync(() => childRelease.resolve())
      }),
    ),
  )
})
