import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { BackgroundTaskGraphCancelTool, BackgroundTaskGraphGetTool, BackgroundTaskGraphListTool } from "./background_task_graph_manage"
import { BackgroundTaskCancelTool, BackgroundTaskGetTool, BackgroundTaskListTool } from "./background_task_manage"
import { BackgroundTaskTool } from "./background_task"
import { BackgroundTaskGraphTool } from "./background_task_graph"
import {
  ComposioTool,
  DataKernelTool,
  DeepResearchTool,
  DocsTool,
  ImageGenerationTool,
  SlidesTool,
  VideoGenerationTool,
} from "./openswarm_stub"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { SendMessageTool } from "./send_message"
import { TransferTool } from "./transfer"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import { Schema } from "effect"
import z from "zod"
import { ZodOverride } from "@/util/effect-zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { SessionBackgroundTask } from "../session/background-task"
import { TaskExecution } from "../session/task-execution"
import { SessionTaskGraph } from "../session/task-graph"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { allowedRecipients } from "@/agent/communication"
import { isSpawnableAgent } from "@/agent/spawnable"
import { IntegrationAuth } from "@/integration/auth"
import { OpenSwarmArtifacts } from "./openswarm/artifact"

const log = Log.create({ service: "tool.registry" })
const assistantOnlyToolIDs = new Set([
  "task",
  "background_task",
  "background_task_list",
  "background_task_get",
  "background_task_cancel",
  "background_task_graph",
  "background_task_graph_list",
  "background_task_graph_get",
  "background_task_graph_cancel",
  "send_message",
  "transfer",
])

const openswarmToolOwners: Record<string, string[]> = {
  composio: ["virtual-assistant"],
  deep_research: ["deep-research"],
  data_kernel: ["data-analyst"],
  slides: ["slides-agent"],
  docs: ["docs-agent"],
  image_generation: ["image-generation-agent"],
  video_generation: ["video-generation-agent"],
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: { providerID: ProviderID; modelID: ModelID; agent: Agent.Info }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | TaskExecution.Service
  | SessionTaskGraph.Service
  | SessionBackgroundTask.Service
  | Provider.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Bus.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
  | IntegrationAuth.Service
  | OpenSwarmArtifacts.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const sendMessage = yield* SendMessageTool
    const transfer = yield* TransferTool
    const backgroundTask = yield* BackgroundTaskTool
    const backgroundTaskGraph = yield* BackgroundTaskGraphTool
    const backgroundTaskList = yield* BackgroundTaskListTool
    const backgroundTaskGet = yield* BackgroundTaskGetTool
    const backgroundTaskCancel = yield* BackgroundTaskCancelTool
    const backgroundTaskGraphList = yield* BackgroundTaskGraphListTool
    const backgroundTaskGraphGet = yield* BackgroundTaskGraphGetTool
    const backgroundTaskGraphCancel = yield* BackgroundTaskGraphCancelTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const bash = yield* BashTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const composio = yield* ComposioTool
    const deepResearch = yield* DeepResearchTool
    const dataKernel = yield* DataKernelTool
    const slides = yield* SlidesTool
    const docs = yield* DocsTool
    const imageGeneration = yield* ImageGenerationTool
    const videoGeneration = yield* VideoGenerationTool
    const agent = yield* Agent.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools define their args as a raw Zod shape. Wrap the
          // derived Zod object in a `Schema.declare` so it slots into the
          // Schema-typed framework, and annotate with `ZodOverride` so the
          // walker emits the original Zod object for LLM JSON Schema.
          const zodParams = z.object(def.args)
          const parameters = Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success).annotate({
            [ZodOverride]: zodParams,
          })
          return {
            id,
            parameters,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          bash: Tool.init(bash),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          sendMessage: Tool.init(sendMessage),
          transfer: Tool.init(transfer),
          backgroundTask: Tool.init(backgroundTask),
          backgroundTaskGraph: Tool.init(backgroundTaskGraph),
          backgroundTaskList: Tool.init(backgroundTaskList),
          backgroundTaskGet: Tool.init(backgroundTaskGet),
          backgroundTaskCancel: Tool.init(backgroundTaskCancel),
          backgroundTaskGraphList: Tool.init(backgroundTaskGraphList),
          backgroundTaskGraphGet: Tool.init(backgroundTaskGraphGet),
          backgroundTaskGraphCancel: Tool.init(backgroundTaskGraphCancel),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          composio: Tool.init(composio),
          deepResearch: Tool.init(deepResearch),
          dataKernel: Tool.init(dataKernel),
          slides: Tool.init(slides),
          docs: Tool.init(docs),
          imageGeneration: Tool.init(imageGeneration),
          videoGeneration: Tool.init(videoGeneration),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
        })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.bash,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.sendMessage,
            tool.transfer,
            tool.backgroundTask,
            tool.backgroundTaskGraph,
            tool.backgroundTaskList,
            tool.backgroundTaskGet,
            tool.backgroundTaskCancel,
            tool.backgroundTaskGraphList,
            tool.backgroundTaskGraphGet,
            tool.backgroundTaskGraphCancel,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.composio,
            tool.deepResearch,
            tool.dataKernel,
            tool.slides,
            tool.docs,
            tool.imageGeneration,
            tool.videoGeneration,
            tool.patch,
            ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
            ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),
          ],
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter(isSpawnableAgent)
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const describeCommunication = Effect.fn("ToolRegistry.describeCommunication")(function* (
      agent: Agent.Info,
      mode: "send_message" | "transfer",
    ) {
      const cfg = yield* config.get()
      const recipients = allowedRecipients(cfg, agent.name, mode)
      if (recipients.length === 0) return `No ${mode} recipients are available for ${agent.name}.`
      const infos = yield* Effect.forEach(
        recipients,
        Effect.fnUntraced(function* (name) {
          const recipient = yield* agents.get(name)
          return `- ${name}: ${recipient?.description ?? "Specialist agent"}`
        }),
      )
      return [`Allowed ${mode} recipients for ${agent.name}:`, ...infos].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const cfg = yield* config.get()
      const filtered = (yield* all()).filter((tool) => {
        if (assistantOnlyToolIDs.has(tool.id) && input.agent.name !== "assistant") return false

        if (tool.id === SendMessageTool.id) {
          return allowedRecipients(cfg, input.agent.name, "send_message").length > 0
        }
        if (tool.id === TransferTool.id) {
          return allowedRecipients(cfg, input.agent.name, "transfer").length > 0
        }
        const owners = openswarmToolOwners[tool.id]
        if (owners && !owners.includes(input.agent.name)) return false

        if (tool.id === WebSearchTool.id) {
          return input.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id || tool.id === BackgroundTaskTool.id || tool.id === BackgroundTaskGraphTool.id
                ? yield* describeTask(input.agent)
                : undefined,
              tool.id === SendMessageTool.id ? yield* describeCommunication(input.agent, "send_message") : undefined,
              tool.id === TransferTool.id ? yield* describeCommunication(input.agent, "transfer") : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer = Layer.suspend(() => {
  const base = Layer.mergeAll(
    Config.defaultLayer,
    Plugin.defaultLayer,
    Question.defaultLayer,
    Todo.defaultLayer,
    Skill.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
    TaskExecution.defaultLayer,
    SessionTaskGraph.defaultLayer,
    SessionBackgroundTask.defaultLayer,
    Provider.defaultLayer,
    LSP.defaultLayer,
    Instruction.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    FetchHttpClient.layer,
    Format.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
  )
  return layer.pipe(Layer.provide(Layer.mergeAll(base, IntegrationAuth.defaultLayer, OpenSwarmArtifacts.defaultLayer)))
})

export * as ToolRegistry from "./registry"
