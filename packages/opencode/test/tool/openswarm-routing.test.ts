import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import type { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID } from "@/session/schema"
import { TaskExecution, type TaskPromptOps } from "@/session/task-execution"
import { ModelID, ProviderID } from "@/provider/schema"
import { allowedRecipients } from "@/agent/communication"
import { SendMessageTool } from "@/tool/send_message"
import { TransferTool } from "@/tool/transfer"
import { ComposioTool, DocsTool, SlideOverflowCheckTool, SlideScreenshotTool, SlidesThemeTool, SlidesTool } from "@/tool/openswarm_stub"
import { IntegrationAuth } from "@/integration/auth"
import { OpenSwarmArtifacts } from "@/tool/openswarm/artifact"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instance } from "@/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    TaskExecution.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    IntegrationAuth.defaultLayer,
    OpenSwarmArtifacts.defaultLayer,
  ),
)

const seed = Effect.fn("OpenSwarmRoutingTest.seed")(function* (agentName = "assistant") {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "OpenSwarm test" })
  const user = yield* sessions.updateMessage({
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
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

function promptOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel() {},
    resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input: SessionPrompt.PromptInput) =>
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

describe("openswarm native routing", () => {
  it.live("registers OpenSwarm agents and routes tools to the right agents", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const registry = yield* ToolRegistry.Service
        const names = (yield* agents.list()).map((agent) => agent.name)

        expect(names).toEqual(expect.arrayContaining(["virtual-assistant", "deep-research", "data-analyst"]))
        expect(names).not.toContain("orchestrator")

        const assistant = yield* agents.get("assistant")
        const virtualAssistant = yield* agents.get("virtual-assistant")
        const build = yield* agents.get("build")
        const plan = yield* agents.get("plan")
        const docs = yield* agents.get("docs-agent")
        const assistantTools = new Set((yield* registry.tools({ ...ref, agent: assistant })).map((tool) => tool.id))
        const virtualAssistantTools = new Set((yield* registry.tools({ ...ref, agent: virtualAssistant })).map((tool) => tool.id))
        const buildTools = new Set((yield* registry.tools({ ...ref, agent: build })).map((tool) => tool.id))
        const planTools = new Set((yield* registry.tools({ ...ref, agent: plan })).map((tool) => tool.id))
        const docsTools = new Set((yield* registry.tools({ ...ref, agent: docs })).map((tool) => tool.id))
        const cfg = yield* Config.Service

        expect(assistantTools.has("send_message")).toBe(true)
        expect(assistantTools.has("transfer")).toBe(true)
        expect(allowedRecipients(yield* cfg.get(), "assistant", "send_message")).toEqual(
          expect.arrayContaining(["general", "virtual-assistant", "deep-research", "data-analyst", "docs-agent"]),
        )
        expect(allowedRecipients(yield* cfg.get(), "assistant", "send_message")).not.toContain("orchestrator")
        expect(allowedRecipients(yield* cfg.get(), "assistant", "transfer")).not.toContain("orchestrator")
        expect(allowedRecipients(yield* cfg.get(), "assistant", "transfer")).not.toContain("general")
        expect(virtualAssistantTools.has("send_message")).toBe(false)
        expect(virtualAssistantTools.has("transfer")).toBe(false)
        expect(virtualAssistantTools.has("composio")).toBe(true)
        expect(buildTools.has("transfer")).toBe(false)
        expect(buildTools.has("send_message")).toBe(false)
        expect(planTools.has("transfer")).toBe(false)
        expect(docsTools.has("transfer")).toBe(false)
        expect(docsTools.has("docs")).toBe(true)
        const slidesAgent = yield* agents.get("slides-agent")
        const slidesTools = new Set((yield* registry.tools({ ...ref, agent: slidesAgent })).map((tool) => tool.id))
        expect(slidesTools.has("slides")).toBe(true)
        expect(slidesTools.has("slides_theme")).toBe(true)
        expect(slidesTools.has("slide_screenshot")).toBe(true)
        expect(slidesTools.has("slide_overflow_check")).toBe(true)
        expect(docsTools.has("slide_screenshot")).toBe(false)
      }),
    ),
  )

  it.live("send_message requires an existing recipient session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* SendMessageTool
        const def = yield* tool.init()

        const exit = yield* def
          .execute(
            {
              recipient_agent: "deep-research",
              description: "research topic",
              message: "Research citation practices",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "assistant",
              abort: new AbortController().signal,
              extra: { promptOps: promptOps() },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          expect(String(exit.cause)).toContain("No existing deep-research subagent session")
        }
      }),
    ),
  )

  it.live("send_message reuses an existing recipient session and returns the specialist result", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "research topic (@deep-research subagent)" })
        const tool = yield* SendMessageTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined

        const result = yield* def.execute(
          {
            recipient_agent: "deep-research",
            description: "research topic",
            message: "Research citation practices",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            extra: { promptOps: promptOps({ text: "research complete", onPrompt: (input) => (seen = input) }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const children = yield* sessions.children(chat.id)
        expect(children).toHaveLength(1)
        expect(seen?.agent).toBe("deep-research")
        expect(seen?.sessionID).toBe(child.id)
        expect(result.metadata).toMatchObject({ recipientAgent: "deep-research", mode: "send_message" })
        expect(result.metadata.sessionId).toBe(child.id)
        expect(result.output).toContain("research complete")
      }),
    ),
  )

  it.live("send_message can message the general subagent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "check in (@general subagent)" })
        const tool = yield* SendMessageTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined

        const result = yield* def.execute(
          {
            recipient_agent: "general",
            description: "check in",
            message: "how are you",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            extra: { promptOps: promptOps({ text: "I'm doing well.", onPrompt: (input) => (seen = input) }) },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const children = yield* sessions.children(chat.id)
        expect(children).toHaveLength(1)
        expect(seen?.agent).toBe("general")
        expect(seen?.sessionID).toBe(child.id)
        expect(result.metadata).toMatchObject({ recipientAgent: "general", mode: "send_message" })
        expect(result.metadata.sessionId).toBe(child.id)
        expect(result.output).toContain("I'm doing well.")
      }),
    ),
  )

  it.live("communication flows can deny send_message while preserving transfer", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const { chat, assistant } = yield* seed()
          const send = yield* SendMessageTool
          const transfer = yield* TransferTool
          const sendDef = yield* send.init()
          const transferDef = yield* transfer.init()

          const sendExit = yield* sendDef
            .execute(
              {
                recipient_agent: "deep-research",
                message: "Research this",
              },
              {
                sessionID: chat.id,
                messageID: assistant.id,
                agent: "assistant",
                abort: new AbortController().signal,
                extra: {
                  promptOps: {
                    cancel() {},
                    resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
                    prompt: (input: SessionPrompt.PromptInput) => Effect.succeed(reply(input, "done")),
                  },
                },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            .pipe(Effect.exit)

          const transferResult = yield* transferDef.execute(
            {
              recipient_agent: "deep-research",
              reason: "research owner",
            },
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

          expect(sendExit._tag).toBe("Failure")
          expect(transferResult.metadata).toMatchObject({ recipientAgent: "deep-research", mode: "transfer" })
        }),
      {
        config: {
          agent_communication: {
            flows: [{ from: "assistant", to: "deep-research", modes: ["transfer"] }],
          },
        },
      },
    ),
  )

  it.live("transfer creates a no-reply continuation for the recipient agent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const transfer = yield* TransferTool
        const def = yield* transfer.init()
        let continuation: SessionPrompt.PromptInput | undefined

        const result = yield* def.execute(
          {
            recipient_agent: "docs-agent",
            reason: "document generation request",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "assistant",
            abort: new AbortController().signal,
            extra: {
              promptOps: {
                cancel() {},
                resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
                prompt: (input: SessionPrompt.PromptInput) =>
                  Effect.sync(() => {
                    continuation = input
                    return reply(input, "not used")
                  }),
              },
            },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.metadata).toMatchObject({
          recipientAgent: "docs-agent",
          mode: "transfer",
          continuationCreated: true,
        })
        expect(continuation?.agent).toBe("docs-agent")
        expect(continuation?.noReply).toBe(true)
        expect(continuation?.parts[0]?.type).toBe("text")
      }),
    ),
  )

  it.live("docs and slides tools create native artifacts with attachments", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const docs = yield* DocsTool
        const slides = yield* SlidesTool
        const docsDef = yield* docs.init()
        const slidesDef = yield* slides.init()
        const ctx = {
          sessionID: "ses_test" as any,
          messageID: "msg_test" as any,
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }

        const doc = yield* docsDef.execute(
          {
            task: "create a memo",
            title: "Memo",
            markdown: "Short memo body.",
            output_path: "deliverables/test-memo.docx",
          },
          { ...ctx, agent: "docs-agent" },
        )
        const deck = yield* slidesDef.execute(
          {
            task: "create slides",
            title: "Deck",
            output_path: "deliverables/test-deck.pptx",
            slides: [{ title: "Overview", bullets: ["One", "Two"] }],
          },
          { ...ctx, agent: "slides-agent" },
        )

        expect(doc.metadata.outputPath).toEndWith("deliverables/test-memo.docx")
        expect(deck.metadata.outputPath).toEndWith("deliverables/test-deck.pptx")
        expect(doc.attachments?.[0]?.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        expect(deck.attachments?.[0]?.mime).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        const docHeader = yield* Effect.promise(async () =>
          Array.from(new Uint8Array(await Bun.file(doc.metadata.outputPath!).arrayBuffer()).slice(0, 2))
            .map((x) => String.fromCharCode(x))
            .join(""),
        )
        const deckHeader = yield* Effect.promise(async () =>
          Array.from(new Uint8Array(await Bun.file(deck.metadata.outputPath!).arrayBuffer()).slice(0, 2))
            .map((x) => String.fromCharCode(x))
            .join(""),
        )
        expect(docHeader).toBe("PK")
        expect(deckHeader).toBe("PK")
      }),
    ),
  )

  it.live("slide theme, screenshots, and overflow checks create QA artifacts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const theme = yield* SlidesThemeTool
        const screenshot = yield* SlideScreenshotTool
        const overflow = yield* SlideOverflowCheckTool
        const themeDef = yield* theme.init()
        const screenshotDef = yield* screenshot.init()
        const overflowDef = yield* overflow.init()
        const ctx = {
          sessionID: "ses_test" as any,
          messageID: "msg_test" as any,
          agent: "slides-agent",
          abort: new AbortController().signal,
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        }
        const slides = [
          {
            title:
              "This is a deliberately long title intended to trigger the overflow checker so the agent can revise it",
            bullets: [
              "A short bullet",
              "A very long bullet that carries enough detail to make the slide too dense for a clean executive presentation and should be split or shortened.",
              "Another dense bullet with additional information that belongs in speaker notes or a separate slide rather than on the same canvas.",
              "Fourth",
              "Fifth",
              "Sixth",
              "Seventh",
              "Eighth",
            ],
          },
        ]

        const themeResult = yield* themeDef.execute(
          {
            task: "create a brand theme",
            theme: { name: "Launch", background: "#f8fafc", foreground: "#111827", accent: "#0f766e" },
            output_path: "deliverables/launch-theme.json",
          },
          ctx,
        )
        const screenshotResult = yield* screenshotDef.execute(
          {
            task: "preview slides",
            slides,
            theme: { name: "Launch", background: "#f8fafc", foreground: "#111827", accent: "#0f766e" },
            output_dir: "deliverables/previews",
          },
          ctx,
        )
        const overflowResult = yield* overflowDef.execute(
          {
            task: "check slide density",
            slides,
            output_path: "deliverables/overflow.md",
          },
          ctx,
        )

        expect(themeResult.metadata.outputPath).toEndWith("deliverables/launch-theme.json")
        expect(screenshotResult.metadata.outputPaths[0]).toEndWith("deliverables/previews/slide-01.svg")
        expect(screenshotResult.attachments?.[0]?.mime).toBe("image/svg+xml")
        expect(overflowResult.metadata.ok).toBe(false)
        expect(overflowResult.metadata.issueCount).toBeGreaterThan(0)
        expect(overflowResult.metadata.outputPath).toEndWith("deliverables/overflow.md")
        expect(yield* Effect.promise(() => Bun.file(screenshotResult.metadata.outputPaths[0]!).text())).toContain("<svg")
        expect(yield* Effect.promise(() => Bun.file(overflowResult.metadata.outputPath).text())).toContain("NEEDS_FIX")
      }),
    ),
  )

  it.live("credential-aware tools explain missing per-user OAuth setup", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* ComposioTool
        const def = yield* tool.init()
        const result = yield* def.execute(
          { task: "send an email" },
          {
            sessionID: "ses_test" as any,
            messageID: "msg_test" as any,
            agent: "virtual-assistant",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect(result.metadata.missing).toContain("COMPOSIO_OAUTH_CONNECTION")
        expect(result.output).toContain("Composio is not connected")
      }),
    ),
  )
})
