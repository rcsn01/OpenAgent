import { describe, expect, test } from "bun:test"
import { applyVoiceTranscript } from "./voice-prompt"

describe("voice prompt", () => {
  test("appends transcript to trailing text", () => {
    expect(
      applyVoiceTranscript([{ type: "text", content: "Hello", start: 0, end: 5 }], "world"),
    ).toEqual([{ type: "text", content: "Hello world", start: 0, end: 11 }])
  })

  test("preserves non-text parts and images", () => {
    const prompt = [
      { type: "file" as const, path: "/tmp/demo.ts", content: "@/tmp/demo.ts", start: 0, end: 13 },
      { type: "image" as const, id: "image-1", filename: "demo.png", mime: "image/png", dataUrl: "data:image/png,1" },
    ]
    expect(applyVoiceTranscript(prompt, "summarize this")).toEqual([
      { type: "file", path: "/tmp/demo.ts", content: "@/tmp/demo.ts", start: 0, end: 13 },
      { type: "text", content: "summarize this", start: 13, end: 27 },
      { type: "image", id: "image-1", filename: "demo.png", mime: "image/png", dataUrl: "data:image/png,1" },
    ])
  })
})

