import { describe, expect, test } from "bun:test"
import {
  appendSpeechCaptureSamples,
  beginSpeechCaptureChunk,
  beginSpeechCaptureTurn,
  createSpeechCaptureSessionState,
  SPEECH_CAPTURE_SAMPLE_RATE,
  takeSpeechCaptureChunk,
  takeSpeechCaptureTurn,
} from "./speech-capture"

const constantSamples = (durationMs: number, sampleRate: number, value: number) =>
  new Float32Array(Math.round((sampleRate * durationMs) / 1000)).fill(value)

describe("speech capture", () => {
  test("uses the latest preroll when a chunk begins", () => {
    const state = createSpeechCaptureSessionState()
    appendSpeechCaptureSamples(state, constantSamples(150, 48000, 0.25), 48000)
    appendSpeechCaptureSamples(state, constantSamples(200, 48000, 0.75), 48000)
    beginSpeechCaptureChunk(state)

    const chunk = takeSpeechCaptureChunk(state)
    expect(chunk?.originalDurationMs).toBe(250)
    expect(chunk?.audio.byteLength).toBe(44 + SPEECH_CAPTURE_SAMPLE_RATE * 2)
  })

  test("pads short chunks to the minimum speech duration", () => {
    const state = createSpeechCaptureSessionState()
    appendSpeechCaptureSamples(state, constantSamples(300, 48000, 0.5), 48000)
    beginSpeechCaptureChunk(state)
    appendSpeechCaptureSamples(state, constantSamples(200, 48000, 0.5), 48000)

    const chunk = takeSpeechCaptureChunk(state)
    expect(chunk?.originalDurationMs).toBe(450)
    expect(chunk?.audio.byteLength).toBe(44 + SPEECH_CAPTURE_SAMPLE_RATE * 2)
  })

  test("keeps a full turn across multiple chunk transcriptions", () => {
    const state = createSpeechCaptureSessionState()
    appendSpeechCaptureSamples(state, constantSamples(150, 48000, 0.25), 48000)
    beginSpeechCaptureTurn(state)
    beginSpeechCaptureChunk(state)
    appendSpeechCaptureSamples(state, constantSamples(300, 48000, 0.5), 48000)
    expect(takeSpeechCaptureChunk(state)?.originalDurationMs).toBe(450)

    beginSpeechCaptureChunk(state)
    appendSpeechCaptureSamples(state, constantSamples(500, 48000, 0.75), 48000)
    expect(takeSpeechCaptureChunk(state)?.originalDurationMs).toBe(750)

    const turn = takeSpeechCaptureTurn(state)
    expect(turn?.originalDurationMs).toBe(950)
    expect(turn?.audio.byteLength).toBe(44 + SPEECH_CAPTURE_SAMPLE_RATE * 2)
  })

  test("drops clips that are still too short before padding", () => {
    const state = createSpeechCaptureSessionState()
    appendSpeechCaptureSamples(state, constantSamples(100, 48000, 0.5), 48000)
    beginSpeechCaptureChunk(state)
    appendSpeechCaptureSamples(state, constantSamples(50, 48000, 0.5), 48000)

    expect(takeSpeechCaptureChunk(state)).toBeUndefined()
  })
})
