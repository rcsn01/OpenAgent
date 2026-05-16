import { describe, expect, test } from "bun:test"
import { computeVoiceEndpointHoldMs, shouldAutoSubmitVoiceTurn } from "./voice-endpoint"

describe("voice endpoint", () => {
  test("waits longer for filler endings", () => {
    const normal = computeVoiceEndpointHoldMs({
      transcript: "please open the file",
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    const filler = computeVoiceEndpointHoldMs({
      transcript: "please open the file ummm",
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    expect(filler).toBeGreaterThan(normal)
  })

  test("waits longer when ASR adds punctuation mid-thought", () => {
    const unpunctuated = computeVoiceEndpointHoldMs({
      transcript: "look at Andre Karpathy's auto research",
      baseSilenceMs: 1600,
      maxSilenceMs: 4200,
    })
    const punctuated = computeVoiceEndpointHoldMs({
      transcript: "look at Andre Karpathy's auto research.",
      baseSilenceMs: 1600,
      maxSilenceMs: 4200,
    })
    expect(punctuated).toBeGreaterThan(unpunctuated)
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "look at Andre Karpathy's auto research.",
        settledMs: 2500,
        baseSilenceMs: 1600,
        maxSilenceMs: 4200,
      }),
    ).toBe(false)
  })

  test("explicit completion phrases submit faster than connectors", () => {
    const complete = computeVoiceEndpointHoldMs({
      transcript: "please open the file done",
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    const connector = computeVoiceEndpointHoldMs({
      transcript: "please open the file and",
      baseSilenceMs: 650,
      maxSilenceMs: 3200,
    })
    expect(complete).toBeLessThanOrEqual(connector)
  })

  test("requires the endpoint to stay settled long enough", () => {
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        settledMs: 100,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        settledMs: 1700,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs",
        settledMs: 2000,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(true)
  })

  test("waits through a short mid-sentence pause", () => {
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs and",
        settledMs: 1000,
        baseSilenceMs: 650,
        maxSilenceMs: 3200,
      }),
    ).toBe(false)
  })

  test("max silence caps the hold time without bypassing the settled timer", () => {
    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs um",
        settledMs: 500,
        baseSilenceMs: 650,
        maxSilenceMs: 1800,
      }),
    ).toBe(false)

    expect(
      shouldAutoSubmitVoiceTurn({
        transcript: "open the docs um",
        settledMs: 1800,
        baseSilenceMs: 650,
        maxSilenceMs: 1800,
      }),
    ).toBe(true)
  })
})
