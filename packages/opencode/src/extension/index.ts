import { existsSync } from "fs"
import fs from "fs/promises"
import matter from "gray-matter"
import path from "path"
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Context, Effect, Layer, Schema } from "effect"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { ConfigExtension } from "@/config/extension"
import { ConfigMCP } from "@/config/mcp"
import { FileWatcher } from "@/file/watcher"
import { MCP } from "@/mcp"
import { InstanceState } from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { Skill } from "@/skill"
import { Filesystem } from "@/util/filesystem"
import { InstanceBootstrap } from "@/project/bootstrap"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "extension" })
const RELOAD_DEBOUNCE_MS = 150

const ExtensionTool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
})

const ExtensionServer = Schema.Struct({
  key: Schema.String,
  status: MCP.Status,
  tools: Schema.Array(ExtensionTool),
})

const ExtensionSkillFile = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})
export type ExtensionSkillFile = Schema.Schema.Type<typeof ExtensionSkillFile>

export const ExtensionBundle = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mcp: Schema.Record(Schema.String, ConfigMCP.Info),
  skills: Schema.mutable(Schema.Array(ExtensionSkillFile)),
})
export type ExtensionBundle = Schema.Schema.Type<typeof ExtensionBundle>

const ExtensionListItem = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  installed: Schema.Boolean,
  active: Schema.Boolean,
  installed_at: Schema.Number,
  config_path: Schema.String,
  skill_roots: Schema.mutable(Schema.Array(Schema.String)),
  servers: Schema.Array(ExtensionServer),
  skills: Schema.Array(Skill.Info),
})
export type ExtensionListItem = Schema.Schema.Type<typeof ExtensionListItem>

export const ExtensionList = Schema.Struct({
  extensions: Schema.Array(ExtensionListItem),
})
export type ExtensionList = Schema.Schema.Type<typeof ExtensionList>

function localRoot(directory: string, worktree: string) {
  return worktree !== "/" ? worktree : directory
}

function managedSkillRoot(root: string, extensionID: string) {
  return path.join(root, ".opencode", "skills", "extensions", extensionID)
}

function resolveManagedPath(root: string, value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value)
}

function relativeToRoot(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative || path.basename(target)
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function normalizeSkillPath(file: ExtensionSkillFile) {
  if (path.isAbsolute(file.path)) {
    throw new Error(`Extension skill path must be relative: ${file.path}`)
  }

  const normalized = path.posix.normalize(file.path)
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Invalid extension skill path: ${file.path}`)
  }

  return normalized
}

async function validateBundle(bundle: ExtensionBundle) {
  const names = new Set<string>()
  let foundSkill = false

  for (const file of bundle.skills) {
    const normalized = normalizeSkillPath(file)
    if (path.posix.basename(normalized) !== "SKILL.md") continue
    foundSkill = true

    const parsed = matter(file.content)
    const name = typeof parsed.data.name === "string" ? parsed.data.name.trim() : ""
    const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : ""
    if (!name || !description) {
      throw new Error(`Skill ${file.path} must include name and description frontmatter`)
    }
    if (!name.startsWith(`${bundle.id}:`)) {
      throw new Error(`Skill ${file.path} must use the ${bundle.id}: prefix`)
    }
    if (names.has(name)) {
      throw new Error(`Duplicate skill name ${name}`)
    }
    names.add(name)
  }

  if (!foundSkill) {
    throw new Error("Extension bundle must include at least one SKILL.md")
  }
}

async function readConfigText(file: string) {
  const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
  return text.trim() ? text : "{}"
}

function parseConfigText(file: string, text: string) {
  const errors: ParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (!errors.length) return data as Record<string, unknown>

  const error = errors[0]
  const lines = text.slice(0, error.offset).split("\n")
  throw new Error(
    `Invalid JSON in ${file} (${printParseErrorCode(error.error)} at line ${lines.length}, column ${lines.at(-1)?.length ?? 0})`,
  )
}

function patchJsonc(text: string, patch: unknown, keys: string[] = []): string {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return applyEdits(
      text,
      modify(text, keys, patch, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      }),
    )
  }

  return Object.entries(patch).reduce((acc, [key, value]) => patchJsonc(acc, value, [...keys, key]), text)
}

async function writeConfigDocument(
  file: string,
  update: (data: Record<string, unknown>) => Record<string, unknown>,
  patchKeys: string[],
) {
  const before = await readConfigText(file)
  const current = parseConfigText(file, before)
  const next = update(current)

  await fs.mkdir(path.dirname(file), { recursive: true })

  if (!file.endsWith(".jsonc")) {
    await fs.writeFile(file, JSON.stringify(next, null, 2))
    return
  }

  const patch = Object.fromEntries(patchKeys.map((key) => [key, next[key]]))
  await fs.writeFile(file, patchJsonc(before, patch))
}

async function removeOwnedConfig(file: string, extensionID: string, mcpServers: string[]) {
  await writeConfigDocument(
    file,
    (data) => {
      const mcp = asRecord(data.mcp)
      for (const key of mcpServers) delete mcp[key]

      const extensions = asRecord(data.extensions)
      const installed = Array.isArray(extensions.installed)
        ? extensions.installed.filter((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false
            return (item as Record<string, unknown>).id !== extensionID
          })
        : []

      return {
        ...data,
        ...(Object.keys(mcp).length ? { mcp } : { mcp: undefined }),
        ...(installed.length ? { extensions: { ...extensions, installed } } : { extensions: undefined }),
      }
    },
    ["mcp", "extensions"],
  )
}

async function selectConfigFile(input: { directory: string; worktree: string }) {
  const root = localRoot(input.directory, input.worktree)
  const existing = await Filesystem.findUp(["opencode.jsonc", "opencode.json"], input.directory, root)
  const file = existing[0] ?? path.join(root, ".opencode", "opencode.json")
  return { file, root }
}

async function writeManagedSkills(root: string, bundle: ExtensionBundle) {
  const target = managedSkillRoot(root, bundle.id)
  await fs.rm(target, { recursive: true, force: true })

  for (const file of bundle.skills) {
    const relativePath = normalizeSkillPath(file)
    const full = path.join(target, relativePath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, file.content, "utf8")
  }

  return target
}

function resolveInstalled(root: string, entry: ConfigExtension.Installed) {
  return {
    ...entry,
    config_path: resolveManagedPath(root, entry.config_path),
    skill_roots: entry.skill_roots.map((item) => resolveManagedPath(root, item)),
  }
}

export interface Interface {
  readonly list: () => Effect.Effect<ExtensionList>
  readonly install: (bundle: ExtensionBundle) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Extension") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const cfg = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const state = yield* InstanceState.make(
      Effect.fn("Extension.state")(function* () {
        const entries = (yield* cfg.get()).extensions?.installed ?? []
        if (!entries.length) return

        const ctx = yield* InstanceState.context
        const root = localRoot(ctx.directory, ctx.worktree)
        const roots = entries.flatMap((entry) => resolveInstalled(root, entry).skill_roots).filter((item) => existsSync(item))
        if (!roots.length) return

        let timer: ReturnType<typeof setTimeout> | undefined
        let reloading = false

        const off = yield* bus.subscribeCallback(FileWatcher.Event.Updated, (event) => {
          if (!roots.some((root) => Filesystem.contains(root, event.properties.file))) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            if (reloading) return
            reloading = true
            log.info("reloading instance for managed extension skill change", { file: event.properties.file })
            void Instance.reload({
              directory: ctx.directory,
              worktree: ctx.worktree,
              project: ctx.project,
              init: () =>
                import("@/effect/bootstrap-runtime").then(({ BootstrapRuntime }) =>
                  BootstrapRuntime.runPromise(InstanceBootstrap),
                ),
            }).finally(() => {
              reloading = false
            })
          }, RELOAD_DEBOUNCE_MS)
        })

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (timer) clearTimeout(timer)
            off()
          }),
        )
      }),
    )

    const list = Effect.fn("Extension.list")(function* () {
      const [config, status, definitions, skills, ctx] = yield* Effect.all(
        [cfg.get(), mcp.status(), mcp.definitions(), skill.all(), InstanceState.context],
        { concurrency: 5 },
      )
      const root = localRoot(ctx.directory, ctx.worktree)

      return {
        extensions: (config.extensions?.installed ?? []).map((entry) => {
          const resolved = resolveInstalled(root, entry)
          return {
            id: entry.id,
            version: entry.version,
            name: entry.name,
            description: entry.description,
            installed: true,
            active: entry.mcp_servers.every((key) => !!status[key]),
            installed_at: entry.installed_at,
            config_path: resolved.config_path,
            skill_roots: resolved.skill_roots,
            servers: entry.mcp_servers.map((key) => ({
              key,
              status: status[key] ?? { status: "disabled" as const },
              tools: (definitions[key] ?? []).map((tool) => ({
                name: tool.name,
                description: tool.description || undefined,
              })),
            })),
            skills: skills.filter((item) => resolved.skill_roots.some((root) => Filesystem.contains(root, item.location))),
          }
        }),
      } satisfies ExtensionList
    })

    const install = Effect.fn("Extension.install")(function* (bundle: ExtensionBundle) {
      yield* Effect.promise(() => validateBundle(bundle))

      const current = yield* cfg.get()
      const ctx = yield* InstanceState.context
      const { file, root } = yield* Effect.promise(() => selectConfigFile({ directory: ctx.directory, worktree: ctx.worktree }))
      const existing = current.extensions?.installed?.find((item) => item.id === bundle.id)

      if (existing) {
        const resolved = resolveInstalled(root, existing)
        yield* Effect.promise(() => removeOwnedConfig(resolved.config_path, existing.id, existing.mcp_servers))
        yield* Effect.forEach(resolved.skill_roots, (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })), {
          concurrency: "unbounded",
          discard: true,
        })
      }

      const skillsRoot = yield* Effect.promise(() => writeManagedSkills(root, bundle))
      const metadata: ConfigExtension.Installed = {
        id: bundle.id,
        version: bundle.version,
        name: bundle.name,
        description: bundle.description,
        installed_at: Date.now(),
        config_path: relativeToRoot(root, file),
        mcp_servers: Object.keys(bundle.mcp),
        skill_roots: [relativeToRoot(root, skillsRoot)],
      }

      const extensions = (current.extensions?.installed ?? []).filter((item) => item.id !== bundle.id)
      const installed = [...extensions, metadata].sort((a, b) => a.id.localeCompare(b.id))

      yield* Effect.promise(() =>
        writeConfigDocument(
          file,
          (data) => {
            const mcpConfig = asRecord(data.mcp)
            for (const [key, value] of Object.entries(bundle.mcp)) {
              mcpConfig[key] = value
            }

            return {
              ...data,
              mcp: mcpConfig,
              extensions: {
                ...asRecord(data.extensions),
                installed,
              },
            }
          },
          ["mcp", "extensions"],
        ),
      )

      yield* cfg.invalidate(true)
    })

    const remove = Effect.fn("Extension.remove")(function* (id: string) {
      const current = yield* cfg.get()
      const entry = current.extensions?.installed?.find((item) => item.id === id)
      if (!entry) throw new Error(`Extension ${id} is not installed`)

      const ctx = yield* InstanceState.context
      const root = localRoot(ctx.directory, ctx.worktree)
      const resolved = resolveInstalled(root, entry)

      yield* Effect.promise(() => removeOwnedConfig(resolved.config_path, entry.id, entry.mcp_servers))
      yield* Effect.forEach(resolved.skill_roots, (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })), {
        concurrency: "unbounded",
        discard: true,
      })
      yield* cfg.invalidate(true)
    })

    const init = Effect.fn("Extension.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ list, install, remove, init })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Bus.defaultLayer),
)

export * as Extension from "."
