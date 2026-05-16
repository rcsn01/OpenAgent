import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitSpeechCaptureSamples } from "./speech-capture-native"

const INTERNAL_SPEECH_THRESHOLD = 0.013

function findInternalSpeechAsset() {
  const base = join(process.cwd(), "..", "..", "node_modules", ".bun")
  const match = readdirSync(base).find((entry) => entry.startsWith("@ai-sdk+openai@"))
  if (!match) throw new Error("Unable to find the bundled OpenAI transcription test asset")
  return join(base, match, "node_modules", "@ai-sdk", "openai", "src", "transcription", "transcription-test.mp3")
}

function renderQuietSpeechFixture(volume: number) {
  const directory = mkdtempSync(join(tmpdir(), "opencode-speech-macos-test-"))
  const output = join(directory, `fixture-${String(volume).replaceAll(".", "p")}.wav`)
  execFileSync("ffmpeg", ["-y", "-i", findInternalSpeechAsset(), "-af", `volume=${volume}`, "-ac", "1", "-ar", "16000", output], {
    stdio: "ignore",
  })
  return {
    output,
    dispose() {
      rmSync(directory, { force: true, recursive: true })
    },
  }
}

function readWavFrames(path: string, frameSize = 2048) {
  const file = readFileSync(path)
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  let dataOffset = 12
  let dataSize = 0
  while (dataOffset + 8 <= file.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(dataOffset),
      view.getUint8(dataOffset + 1),
      view.getUint8(dataOffset + 2),
      view.getUint8(dataOffset + 3),
    )
    const chunkSize = view.getUint32(dataOffset + 4, true)
    if (chunkId === "data") {
      dataOffset += 8
      dataSize = chunkSize
      break
    }
    dataOffset += 8 + chunkSize + (chunkSize % 2)
  }
  if (!dataSize) throw new Error(`Missing PCM data chunk in ${path}`)

  const samples = new Float32Array(dataSize / 2)
  for (let index = dataOffset, sample = 0; index + 1 < dataOffset + dataSize; index += 2, sample += 1) {
    samples[sample] = view.getInt16(index, true) / 0x8000
  }

  const frames: Float32Array[] = []
  for (let index = 0; index < samples.length; index += frameSize) {
    frames.push(samples.slice(index, index + frameSize))
  }
  return frames
}

function maxEmittedRms(frames: Float32Array[], gain: number) {
  let maxRms = 0
  for (const frame of frames) {
    emitSpeechCaptureSamples(
      {
        gain,
        onLevel(level) {
          if (level.rms > maxRms) maxRms = level.rms
        },
        onSamples() {},
      },
      frame,
      16000,
    )
  }
  return maxRms
}

describe("native speech capture gain", () => {
  test("boosts quiet internal speech above the live detection floor", () => {
    const fixture = renderQuietSpeechFixture(0.04)
    try {
      const frames = readWavFrames(fixture.output)
      const raw = maxEmittedRms(frames, 1)
      const boosted = maxEmittedRms(frames, 3.5)

      expect(raw).toBeLessThan(INTERNAL_SPEECH_THRESHOLD)
      expect(boosted).toBeGreaterThan(INTERNAL_SPEECH_THRESHOLD)
    } finally {
      fixture.dispose()
    }
  })
})
