import { Config } from "@/config/config"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_ASSISTANT from "./prompt/assistant.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { isGeneralChatDirectory } from "@/general-chat/shared"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { zod } from "@/util/effect-zod"
import { withStatics, type DeepMutable } from "@/util/schema"

const OPEN_SWARM_SHARED = [
  "You are part of an OpenSwarm-style multi-agent system.",
  "Stay inside your specialty. The native assistant agent coordinates routing, delegation, and handoffs.",
  "If the user asks for work owned by another specialist, briefly name the correct specialist instead of attempting partial work.",
  "For user-facing files, include concrete file paths in final responses and avoid dumping raw generated source unless the user explicitly asks for it.",
  "When a required API key or integration is missing, explain the exact setup key instead of pretending the action succeeded.",
].join("\n")

const ASSISTANT_SWARM_PROMPT = [
  OPEN_SWARM_SHARED,
  "",
  "You are also the coordinator for the specialist team. You are the only agent that can call delegation, background task, send_message, and transfer tools.",
  "Use transfer for one-specialist user requests. Use send_message when two or more independent specialist subtasks should run in parallel and you need to combine their results.",
  "Do not route to a separate orchestrator agent; orchestrator behavior is merged into you.",
  "When delegating file-producing tasks, summarize delivered file paths instead of dumping raw generated contents.",
  "",
  "Routing guide:",
  "- virtual-assistant: everyday tasks, external systems, messaging, scheduling, task management, Composio integrations.",
  "- deep-research: evidence-based web research, citations, source-backed analysis.",
  "- data-analyst: structured data analysis, KPIs, charts, statistics, IPython-style analysis.",
  "- slides-agent: HTML slide decks and PPTX exports.",
  "- docs-agent: Word/PDF/Markdown/TXT document creation and conversion.",
  "- image-generation-agent: image generation, editing, and composition.",
  "- video-generation-agent: video generation, editing, and assembly.",
].join("\n")

const specialistPrompt = (role: string, owns: string, tools: string) =>
  [
    OPEN_SWARM_SHARED,
    "",
    `You are the ${role}.`,
    `You own: ${owns}.`,
    `Use your specialist tools for: ${tools}.`,
    "If a task belongs to another specialist, state the correct owner briefly. Do not call delegation, background task, send_message, or transfer tools.",
  ].join("\n")

const ASSISTANT_META_TOOLS = {
  task: "allow",
  background_task: "allow",
  background_task_list: "allow",
  background_task_get: "allow",
  background_task_cancel: "allow",
  background_task_graph: "allow",
  background_task_graph_list: "allow",
  background_task_graph_get: "allow",
  background_task_graph_cancel: "allow",
  send_message: "allow",
  transfer: "allow",
} as const

const DENY_META_TOOLS = {
  task: "deny",
  background_task: "deny",
  background_task_list: "deny",
  background_task_get: "deny",
  background_task_cancel: "deny",
  background_task_graph: "deny",
  background_task_graph_list: "deny",
  background_task_graph_get: "deny",
  background_task_graph_cancel: "deny",
  send_message: "deny",
  transfer: "deny",
} as const

const BUILD_META_TOOLS = {
  ...DENY_META_TOOLS,
  task: "allow",
} as const

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
})
  .annotate({ identifier: "Agent" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }>
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
        ]

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})
        const preferredPrimary = isGeneralChatDirectory(ctx.directory) ? "assistant" : "build"

        const agents: Record<string, Info> = {
          build: {
            name: "build",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                ...BUILD_META_TOOLS,
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          assistant: {
            name: "assistant",
            description:
              "Primary agent with background subagent and graph-task capabilities. Use this when you want the official assistant behavior plus advanced delegation workflows.",
            options: {
              assistant_tools: true,
              extend_provider_prompt: true,
            },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                ...ASSISTANT_META_TOOLS,
              }),
              user,
            ),
            mode: "primary",
            native: true,
            prompt: [PROMPT_ASSISTANT, ASSISTANT_SWARM_PROMPT].join("\n\n"),
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                ...DENY_META_TOOLS,
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".opencode", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
                ...DENY_META_TOOLS,
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                websearch: "allow",
                read: "allow",
                ...DENY_META_TOOLS,
                external_directory: {
                  "*": "ask",
                  ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
                },
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
          "virtual-assistant": {
            name: "virtual-assistant",
            description:
              "Virtual assistant for writing, scheduling, messaging, task management, and external app workflows.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, composio: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Virtual Assistant",
              "everyday assistant workflows, writing, scheduling, messaging, task management, and external integrations",
              "Composio-backed external actions and integration discovery",
            ),
            color: "info",
          },
          "deep-research": {
            name: "deep-research",
            description:
              "Research specialist for comprehensive web research with citations, source comparison, and balanced analysis.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                ...DENY_META_TOOLS,
                webfetch: "allow",
                websearch: "allow",
                deep_research: "allow",
              }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Deep Research Agent",
              "evidence-based web research, citations, source-backed synthesis, and balanced analysis",
              "web search, web fetch, citation collection, and research report drafting",
            ),
            color: "accent",
          },
          "data-analyst": {
            name: "data-analyst",
            description:
              "Data analyst for structured data analysis, charts, KPIs, statistical models, and isolated analysis workflows.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, data_kernel: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Data Analyst",
              "structured data analysis, charts, KPIs, statistical summaries, and model-driven insights",
              "isolated IPython-style data analysis and chart generation",
            ),
            color: "success",
          },
          "slides-agent": {
            name: "slides-agent",
            description: "Slides specialist for polished HTML slide decks and PPTX exports.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, slides: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Slides Agent",
              "presentation creation, editing, visual polish, HTML decks, and PPTX export",
              "slide deck creation and export workflows",
            ),
            color: "warning",
          },
          "docs-agent": {
            name: "docs-agent",
            description: "Document specialist for Word documents, PDFs, Markdown, TXT, and formatted deliverables.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, docs: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Docs Agent",
              "formatted documents, Word files, PDFs, Markdown, TXT, outlines, and conversions",
              "document creation and export workflows",
            ),
            color: "secondary",
          },
          "image-generation-agent": {
            name: "image-generation-agent",
            description: "Image specialist for generation, editing, composition, and visual asset creation.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, image_generation: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Image Generation Agent",
              "image generation, image editing, composition, and visual asset creation",
              "Gemini/fal-style image generation and editing workflows",
            ),
            color: "primary",
          },
          "video-generation-agent": {
            name: "video-generation-agent",
            description: "Video specialist for generation, editing, assembly, and clip composition.",
            options: { openswarm: true },
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({ ...DENY_META_TOOLS, video_generation: "allow" }),
              user,
            ),
            mode: "subagent",
            native: true,
            prompt: specialistPrompt(
              "Video Generation Agent",
              "video generation, editing, assembly, clip composition, and media workflows",
              "Sora/Veo/Seedance/fal-style video generation and editing workflows",
            ),
            color: "error",
          },
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agents[name].permission = Permission.merge(
            agents[name].permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          return agents[agent]
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === preferredPrimary), "desc"],
              [(x) => x.name, "asc"],
            ),
          )
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent.name
          }
          const preferred = agents[preferredPrimary]
          if (preferred && preferred.mode !== "subagent" && preferred.hidden !== true) return preferred.name
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible.name
        })

        return {
          get,
          list,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: z.object({
            identifier: z.string(),
            whenToUse: z.string(),
            systemPrompt: z.string(),
          }),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Agent from "./agent"
