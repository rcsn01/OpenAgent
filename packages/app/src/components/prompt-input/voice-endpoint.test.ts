import { describe, expect, test } from "bun:test"
import { computeVoiceEndpointHoldMs, shouldAutoSubmitVoiceTurn } from "./voice-endpoint"

describe("voice endpoint", () => {
  test("waits longer for filler endings", () => {
    const normal = computeVoiceEndpointHoldMs({
      transcript: "please open the file",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 1800,
    })
    const filler = computeVoiceEndpointHoldMs({
      transcript: "please open the file ummm",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 1800,
    })
    expect(filler).toBeGreaterThan(normal)
  })

  test("submits faster for clearly complete utterances", () => {
    const complete = computeVoiceEndpointHoldMs({
      transcript: "please open the file.",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 1800,
    })
    const connector = computeVoiceEndpointHoldMs({
      transcript: "please open the file and",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 1800,
    })
    expect(complete).toBeLessThan(connector)
  })

  test("requires both stable transcript and enough silence", () => {
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        silenceMs: 800,
        transcriptStableMs: 100,
        baseSilenceMs: 650,
        maxSilenceMs: 1800,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        silenceMs: 800,
        transcriptStableMs: 400,
        baseSilenceMs: 650,
        maxSilenceMs: 1800,
      }),
    ).toBe(true)
  })
})

