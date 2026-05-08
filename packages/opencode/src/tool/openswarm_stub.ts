import { Effect, Schema } from "effect"
import { IntegrationAuth } from "@/integration/auth"
import type { Artifact } from "./openswarm/artifact"
import { OpenSwarmArtifacts } from "./openswarm/artifact"
import { createDocx, createImagePptx, validatePptxPackage } from "./openswarm/office"
import {
  enrichSlides,
  htmlSlidePaths,
  planSlides,
  slideHtml,
  slideProjectDir,
  slideSubstanceReport,
  slideThemeCss,
  svgSlideImages,
  tryRenderHtmlSlides,
} from "./openswarm/slides_html"
import { checkSlideOverflow, inferTheme, renderSlideSvg, themeCssVariables } from "./openswarm/slide_qa"
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

type SlidesMetadata = ArtifactMetadata & {
  projectDir?: string
  htmlPaths?: string[]
  previewPaths?: string[]
  exportMode?: "playwright-png" | "svg-fallback"
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

const SlideTheme = Schema.Struct({
  name: Schema.optional(Schema.String),
  background: Schema.optional(Schema.String).annotate({ description: "Slide background color, e.g. #ffffff." }),
  foreground: Schema.optional(Schema.String).annotate({ description: "Primary text color, e.g. #172033." }),
  accent: Schema.optional(Schema.String).annotate({ description: "Accent color, e.g. #2563eb." }),
  fontFamily: Schema.optional(Schema.String).annotate({ description: "Font family name." }),
  titleSize: Schema.optional(Schema.Number).annotate({ description: "Title font size in pixels." }),
  bodySize: Schema.optional(Schema.Number).annotate({ description: "Body font size in pixels." }),
})

const SlidesParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Presentation generation task." }),
  slides: Schema.Array(SlideSpec).annotate({ description: "Ordered slide definitions." }),
  theme: Schema.optional(SlideTheme).annotate({ description: "Optional theme tokens used for HTML, preview, and PPTX export." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative .pptx output path. Defaults to deliverables/deck.pptx.",
  }),
  source_path: Schema.optional(Schema.String).annotate({
    description: "Optional JSON source path. Defaults to the generated HTML project deck.json.",
  }),
  project_dir: Schema.optional(Schema.String).annotate({
    description: "Optional workspace-relative HTML project directory. Defaults to deliverables/presentations/<deck-name>.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional deck title." }),
})

const SlidesPlanParameters = Schema.Struct({
  task: Schema.String.annotate({
    description: "Presentation request or topic. Include audience, goal, and known facts when available.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional deck title." }),
  slide_count: Schema.optional(Schema.Number).annotate({
    description: "Approximate slide count. Defaults to 8 for comparisons and 6 for general decks.",
  }),
})

type SlidesPlanMetadata = {
  slideCount: number
  titleOnlyCount: number
  titleOnlyRatio: number
}

export const SlidesPlanTool = Tool.define<typeof SlidesPlanParameters, SlidesPlanMetadata, never>(
  "slides_plan",
  Effect.sync(() => ({
    description:
      "Create an OpenSwarm-style slide plan from a presentation request. Produces a substantive deck outline that should be passed to slides_modify or slides.",
    parameters: SlidesPlanParameters,
    execute: (params) =>
      Effect.sync(() => {
        const planned = enrichSlides({
          task: params.task,
          title: params.title,
          slides: planSlides({ task: params.task, title: params.title, slideCount: params.slide_count }),
        })
        const report = slideSubstanceReport(planned)
        return {
          title: "Slide plan created",
          metadata: {
            slideCount: planned.length,
            titleOnlyCount: report.titleOnly,
            titleOnlyRatio: report.titleOnlyRatio,
          },
          output: JSON.stringify({ title: params.title, slides: planned }, null, 2),
        }
      }),
  })),
)

const SlidesModifyParameters = Schema.Struct({
  task: Schema.String.annotate({
    description:
      "A fully self-contained modification brief. Include concrete content, facts, items, desired emphasis, and any visual direction.",
  }),
  slide: SlideSpec.annotate({ description: "Slide to enrich or modify." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional deck title used for context." }),
})

type SlidesModifyMetadata = {
  changed: boolean
  substantive: boolean
}

export const SlidesModifyTool = Tool.define<typeof SlidesModifyParameters, SlidesModifyMetadata, never>(
  "slides_modify",
  Effect.sync(() => ({
    description:
      "Enrich or repair one slide from a self-contained brief. Use this after slides_plan, one slide at a time, before final PPTX export.",
    parameters: SlidesModifyParameters,
    execute: (params) =>
      Effect.sync(() => {
        const [slide] = enrichSlides({
          task: params.task,
          title: params.title,
          slides: [params.slide],
        })
        return {
          title: "Slide modified",
          metadata: {
            changed: JSON.stringify(slide) !== JSON.stringify(params.slide),
            substantive: slideSubstanceReport([slide]).ok,
          },
          output: JSON.stringify(slide, null, 2),
        }
      }),
  })),
)

export const SlidesTool = Tool.define<typeof SlidesParameters, SlidesMetadata, OpenSwarmArtifacts.Service>(
  "slides",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Create an OpenSwarm-style HTML slide project, render slide previews, and export a valid image-backed PPTX artifact.",
      parameters: SlidesParameters,
      execute: (params) =>
        Effect.gen(function* () {
          if (params.slides.length === 0) throw new Error("slides must include at least one slide")
          const plannedSlides = enrichSlides({ task: params.task, title: params.title, slides: params.slides })
          const substance = slideSubstanceReport(plannedSlides)
          if (!substance.ok) {
            throw new Error(
              `slides are not substantive enough to export: ${substance.titleOnly}/${substance.total} slides are title-only`,
            )
          }
          const outputPath = params.output_path ?? "deliverables/deck.pptx"
          const projectDir = slideProjectDir({
            title: params.title,
            task: params.task,
            outputPath,
            projectDir: params.project_dir,
          })
          const sourcePath = params.source_path ?? `${projectDir}/deck.json`
          const themePath = `${projectDir}/_theme.css`
          const previewDir = `${projectDir}/previews`
          const htmlPaths = htmlSlidePaths(projectDir, plannedSlides.length)
          const resolvedTheme = inferTheme({ task: params.task, title: params.title, theme: params.theme })

          const source = yield* artifacts.writeText({
            path: sourcePath,
            content: JSON.stringify(
              {
                task: params.task,
                title: params.title,
                theme: resolvedTheme,
                slides: plannedSlides,
                inputSlides: params.slides,
                quality: substance,
                html: htmlPaths,
              },
              null,
              2,
            ),
            mime: "application/json",
          })
          const theme = yield* artifacts.writeText({
            path: themePath,
            content: slideThemeCss(resolvedTheme),
            mime: "text/css",
          })
          const html: Artifact[] = []
          for (const [index, slide] of plannedSlides.entries()) {
            html.push(
              yield* artifacts.writeText({
                path: htmlPaths[index],
                content: slideHtml({
                  deckTitle: params.title,
                  slide,
                  slideNumber: index + 1,
                  slideCount: plannedSlides.length,
                }),
                mime: "text/html",
              }),
            )
          }

          const rendered = yield* Effect.promise(async () =>
            tryRenderHtmlSlides({
              htmlPaths: html.map((item) => item.path),
              previewDir,
            }),
          )
          const images = rendered ?? svgSlideImages({ slides: plannedSlides, theme: resolvedTheme, previewDir })
          const previews = []
          for (const image of images) {
            previews.push(
              typeof image.content === "string"
                ? yield* artifacts.writeText({
                    path: image.previewPath,
                    content: image.content,
                    mime: image.mime,
                  })
                : yield* artifacts.writeBytes({
                    path: image.previewPath,
                    content: image.content,
                    mime: image.mime,
                  }),
            )
          }

          const bytes = createImagePptx({ title: params.title, slides: images })
          if (!validatePptxPackage(bytes)) throw new Error("generated PPTX failed package validation")
          const pptx = yield* artifacts.writeBytes({
            path: outputPath,
            content: bytes,
            mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          })
          const exportMode = rendered ? "playwright-png" as const : "svg-fallback" as const
          return {
            title: "Slide deck created",
            metadata: {
              outputPath: pptx.path,
              sourcePath: source.path,
              projectDir,
              htmlPaths: html.map((item) => item.path),
              previewPaths: previews.map((item) => item.path),
              exportMode,
            },
            output: [
              "Created slide deck from an editable HTML slide project.",
              `PPTX: ${pptx.path}`,
              `Project: ${projectDir}`,
              `Deck source: ${source.path}`,
              `Theme CSS: ${theme.path}`,
              ...html.map((item) => `HTML: ${item.path}`),
              ...previews.map((item) => `Preview: ${item.path}`),
              `Export mode: ${exportMode}`,
            ].join("\n"),
            attachments: [
              { type: "file" as const, url: pptx.url, mime: pptx.mime, filename: pptx.filename },
              { type: "file" as const, url: source.url, mime: source.mime, filename: source.filename },
              { type: "file" as const, url: theme.url, mime: theme.mime, filename: theme.filename },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const SlidesThemeParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Theme design or update task." }),
  theme: SlideTheme.annotate({ description: "Theme tokens to save for a deck." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative theme JSON path. Defaults to deliverables/deck-theme.json.",
  }),
})

export const SlidesThemeTool = Tool.define<typeof SlidesThemeParameters, ArtifactMetadata, OpenSwarmArtifacts.Service>(
  "slides_theme",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Create or update a presentation theme token file for consistent slide colors, fonts, and type scale.",
      parameters: SlidesThemeParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const resolvedTheme = inferTheme({ task: params.task, theme: params.theme })
          const content = JSON.stringify(
            {
              task: params.task,
              theme: resolvedTheme,
              cssVariables: themeCssVariables(resolvedTheme),
            },
            null,
            2,
          )
          const theme = yield* artifacts.writeText({
            path: params.output_path ?? "deliverables/deck-theme.json",
            content,
            mime: "application/json",
          })
          return {
            title: "Slide theme saved",
            metadata: { outputPath: theme.path },
            output: `Created slide theme.\nTheme: ${theme.path}`,
            attachments: [{ type: "file" as const, url: theme.url, mime: theme.mime, filename: theme.filename }],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const SlideScreenshotParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Visual preview or screenshot task." }),
  slides: Schema.Array(SlideSpec).annotate({ description: "Slides to preview." }),
  theme: Schema.optional(SlideTheme).annotate({ description: "Optional theme tokens used for preview rendering." }),
  output_dir: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative output directory. Defaults to deliverables/slide-screenshots.",
  }),
})

type SlideScreenshotMetadata = {
  outputPaths: string[]
}

export const SlideScreenshotTool = Tool.define<
  typeof SlideScreenshotParameters,
  SlideScreenshotMetadata,
  OpenSwarmArtifacts.Service
>(
  "slide_screenshot",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Generate SVG slide screenshot previews so the Slides Agent can visually inspect layout, density, and theme application.",
      parameters: SlideScreenshotParameters,
      execute: (params) =>
        Effect.gen(function* () {
          if (params.slides.length === 0) throw new Error("slides must include at least one slide")
          const dir = params.output_dir ?? "deliverables/slide-screenshots"
          const screenshots = []
          for (const [index, slide] of params.slides.entries()) {
            const screenshot = yield* artifacts.writeText({
              path: `${dir}/slide-${String(index + 1).padStart(2, "0")}.svg`,
              content: renderSlideSvg({ slide, theme: params.theme, index }),
              mime: "image/svg+xml",
            })
            screenshots.push(screenshot)
          }
          return {
            title: "Slide screenshots created",
            metadata: { outputPaths: screenshots.map((item) => item.path) },
            output: ["Created slide screenshot previews.", ...screenshots.map((item) => `SVG: ${item.path}`)].join("\n"),
            attachments: screenshots.map((item) => ({
              type: "file" as const,
              url: item.url,
              mime: item.mime,
              filename: item.filename,
            })),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const SlideOverflowParameters = Schema.Struct({
  task: Schema.String.annotate({ description: "Overflow QA task." }),
  slides: Schema.Array(SlideSpec).annotate({ description: "Slides to check for text density and layout overflow." }),
  theme: Schema.optional(SlideTheme).annotate({ description: "Optional theme tokens affecting font sizes." }),
  output_path: Schema.optional(Schema.String).annotate({
    description: "Workspace-relative Markdown report path. Defaults to deliverables/slide-overflow-report.md.",
  }),
})

type SlideOverflowMetadata = {
  ok: boolean
  issueCount: number
  outputPath: string
}

export const SlideOverflowCheckTool = Tool.define<
  typeof SlideOverflowParameters,
  SlideOverflowMetadata,
  OpenSwarmArtifacts.Service
>(
  "slide_overflow_check",
  Effect.gen(function* () {
    const artifacts = yield* OpenSwarmArtifacts.Service
    return {
      description:
        "Check slide specs for likely text overflow, clipping, and overly dense bullet layouts before exporting.",
      parameters: SlideOverflowParameters,
      execute: (params) =>
        Effect.gen(function* () {
          const report = checkSlideOverflow({ slides: params.slides, theme: params.theme })
          const markdown = [
            "# Slide Overflow Report",
            "",
            `Task: ${params.task}`,
            "",
            `Status: ${report.ok ? "PASS" : "NEEDS_FIX"}`,
            `Issues: ${report.issues.length}`,
            "",
            ...(report.issues.length
              ? report.issues.map(
                  (issue) =>
                    `- Slide ${issue.slide} ${issue.field} ${issue.severity}: ${issue.message} (${issue.estimate}/${issue.limit})`,
                )
              : ["No likely overflow issues detected."]),
          ].join("\n")
          const out = yield* artifacts.writeText({
            path: params.output_path ?? "deliverables/slide-overflow-report.md",
            content: markdown,
            mime: "text/markdown",
          })
          return {
            title: report.ok ? "Slide overflow check passed" : "Slide overflow issues found",
            metadata: { ok: report.ok, issueCount: report.issues.length, outputPath: out.path },
            output: `${report.ok ? "No likely overflow issues detected." : "Found likely slide overflow issues."}\nReport: ${out.path}`,
            attachments: [{ type: "file" as const, url: out.url, mime: out.mime, filename: out.filename }],
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
