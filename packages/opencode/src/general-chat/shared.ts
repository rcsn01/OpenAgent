import path from "path"
import { mkdir } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export const draftDirectoryToken = "__opencode_general_chat_draft__"
export const chatsRoot = path.join(Global.Path.data, "chats")
export const draftDirectory = path.join(chatsRoot, "__draft__")

export function isGeneralChatDirectory(input: string) {
  const directory = AppFileSystem.resolve(input)
  const draft = AppFileSystem.resolve(draftDirectory)
  const root = AppFileSystem.resolve(chatsRoot)
  return directory === draft || AppFileSystem.contains(root, directory)
}

export async function resolveGeneralChatDirectory(input: string) {
  if (input !== draftDirectoryToken) return input
  await mkdir(draftDirectory, { recursive: true })
  return draftDirectory
}
