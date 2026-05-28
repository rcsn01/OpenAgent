import { test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { AppFileSystem } from "@openagent-ai/core/filesystem"
import { Global } from "@openagent-ai/core/global"
import * as GeneralChatProfile from "../../src/general-chat/profile"
import { tmpdir } from "../fixture/fixture"

const ensure = () => Effect.runPromise(GeneralChatProfile.ensure().pipe(Effect.provide(AppFileSystem.defaultLayer)))

test("shared chat profile seeds default files when missing", async () => {
  await using tmp = await tmpdir()
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path

  try {
    const dir = await ensure()
    expect(dir).toBe(path.join(tmp.path, "chat"))
    expect(await Bun.file(path.join(dir, "AGENTS.md")).text()).toContain("chat-documents")
    expect(await Bun.file(path.join(dir, "AGENTS.md")).text()).toContain("chat-word-documents")
    expect(await Bun.file(path.join(dir, "skills", "chat-presentations", "SKILL.md")).text()).toContain(
      "slide-spec JSON",
    )
    expect(await Bun.file(path.join(dir, "skills", "chat-word-documents", "SKILL.md")).text()).toContain(
      "documents_create_docx",
    )
    expect(await Bun.file(path.join(dir, "skills", "chat-powerpoint-presentations", "SKILL.md")).text()).toContain(
      "presentations_create_pptx",
    )
    expect(await Bun.file(path.join(dir, ".openagent-chat-profile.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "tools", "documents.ts")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "tools", "presentations.ts")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "package.json")).text()).toContain("\"docx\"")
  } finally {
    ;(Global.Path as { config: string }).config = prev
  }
})

test("shared chat profile does not modify user-managed chat directories", async () => {
  await using tmp = await tmpdir()
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path

  try {
    const dir = path.join(tmp.path, "chat")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, "AGENTS.md"), "# My Custom Chat Profile")
    await ensure()
    expect(await Bun.file(path.join(dir, "AGENTS.md")).text()).toBe("# My Custom Chat Profile")
    expect(await Bun.file(path.join(dir, "skills", "chat-documents", "SKILL.md")).exists()).toBe(false)
  } finally {
    ;(Global.Path as { config: string }).config = prev
  }
})

test("shared chat profile repairs managed directories without overwriting existing files", async () => {
  await using tmp = await tmpdir()
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = tmp.path

  try {
    const dir = path.join(tmp.path, "chat")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, ".openagent-chat-profile.json"), JSON.stringify({ managed: true, version: 2 }))
    await Bun.write(path.join(dir, "AGENTS.md"), "# Customized Managed Chat Profile")
    await fs.mkdir(path.join(dir, "tools"), { recursive: true })
    await Bun.write(path.join(dir, "tools", "documents.ts"), "export default {}")
    await Bun.write(path.join(dir, "package.json"), "{}")
    await ensure()
    expect(await Bun.file(path.join(dir, "AGENTS.md")).text()).toBe("# Customized Managed Chat Profile")
    expect(await Bun.file(path.join(dir, "skills", "chat-documents", "SKILL.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "skills", "chat-word-documents", "SKILL.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "tools", "documents.ts")).text()).toBe("export default {}")
    expect(await Bun.file(path.join(dir, "tools", "presentations.ts")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir, "package.json")).text()).toBe("{}")
  } finally {
    ;(Global.Path as { config: string }).config = prev
  }
})
