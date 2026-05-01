import { describe, expect, test } from "bun:test"
import { computeVoiceEndpointHoldMs, shouldAutoSubmitVoiceTurn } from "./voice-endpoint"

describe("voice endpoint", () => {
  test("waits longer for filler endings", () => {
    const normal = computeVoiceEndpointHoldMs({
      transcript: "please open the file",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    const filler = computeVoiceEndpointHoldMs({
      transcript: "please open the file ummm",
      transcriptStableMs: 500,
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    expect(filler).toBeGreaterThan(normal)
  })

  test("submits faster for clearly complete utterances", () => {
    const complete = computeVoiceEndpointHoldMs({
      transcript: "please open the file.",
      transcriptStableMs: 900,
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    const connector = computeVoiceEndpointHoldMs({
      transcript: "please open the file and",
      transcriptStableMs: 900,
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
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
        maxSilenceMs: 3200,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        silenceMs: 1700,
        transcriptStableMs: 500,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        silenceMs: 1800,
        transcriptStableMs: 900,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(true)
  })

  test("waits through a short mid-sentence pause", () => {
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs and",
        silenceMs: 1000,
        transcriptStableMs: 650,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(false)
  })
})
