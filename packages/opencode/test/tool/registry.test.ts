import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Instance } from "../../src/project/instance"
import * as GeneralChatProfile from "../../src/general-chat/profile"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "assistant",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const seedInstallGuard = (dir: string, locked: string[]) =>
  Effect.promise(async () => {
    await fs.mkdir(path.join(dir, "node_modules"), { recursive: true })
    await Bun.write(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        name: "test-config",
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: Object.fromEntries(locked.map((name) => [name, "1.0.0"])),
          },
        },
      }),
    )
  })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  it.live("loads tools from .opencode/tool (singular)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tool = path.join(opencode, "tool")
        yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
        yield* seedInstallGuard(Global.Path.config, ["@opencode-ai/plugin"])
        yield* seedInstallGuard(opencode, ["@opencode-ai/plugin"])
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tool, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools from .opencode/tools (plural)", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tools = path.join(opencode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* seedInstallGuard(Global.Path.config, ["@opencode-ai/plugin"])
        yield* seedInstallGuard(opencode, ["@opencode-ai/plugin"])
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "hello.ts"),
            [
              "export default {",
              "  description: 'hello tool',",
              "  args: {},",
              "  execute: async () => {",
              "    return 'hello world'",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("hello")
      }),
    ),
  )

  it.live("loads tools with external dependencies without crashing", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const opencode = path.join(dir, ".opencode")
        const tools = path.join(opencode, "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* seedInstallGuard(Global.Path.config, ["@opencode-ai/plugin"])
        yield* Effect.promise(() =>
          Bun.write(
            path.join(opencode, "package.json"),
            JSON.stringify({
              name: "custom-tools",
              dependencies: {
                "@opencode-ai/plugin": "^0.0.0",
                cowsay: "^1.6.0",
              },
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(opencode, "package-lock.json"),
            JSON.stringify({
              name: "custom-tools",
              lockfileVersion: 3,
              packages: {
                "": {
                  dependencies: {
                    "@opencode-ai/plugin": "^0.0.0",
                    cowsay: "^1.6.0",
                  },
                },
              },
            }),
          ),
        )

        const cowsay = path.join(opencode, "node_modules", "cowsay")
        yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "package.json"),
            JSON.stringify({
              name: "cowsay",
              type: "module",
              exports: "./index.js",
            }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(cowsay, "index.js"),
            ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tools, "cowsay.ts"),
            [
              "import { say } from 'cowsay'",
              "export default {",
              "  description: 'tool that imports cowsay at top level',",
              "  args: { text: { type: 'string' } },",
              "  execute: async ({ text }: { text: string }) => {",
              "    return say({ text })",
              "  },",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()
        expect(ids).toContain("cowsay")
      }),
    ),
  )

  it.live("loads and executes shared chat export tools for assistant", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const prevConfig = Global.Path.config
        const prevHome = process.env.OPENCODE_TEST_HOME
        const prevConfigDir = process.env.OPENCODE_CONFIG_DIR
        const prevProjectConfig = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
        const globalConfig = path.join(dir, ".global-config")
        const chatConfig = path.join(globalConfig, "chat")
        const zodModule = path.join(process.cwd(), "node_modules", "zod")

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            ;(Global.Path as { config: string }).config = prevConfig
            if (prevHome === undefined) delete process.env.OPENCODE_TEST_HOME
            else process.env.OPENCODE_TEST_HOME = prevHome
            if (prevConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
            else process.env.OPENCODE_CONFIG_DIR = prevConfigDir
            if (prevProjectConfig === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
            else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = prevProjectConfig
          }),
        )

        ;(Global.Path as { config: string }).config = globalConfig
        process.env.OPENCODE_TEST_HOME = dir
        process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"

        const seedDependencies = (target: string, locked: string[]) =>
          Effect.promise(async () => {
            const nodeModules = path.join(target, "node_modules")
            await fs.mkdir(nodeModules, { recursive: true })
            await Bun.write(
              path.join(target, "package-lock.json"),
              JSON.stringify({
                name: "test-config",
                lockfileVersion: 3,
                packages: {
                  "": {
                    dependencies: Object.fromEntries(locked.map((name) => [name, "1.0.0"])),
                  },
                },
              }),
            )
            await fs.mkdir(path.join(nodeModules, "@opencode-ai", "plugin"), { recursive: true })
            await Bun.write(
              path.join(nodeModules, "@opencode-ai", "plugin", "package.json"),
              JSON.stringify({
                name: "@opencode-ai/plugin",
                type: "module",
                exports: "./index.js",
              }),
            )
            await Bun.write(
              path.join(nodeModules, "@opencode-ai", "plugin", "index.js"),
              [
                'import z from "zod"',
                "export const tool = Object.assign((definition) => definition, { schema: z })",
                "",
              ].join("\n"),
            )
            await fs.mkdir(path.join(nodeModules, "@opencode-ai"), { recursive: true })
            await fs.symlink(zodModule, path.join(nodeModules, "zod"), "dir")

            if (locked.includes("docx")) {
              await fs.mkdir(path.join(nodeModules, "docx"), { recursive: true })
              await Bun.write(
                path.join(nodeModules, "docx", "package.json"),
                JSON.stringify({
                  name: "docx",
                  type: "module",
                  exports: "./index.js",
                }),
              )
              await Bun.write(
                path.join(nodeModules, "docx", "index.js"),
                [
                  'export const HeadingLevel = { HEADING_1: "h1", HEADING_2: "h2", HEADING_3: "h3" }',
                  "export class TextRun { constructor(text) { this.text = text } }",
                  "export class Paragraph { constructor(input) { this.input = input } }",
                  "export class Document { constructor(input) { this.input = input } }",
                  "export const Packer = { toBuffer: async (doc) => Buffer.from(JSON.stringify(doc), 'utf8') }",
                  "",
                ].join("\n"),
              )
            }

            if (locked.includes("pptxgenjs")) {
              await fs.mkdir(path.join(nodeModules, "pptxgenjs"), { recursive: true })
              await Bun.write(
                path.join(nodeModules, "pptxgenjs", "package.json"),
                JSON.stringify({
                  name: "pptxgenjs",
                  type: "module",
                  exports: "./index.js",
                }),
              )
              await Bun.write(
                path.join(nodeModules, "pptxgenjs", "index.js"),
                [
                  'import path from "path"',
                  'import { mkdir, writeFile } from "fs/promises"',
                  "export default class PptxGenJS {",
                  "  constructor() { this.slides = [] }",
                  "  addSlide() {",
                  "    const slide = {",
                  "      addText: (...args) => { this.slides.push(args) },",
                  "    }",
                  "    this.slides.push(slide)",
                  "    return slide",
                  "  }",
                  "  async writeFile({ fileName }) {",
                  "    await mkdir(path.dirname(fileName), { recursive: true })",
                  "    await writeFile(fileName, JSON.stringify({ title: this.title, slides: this.slides }), 'utf8')",
                  "  }",
                  "}",
                  "",
                ].join("\n"),
              )
            }
          })

        yield* seedDependencies(globalConfig, ["@opencode-ai/plugin"])
        yield* Effect.promise(() =>
          Effect.runPromise(GeneralChatProfile.ensure().pipe(Effect.provide(AppFileSystem.defaultLayer))),
        )
        yield* seedDependencies(chatConfig, ["@opencode-ai/plugin", "docx", "pptxgenjs"])
        process.env.OPENCODE_CONFIG_DIR = chatConfig

        const registry = yield* ToolRegistry.Service
        const tools = yield* registry.tools({
          providerID: "opencode" as any,
          modelID: "gpt-5" as any,
          agent: {
            name: "assistant",
            mode: "primary",
            permission: [],
            options: {
              extend_provider_prompt: true,
            },
          },
        })
        const documentTool = tools.find((tool) => tool.id === "documents_create_docx")
        const presentationTool = tools.find((tool) => tool.id === "presentations_create_pptx")
        if (!documentTool || !presentationTool) throw new Error("shared chat export tools not found")

        const ctx: Tool.Context = {
          ...baseCtx,
          ask: () => Effect.void,
        }

        const docxResult = yield* documentTool.execute(
          {
            output_path: "deliverables/launch-plan.docx",
            source_path: "deliverables/launch-plan.md",
            markdown: "# Launch Plan\n\nShip the export flow.\n\n- Verify loading\n- Verify output",
          },
          ctx,
        )
        const pptxResult = yield* presentationTool.execute(
          {
            output_path: "deliverables/launch-plan.pptx",
            source_path: "deliverables/launch-plan-deck.json",
            title: "Launch Plan",
            slides: [
              {
                title: "Summary",
                body: "Export tools are loaded through the shared chat profile.",
                bullets: ["Create source files", "Create exported artifacts"],
              },
            ],
          },
          ctx,
        )

        expect(yield* Effect.promise(() => Bun.file(path.join(dir, "deliverables", "launch-plan.md")).text())).toContain(
          "Launch Plan",
        )
        expect(yield* Effect.promise(() => Bun.file(path.join(dir, "deliverables", "launch-plan.docx")).exists())).toBe(
          true,
        )
        expect(
          yield* Effect.promise(() => Bun.file(path.join(dir, "deliverables", "launch-plan-deck.json")).text()),
        ).toContain("Summary")
        expect(yield* Effect.promise(() => Bun.file(path.join(dir, "deliverables", "launch-plan.pptx")).exists())).toBe(
          true,
        )
        expect(docxResult.output).toContain("Created Word document.")
        expect(pptxResult.output).toContain("Created PowerPoint presentation.")
      }),
    ),
  )
})
