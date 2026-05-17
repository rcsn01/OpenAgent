import { describe, expect, test } from "bun:test"
import { shouldAcceptVoiceTranscript } from "./voice-transcript-filter"

describe("voice transcript filter", () => {
  test("rejects short suspicious acknowledgements in always-on mode", () => {
    for (const transcript of ["yeah", "okay.", "ok", "hmm"]) {
      expect(
        shouldAcceptVoiceTranscript({
          transcript,
          transcription: { text: transcript, originalDurationMs: 500 },
          captureMode: "always-on",
          phase: "chunk",
        }),
      ).toBe(false)
    }
  })

  test("allows short suspicious acknowledgements in press-to-talk mode", () => {
    expect(
      shouldAcceptVoiceTranscript({
        transcript: "okay",
        transcription: { text: "okay", originalDurationMs: 350 },
        captureMode: "press-to-talk",
        phase: "final",
      }),
    ).toBe(true)
  })

  test("allows non-suspicious short commands", () => {
    for (const transcript of ["stop", "continue", "cancel", "send", "yes", "no"]) {
      expect(
        shouldAcceptVoiceTranscript({
          transcript,
          transcription: { text: transcript, originalDurationMs: 800 },
          captureMode: "always-on",
          phase: "final",
        }),
      ).toBe(true)
    }
  })

  test("allows suspicious acknowledgements when duration or confidence supports real speech", () => {
    expect(
      shouldAcceptVoiceTranscript({
        transcript: "yeah",
        transcription: { text: "yeah", originalDurationMs: 1400 },
        captureMode: "always-on",
        phase: "final",
      }),
    ).toBe(true)
    expect(
      shouldAcceptVoiceTranscript({
        transcript: "okay",
        transcription: { text: "okay", originalDurationMs: 700, confidence: 0.95 },
        captureMode: "always-on",
        phase: "chunk",
      }),
    ).toBe(true)
  })

  test("rejects extremely short low-confidence one or two word transcripts", () => {
    expect(
      shouldAcceptVoiceTranscript({
        transcript: "open file",
        transcription: { text: "open file", originalDurationMs: 400, confidence: 0.5 },
        captureMode: "always-on",
        phase: "chunk",
      }),
    ).toBe(false)
  })

  test("rejects empty or punctuation-only transcripts", () => {
    for (const transcript of ["", "   ", "...", "?!"]) {
      expect(
        shouldAcceptVoiceTranscript({
          transcript,
          transcription: { text: transcript, originalDurationMs: 900 },
          captureMode: "always-on",
          phase: "chunk",
        }),
      ).toBe(false)
    }
  })
})
