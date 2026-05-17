import type { SpeechTranscription } from "@/context/platform"

export type VoiceCaptureMode = "always-on" | "press-to-talk"
export type VoiceTranscriptPhase = "chunk" | "final"

const SUSPICIOUS_SHORT_TRANSCRIPTS = new Set(["yeah", "yep", "yup", "okay", "ok", "kay", "uh huh", "hmm", "mm", "huh"])

const SHORT_SUSPICIOUS_DURATION_MS = 1100
const EXTREMELY_SHORT_DURATION_MS = 650
const LOW_CONFIDENCE = 0.78
const STRONG_CONFIDENCE = 0.9

function normalizedTranscript(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`()[\]{}]+|[\s"'`()[\]{}]+$/g, "")
    .replace(/[.!?…;,:\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function wordCount(value: string) {
  if (!value) return 0
  return value.split(/\s+/).filter(Boolean).length
}

function confidenceIsWeak(confidence: number | undefined) {
  return confidence === undefined || !Number.isFinite(confidence) || confidence < LOW_CONFIDENCE
}

export function shouldAcceptVoiceTranscript(input: {
  transcript: string
  transcription?: SpeechTranscription
  captureMode: VoiceCaptureMode
  phase: VoiceTranscriptPhase
}) {
  const normalized = normalizedTranscript(input.transcript)
  if (!normalized) return false
  if (input.captureMode === "press-to-talk") return true

  const durationMs = input.transcription?.originalDurationMs
  const confidence = input.transcription?.confidence
  const words = wordCount(normalized)

  if (SUSPICIOUS_SHORT_TRANSCRIPTS.has(normalized)) {
    if (confidence !== undefined && confidence >= STRONG_CONFIDENCE && (durationMs === undefined || durationMs >= EXTREMELY_SHORT_DURATION_MS)) {
      return true
    }
    if (durationMs === undefined || durationMs < SHORT_SUSPICIOUS_DURATION_MS) return false
  }

  if (words <= 2 && durationMs !== undefined && durationMs < EXTREMELY_SHORT_DURATION_MS && confidenceIsWeak(confidence)) {
    return false
  }

  return true
}
