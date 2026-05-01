import { describe, expect, test } from "bun:test"
import { adoptSpeechCaptureSession } from "./voice-capture-session"

describe("voice capture session adoption", () => {
  test("only keeps native desktop capture sessions", () => {
    expect(adoptSpeechCaptureSession()).toBeUndefined()
    expect(adoptSpeechCaptureSession({ id: "renderer", source: "renderer" })).toBeUndefined()
    expect(adoptSpeechCaptureSession({ id: "native", source: "native" })).toEqual({
      id: "native",
      source: "native",
    })
  })
})
