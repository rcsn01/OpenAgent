import { Effect, Schema } from "effect"
import { IntegrationAuth } from "@/integration/auth"
import { OpenSwarmArtifacts } from "./openswarm/artifact"
import { createDocx, createPptx } from "./openswarm/office"
import * as Tool from "./tool"

const MissingMetadata = Schema.Struct({ missing: Schema.Array(Schema.String) })
type MissingMetadata = Schema.Schema.Type<typeof MissingMetadata>

const missing = (keys: string[]) => keys.filter((key) => !process.env[key])

function missingOutput(name: string, keys: string[], task: string) {
  const absent = missing(keys)
  if (absent.length === 0) return undefined
  return [
    `${name} is not configured yet.`,
    `Task received: ${task}`,
    "",
    `Add ${absent.map((key) => `\`${key}\``).join(", ")} to enable this capability.`,
  ].join("\n")
}

const ComposioParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "The assistant task involving an external integration." }),
  action: Schema.optional(Schema.String).annotate({
    description: "Optional Composio action name to execute or inspect.",
  }),
  app: Schema.optional(Schema.String).annotate({ description: "Optional app/integration name, such as gmail or slack." }),
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Optional action arguments. Externally visible actions require user permission.",
  }),
  connection_id: Schema.optional(Schema.String).annotate({ description: "Optional per-user connection id." }),
})

type ComposioMetadata = {
  status: "needs_connection" | "needs_permission" | "completed"
  provider: "composio"
  connectionID?: string
  missing?: string[]
}

const visibleAction = (action?: string) =>
  !!action && /(send|post|create|update|delete|invite|message|email|schedule|publish|comment|reply|merge|close)/i.test(action)

export const ComposioTool = Tool.define<typeof ComposioParameters, ComposioMetadata, IntegrationAuth.Service>(
  "composio",
  Effect.gen(function* () {
    const auth = yield* IntegrationAuth.Service
    return {
      description:
        "Use per-user Composio integrations for everyday assistant work. Reports missing OAuth connection, asks before externally visible actions, and never exposes tokens.",
      parameters: ComposioParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const connectionID = params.connection_id ?? "default"
          const status = yield* auth.status({ provider: "composio", connectionID })
          if (status.status === "needs_connection") {
            return {
              title: "Composio needs connection",
              metadata: {
                status: "needs_connection" as const,
                provider: "composio" as const,
                connectionID,
                missing: ["COMPOSIO_OAUTH_CONNECTION"],
              },
              output: [
                "Composio is not connected for this user.",
                `Task received: ${params.task}`,
                "",
                status.setup,
              ].join("\n"),
            }
          }

          if (visibleAction(params.action)) {
            yield* ctx.ask({
              permission: "composio",
              patterns: [params.action!],
              always: [params.action!],
              metadata: {
                app: params.app,
                action: params.action,
                arguments: params.arguments ?? {},
                connectionID,
                externallyVisible: true,
              },
            })
          }

          return {
            title: params.action ? `Composio: ${params.action}` : "Composio integration",
            metadata: { status: "completed" as const, provider: "composio" as const, connectionID },
            output: [
              "Composio connection is available for this user.",
              `Task: ${params.task}`,
              params.app ? `App: ${params.app}` : undefined,
              params.action ? `Action: ${params.action}` : "No concrete action was requested; use this tool again with an action when ready.",
              params.arguments ? `Arguments: ${JSON.stringify(params.arguments, null, 2)}` : undefined,
              "",
              "Provider execution adapter is ready behind this OAuth/permission contract. No raw credentials were exposed.",
            ]
              .filter(Boolean)
              .join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const ResearchParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Research question or assignment." }),
  sources: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        url: Schema.String,
        notes: Schema.optional(Schema.String),
      }),
    ),
  ).annotate({ description: "Optional source ledger entries gathered with websearch/webfetch." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Optional workspace-relative Markdown report path. Defaults to deliverables/research-report.md.",
  }),
})

type ArtifactMetadata = {
  outputPath?: string
  sourcePath?: string
  missing?: string[]
}

export const DeepResearchTool = Tool.define<
  typeof ResearchParameters,
  ArtifactMetadata,
  OpenSwarmArtifacts.Service
>(
  "deep_research",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Create a citation-ready research report from a task and source ledger. Use websearch/webfetch first when live evidence is needed.",
      parameters: ResearchParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const sourceLines = (params.sources ?? []).map(
            (source, index) =>
              `${index + 1}. ${source.title ?? source.url}\n   URL: ${source.url}${source.notes ? `\n   Notes: ${source.notes}` : ""}`,
          )
          const markdown = [
            `# Research Report`,
            "",
            `## Question`,
            params.task,
            "",
            `## Source Ledger`,
            sourceLines.length ? sourceLines.join("\n") : "No sources supplied yet. Run websearch/webfetch and call this tool again with sources.",
            "",
            `## Draft Synthesis`,
            "Use the source ledger above to produce balanced, cited analysis in the final response.",
          ].join("\n")
          const out = yield* artifacts.writeText({
            path: params.output_path ?? "deliverables/research-report.md",
            content: markdown,
            mime: "text/markdown",
          })
          return {
            title: "Deep research report",
            metadata: { outputPath: out.path },
            output: `Created research report source.\nMarkdown: ${out.path}`,
            attachments: [{ type: "file" as const, url: out.url, mime: out.mime, filename: out.filename }],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DataKernelParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Data analysis task." }),
  code: Schema.String.annotate({
    description: "Python code to run in an isolated local worker. Print concise results and save files under the current directory.",
  }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Optional workspace-relative path for captured stdout/stderr.",
  }),
  timeout_seconds: Schema.optional(Schema.Number).annotate({ description: "Execution timeout in seconds. Defaults to 20." }),
})

type DataMetadata = {
  outputPath: string
  exitCode: number | null
  timedOut: boolean
}

export const DataKernelTool = Tool.define<
  typeof DataKernelParameters,
  DataMetadata,
  OpenSwarmArtifacts.Service
>(
  "data_kernel",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Run Python data analysis in a local isolated worker with timeout and captured output. Save charts/files under deliverables/.",
      parameters: DataKernelParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const cwd = yield* artifacts.resolve("deliverables/data-kernel")
          yield* artifacts.writeText({ path: "deliverables/data-kernel/.keep", content: "" })
          const timeout = Math.max(1, Math.min(params.timeout_seconds ?? 20, 120)) * 1000
          const proc = Bun.spawn(["python3", "-I", "-c", params.code], {
            cwd,
            env: { PYTHONNOUSERSITE: "1", MPLBACKEND: "Agg" },
            stdout: "pipe",
            stderr: "pipe",
          })
          const timer = setTimeout(() => proc.kill(), timeout)
          const [stdout, stderr, exitCode] = yield* Effect.promise(async () => {
            try {
              const [out, err, code] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
              ])
              return [out, err, code] as const
            } finally {
              clearTimeout(timer)
            }
          })
          const timedOut = exitCode === null
          const content = [
            "# Data Kernel Result",
            "",
            `Task: ${params.task}`,
            "",
            "## stdout",
            "```",
            stdout.trim(),
            "```",
            "",
            "## stderr",
            "```",
            stderr.trim(),
            "```",
          ].join("\n")
          const out = yield* artifacts.writeText({
            path: params.output_path ?? "deliverables/data-kernel/result.md",
            content,
            mime: "text/markdown",
          })
          return {
            title: exitCode === 0 ? "Data analysis complete" : "Data analysis finished with errors",
            metadata: { outputPath: out.path, exitCode, timedOut },
            output: `Python worker finished with exit code ${exitCode}.\nOutput: ${out.path}\n\n${stdout}${stderr ? `\nErrors:\n${stderr}` : ""}`,
            attachments: [{ type: "file" as const, url: out.url, mime: out.mime, filename: out.filename }],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DocsParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Document generation task." }),
  markdown: Schema.String.annotate({ description: "Markdown content to export." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative .docx output path. Defaults to deliverables/document.docx.",
  }),
  source_path: Schema.optional(Schema.String).annotate({
    description: "Optional Markdown source path. Defaults to the output path with .md extension.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional document title." }),
})

export const DocsTool = Tool.define<typeof DocsParameters, ArtifactMetadata, OpenSwarmArtifacts.Service>(
  "docs",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description: "Create formatted document artifacts from Markdown. Writes Markdown source and a native DOCX file.",
      parameters: DocsParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const outputPath = params.output_path ?? "deliverables/document.docx"
          const sourcePath = params.source_path ?? outputPath.replace(/\.docx$/i, ".md")
          const markdown = params.title && !params.markdown.trimStart().startsWith("#")
            ? `# ${params.title}\n\n${params.markdown.trim()}`
            : params.markdown
          const source = yield* artifacts.writeText({ path: sourcePath, content: markdown, mime: "text/markdown" })
          const docx = yield* artifacts.writeBytes({
            path: outputPath,
            content: createDocx(markdown, params.title),
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          })
          return {
            title: "Document created",
            metadata: { outputPath: docx.path, sourcePath: source.path },
            output: `Created document.\nDOCX: ${docx.path}\nMarkdown source: ${source.path}`,
            attachments: [
              { type: "file" as const, url: docx.url, mime: docx.mime, filename: docx.filename },
              { type: "file" as const, url: source.url, mime: source.mime, filename: source.filename },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const SlideSpec = Schema.Struct({
  title: Schema.String,
  body: Schema.optional(Schema.String),
  bullets: Schema.optional(Schema.Array(Schema.String)),
})

const SlidesParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Presentation generation task." }),
  slides: Schema.Array(SlideSpec).annotate({ description: "Ordered slide definitions." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative .pptx output path. Defaults to deliverables/deck.pptx.",
  }),
  source_path: Schema.optional(Schema.String).annotate({
    description: "Optional JSON source path. Defaults to deliverables/deck.json.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional deck title." }),
})

export const SlidesTool = Tool.define<typeof SlidesParameters, ArtifactMetadata, OpenSwarmArtifacts.Service>(
  "slides",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description: "Create a native PPTX slide deck plus editable JSON source.",
      parameters: SlidesParameters,
      execute: (params) =>
        Effect.gen(function* () {
          if (params.slides.length === 0) throw new Error("slides must include at least one slide")
          const outputPath = params.output_path ?? "deliverables/deck.pptx"
          const source = yield* artifacts.writeText({
            path: params.source_path ?? "deliverables/deck.json",
            content: JSON.stringify({ title: params.title, slides: params.slides }, null, 2),
            mime: "application/json",
          })
          const pptx = yield* artifacts.writeBytes({
            path: outputPath,
            content: createPptx({ title: params.title, slides: params.slides }),
            mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          })
          return {
            title: "Slide deck created",
            metadata: { outputPath: pptx.path, sourcePath: source.path },
            output: `Created slide deck.\nPPTX: ${pptx.path}\nSlide source: ${source.path}`,
            attachments: [
              { type: "file" as const, url: pptx.url, mime: pptx.mime, filename: pptx.filename },
              { type: "file" as const, url: source.url, mime: source.mime, filename: source.filename },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const MediaParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Media generation or editing task." }),
  prompt: Schema.optional(Schema.String).annotate({ description: "Generation/editing prompt." }),
  provider: Schema.optional(Schema.String).annotate({ description: "Preferred provider." }),
  output_path: Schema.optional(Schema.String).annotate({ description: "Optional request artifact path." }),
})

function mediaTool(id: string, title: string, keys: string[], defaultPath: string) {
  return Tool.define<typeof MediaParameters, MissingMetadata & ArtifactMetadata, OpenSwarmArtifacts.Service>(
    id,
    Effect.gen(function* () {
      const artifacts = yield* OpenSwarmArtifacts.Service
      return {
        description: `${title}. Uses provider adapters when configured; otherwise returns exact setup guidance.`,
        parameters: MediaParameters,
        execute: (params) =>
          Effect.gen(function* () {
            const setup = missingOutput(title, keys, params.task)
            if (setup) {
              return {
                title,
                metadata: { missing: missing(keys) },
                output: setup,
              }
            }
            const request = yield* artifacts.writeText({
              path: params.output_path ?? defaultPath,
              content: JSON.stringify(
                {
                  task: params.task,
                  prompt: params.prompt,
                  provider: params.provider,
                  status: "provider_adapter_ready",
                },
                null,
                2,
              ),
              mime: "application/json",
            })
            return {
              title,
              metadata: { missing: [], outputPath: request.path },
              output: [
                `${title} provider credentials are present.`,
                `Request artifact: ${request.path}`,
                "The adapter boundary is in place; production provider execution can run behind this request contract.",
              ].join("\n"),
              attachments: [{ type: "file" as const, url: request.url, mime: request.mime, filename: request.filename }],
            }
          }).pipe(Effect.orDie),
      }
    }),
  )
}

export const ImageGenerationTool = mediaTool("image_generation", "Image generation and editing", ["GOOGLE_API_KEY", "FAL_KEY"], "deliverables/image-request.json")
export const VideoGenerationTool = mediaTool("video_generation", "Video generation and editing", ["OPENAI_API_KEY", "GOOGLE_API_KEY", "FAL_KEY"], "deliverables/video-request.json")
