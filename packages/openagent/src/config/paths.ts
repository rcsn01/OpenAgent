export * as ConfigPaths from "./paths"

import path from "path"
import * as GeneralChatProfile from "@/general-chat/profile"
import { isGeneralChatDirectory } from "@/general-chat/shared"
import { Flag } from "@openagent-ai/core/flag/flag"
import { Global } from "@openagent-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { AppFileSystem } from "@openagent-ai/core/filesystem"

export function chatDirectory() {
  return path.join(Flag.OPENAGENT_CONFIG_DIR ?? Global.Path.config, "chat")
}

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* AppFileSystem.Service
  const chat = chatDirectory()
  if (isGeneralChatDirectory(directory)) yield* GeneralChatProfile.ensureWith(afs)
  return unique([
    Global.Path.config,
    ...(isGeneralChatDirectory(directory) && (yield* afs.isDir(chat)) ? [chat] : []),
    ...(!Flag.OPENAGENT_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".openagent"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".openagent"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENAGENT_CONFIG_DIR ? [Flag.OPENAGENT_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
