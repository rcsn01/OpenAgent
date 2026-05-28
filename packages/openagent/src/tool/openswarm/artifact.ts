import path from "path"
import { Effect, Context, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@openagent-ai/core/filesystem"

export type Artifact = {
  path: string
  url: string
  mime: string
  filename: string
}

export interface Interface {
  readonly resolve: (input: string) => Effect.Effect<string>
  readonly writeText: (input: { path: string; content: string; mime?: string }) => Effect.Effect<Artifact>
  readonly writeBytes: (input: { path: string; content: Uint8Array | Buffer; mime?: string }) => Effect.Effect<Artifact>
}

export class Service extends Context.Service<Service, Interface>()("@openagent/OpenSwarmArtifacts") {}

function fileUrl(filepath: string) {
  return `file://${filepath}`
}

function filename(filepath: string) {
  return path.basename(filepath)
}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const resolve = Effect.fn("OpenSwarmArtifacts.resolve")(function* (input: string) {
      const ctx = yield* InstanceState.context
      const clean = input.trim() || "deliverables/artifact.txt"
      if (clean.includes("\0")) throw new Error("Artifact path cannot contain NUL bytes")
      const target = path.isAbsolute(clean) ? clean : path.join(ctx.directory, clean)
      const rel = path.relative(ctx.directory, target)
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Artifact path must stay inside the workspace: ${input}`)
      }
      return target
    })

    const writeText = Effect.fn("OpenSwarmArtifacts.writeText")(function* (input: {
      path: string
      content: string
      mime?: string
    }) {
      const target = yield* resolve(input.path)
      yield* fs.ensureDir(path.dirname(target)).pipe(Effect.orDie)
      yield* fs.writeWithDirs(target, input.content).pipe(Effect.orDie)
      return {
        path: target,
        url: fileUrl(target),
        mime: input.mime ?? "text/plain",
        filename: filename(target),
      }
    })

    const writeBytes = Effect.fn("OpenSwarmArtifacts.writeBytes")(function* (input: {
      path: string
      content: Uint8Array | Buffer
      mime?: string
    }) {
      const target = yield* resolve(input.path)
      yield* fs.ensureDir(path.dirname(target)).pipe(Effect.orDie)
      yield* fs.writeWithDirs(target, input.content).pipe(Effect.orDie)
      return {
        path: target,
        url: fileUrl(target),
        mime: input.mime ?? "application/octet-stream",
        filename: filename(target),
      }
    })

    return Service.of({ resolve, writeText, writeBytes })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as OpenSwarmArtifacts from "./artifact"
