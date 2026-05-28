import { Cause, Effect, Layer } from "effect"
import { OpenAgentPiRuntime, type RunInput } from "@/pi/runtime"
import { MessageV2 } from "@/session/message-v2"
import { PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { fromOpenAgentMessages } from "@/pi/transcript"
import { TestLLMServer } from "./llm-server"

type ToolCall = {
  id: string
  name: string
  args: string
}

function lines(chunk: string) {
  return chunk
    .split("\n\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
}

function choice(payload: unknown) {
  if (!payload || typeof payload !== "object") return
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return
  const first = choices[0]
  return first && typeof first === "object" ? (first as Record<string, any>) : undefined
}

export const TestPiRuntime = {
  layer: Layer.effect(
    OpenAgentPiRuntime.Service,
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const sessions = yield* Session.Service
      const summary = yield* SessionSummary.Service
      const snapshot = yield* Snapshot.Service
      let current: AbortController | undefined
      let currentFinalize: Effect.Effect<void> | undefined

      return OpenAgentPiRuntime.Service.of({
        run: ((input: RunInput) =>
          Effect.gen(function* () {
            const ctl = new AbortController()
            current = ctl
            let text: MessageV2.TextPart | undefined
            let reasoning: MessageV2.ReasoningPart | undefined
            let tool: MessageV2.ToolPart | undefined
            let call: ToolCall | undefined
            let toolInput: Record<string, unknown> = {}

            const ensureText = Effect.fnUntraced(function* () {
              if (text) return text
              text = yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "text",
                text: "",
                time: { start: Date.now() },
              })
              return text
            })

            const ensureReasoning = Effect.fnUntraced(function* () {
              if (reasoning) return reasoning
              reasoning = yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "reasoning",
                text: "",
                time: { start: Date.now() },
              })
              return reasoning
            })

            const ensureTool = Effect.fnUntraced(function* (id: string, name: string) {
              if (tool) return tool
              tool = yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "tool",
                callID: id,
                tool: name,
                state: {
                  status: "running",
                  input: {},
                  time: { start: Date.now() },
                },
              })
              return tool
            })

            const finishWithError = Effect.fnUntraced(function* (error: unknown) {
              input.assistantMessage.error = MessageV2.fromError(error, { providerID: input.model.providerID })
              input.assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(input.assistantMessage)
              current = undefined
              currentFinalize = undefined
              return "stop" as const
            })

            const interruptedBashResult = () => {
              const outputPath = "/tmp/openagent-interrupted-bash-output.txt"
              return {
                title: "Print many lines",
                metadata: {
                  truncated: true,
                  outputPath,
                },
                output: ["...output truncated...", `Full output saved to: ${outputPath}`].join("\n"),
              }
            }

            const finishInterruptedTool = Effect.fnUntraced(function* () {
              ctl.abort()
              if (!tool || tool.state.status !== "running") return
              if (tool.tool !== "bash") return
              const result = interruptedBashResult()
              tool = yield* sessions.updatePart({
                ...tool,
                state: {
                  status: "completed",
                  input: toolInput,
                  title: result.title,
                  metadata: {
                    ...(tool.state.metadata ?? {}),
                    ...result.metadata,
                  },
                  output: result.output,
                  time: {
                    start: tool.state.time.start,
                    end: Date.now(),
                  },
                },
              } satisfies MessageV2.ToolPart)
            })
            currentFinalize = finishInterruptedTool()

            const response = yield* llm.next({
              model: input.model.id,
              messages: fromOpenAgentMessages(input.messages, input.transcriptOptions),
              tools: Object.keys(input.tools),
              system: input.system,
            })
            if (response.type === "http-error") return yield* finishWithError(new Error(JSON.stringify(response.body)))
            const chunks = [...response.head, ...response.tail]
            yield* Effect.gen(function* () {
              for (let index = 0; index < chunks.length; index++) {
                if (index === response.head.length && response.wait) yield* Effect.promise(() => response.wait!)
                const line = JSON.stringify(chunks[index])
                const parsed = JSON.parse(line)
                const item = choice(parsed)
                const delta = item?.delta
                if (delta?.content) {
                  const part = yield* ensureText()
                  part.text += delta.content
                  yield* sessions.updatePartDelta({
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    field: "text",
                    delta: delta.content,
                  })
                }
                if (delta?.reasoning_content) {
                  const part = yield* ensureReasoning()
                  part.text += delta.reasoning_content
                  yield* sessions.updatePartDelta({
                    sessionID: part.sessionID,
                    messageID: part.messageID,
                    partID: part.id,
                    field: "text",
                    delta: delta.reasoning_content,
                  })
                }
                for (const raw of delta?.tool_calls ?? []) {
                  const fn = raw.function ?? {}
                  if (raw.id && fn.name) {
                    call = { id: raw.id, name: fn.name, args: "" }
                    yield* ensureTool(call.id, call.name)
                  }
                  if (call && typeof fn.arguments === "string") call.args += fn.arguments
                }
              }
              if (response.error) return yield* Effect.fail(response.error)
              if (response.hang) return yield* Effect.never
            }).pipe(
              Effect.catchCause((cause) => finishWithError(Cause.squash(cause))),
              Effect.onInterrupt(() => finishInterruptedTool()),
            )

            if (input.assistantMessage.error) return "stop"

            if (text && !text.time?.end) {
              text.time = { start: text.time?.start ?? Date.now(), end: Date.now() }
              yield* sessions.updatePart(text)
            }

            if (reasoning && !reasoning.time.end) {
              reasoning.time.end = Date.now()
              yield* sessions.updatePart(reasoning)
            }

            if (call && tool) {
              const activeCall = call
              let parsed: unknown = {}
              try {
                parsed = activeCall.args ? JSON.parse(activeCall.args) : {}
              } catch {
                parsed = {}
              }
              toolInput = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
              const def = input.tools[activeCall.name]
              if (activeCall.name === "task" && tool && tool.state.status === "running") {
                const description =
                  typeof toolInput.description === "string" ? toolInput.description : "Task"
                tool = yield* sessions.updatePart({
                  ...tool,
                  state: {
                    ...tool.state,
                    title: description,
                    metadata: {
                      parentSessionId: input.sessionID,
                      sessionId: SessionID.descending(),
                      model: {
                        providerID: input.model.providerID,
                        modelID: input.model.id,
                      },
                    },
                  },
                } satisfies MessageV2.ToolPart)
                if (
                  input.agent.name === "build" &&
                  input.permission?.some((rule) => rule.permission === "*" && rule.action === "allow")
                ) {
                  yield* Effect.never.pipe(Effect.onInterrupt(() => finishInterruptedTool()))
                }
              }
              const isInterruptedBashFixture =
                activeCall.name === "bash" &&
                typeof toolInput.command === "string" &&
                toolInput.command.includes("sleep 30")
              if (isInterruptedBashFixture) {
                yield* Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      if (ctl.signal.aborted) return resolve()
                      ctl.signal.addEventListener("abort", () => resolve(), { once: true })
                    }),
                )
                yield* finishInterruptedTool()
                input.assistantMessage.finish = "stop"
                input.assistantMessage.time.completed = Date.now()
                yield* sessions.updateMessage(input.assistantMessage)
                current = undefined
                currentFinalize = undefined
                return "stop"
              }
              if (activeCall.name === "bash" && typeof toolInput.command === "string" && tool && tool.state.status === "running") {
                const command = toolInput.command
                const cwd = typeof toolInput.workdir === "string" ? toolInput.workdir : process.cwd()
                const before = yield* snapshot.track()
                if (before) {
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    type: "step-start",
                    snapshot: before,
                  })
                }
                const result = yield* Effect.promise(async () => {
                  const proc = Bun.spawn(["/bin/sh", "-lc", command], { cwd })
                  const [stdout, stderr, exitCode] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text(),
                    proc.exited,
                  ])
                  return { stdout, stderr, exitCode }
                })
                const after = yield* snapshot.track()
                if (after) {
                  yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    type: "step-finish",
                    reason: "tool-calls",
                    snapshot: after,
                    cost: 0,
                    tokens: {
                      input: 0,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  })
                }
                yield* summary.summarize({ sessionID: input.sessionID, messageID: input.user.id }).pipe(Effect.ignore)
                const output = [result.stdout, result.stderr].filter(Boolean).join("")
                tool = yield* sessions.updatePart({
                  ...tool,
                  state: {
                    status: "completed",
                    input: toolInput,
                    title: typeof toolInput.description === "string" ? toolInput.description : command,
                    metadata: { exit: result.exitCode },
                    output,
                    time: {
                      start: tool.state.time.start,
                      end: Date.now(),
                    },
                  },
                } satisfies MessageV2.ToolPart)
                input.assistantMessage.finish = "tool-calls"
                input.assistantMessage.time.completed = Date.now()
                yield* sessions.updateMessage(input.assistantMessage)
                current = undefined
                currentFinalize = undefined
                return "continue"
              }
              if (def?.execute) {
                const result = yield* def
                  .execute(parsed, {
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    agent: input.agent.name,
                    abort: ctl.signal,
                    callID: activeCall.id,
                    messages: input.messages,
                    metadata: (value: { title?: string; metadata?: Record<string, unknown> }) =>
                      Effect.gen(function* () {
                        if (!tool || tool.state.status !== "running") return
                        tool = yield* sessions.updatePart({
                          ...tool,
                          state: {
                            ...tool.state,
                            ...value,
                          },
                        } satisfies MessageV2.ToolPart)
                      }),
                    ask: () => Effect.void,
                    extra: {
                      promptOps: {
                        cancel: () => Effect.void,
                        resolvePromptParts: (template: string) =>
                          Effect.succeed([{ type: "text" as const, text: template }]),
                        prompt: () => Effect.never,
                        loop: () => Effect.never,
                      },
                    },
                  })
                  .pipe(Effect.onInterrupt(() => finishInterruptedTool()))
                  .pipe(
                    Effect.catchCause((cause) =>
                      activeCall.name === "bash"
                        ? finishInterruptedTool().pipe(Effect.as(interruptedBashResult()))
                        : Effect.failCause(cause),
                    ),
                  )
                yield* sessions.updatePart({
                  ...tool,
                  state: {
                    status: "completed",
                    input: parsed as Record<string, unknown>,
                    title: result.title,
                    output: result.output,
                    metadata: result.metadata,
                    attachments: result.attachments,
                    time: {
                      start: tool.state.status === "running" ? tool.state.time.start : Date.now(),
                      end: Date.now(),
                    },
                  },
                } satisfies MessageV2.ToolPart)
              }
              input.assistantMessage.finish = "tool-calls"
            } else {
              input.assistantMessage.finish = "stop"
            }
            input.assistantMessage.time.completed = Date.now()
            yield* sessions.updateMessage(input.assistantMessage)
            current = undefined
            currentFinalize = undefined
            if (call) return "continue"
            const latest = yield* sessions.messages({ sessionID: input.sessionID })
            const hasNewUser = latest.some((message) => message.info.role === "user" && message.info.id > input.user.id)
            return hasNewUser ? "continue" : "stop"
          }).pipe(Effect.orDie)) as unknown as OpenAgentPiRuntime.Interface["run"],
        generateText: () => Effect.succeed("E2E Title"),
        cancel: () =>
          Effect.gen(function* () {
            current?.abort()
            if (currentFinalize) yield* currentFinalize
          }),
        wait: () => Effect.void,
      })
    }),
  ),
}
