function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const fillerPattern = /\b(?:uh|uhh+|um|umm+|er|err+|ah|ahh+|hmm+|mm+)\s*[.?!…]*$/i
const connectorPattern = /\b(?:and|but|so|because|or|if|then|well)\s*[.?!…]*$/i
const completePattern = /(?:[.!?]["')\]]?\s*$|\b(?:done|finished|that's it|that is it|thank you|thanks)\s*$)/i
const MIN_TRANSCRIPT_STABLE_MS = 700
const MIN_AUTO_SUBMIT_SILENCE_MS = 1800
const DEFAULT_EXTRA_HOLD_MS = 450

export type VoiceEndpointInput = {
  transcript: string
  silenceMs: number
  transcriptStableMs: number
  baseSilenceMs: number
  maxSilenceMs: number
}

export function computeVoiceEndpointHoldMs(input: Omit<VoiceEndpointInput, "silenceMs">) {
  const transcript = input.transcript.trim()
  const complete = completePattern.test(transcript)
  let holdMs = input.baseSilenceMs + DEFAULT_EXTRA_HOLD_MS

  if (fillerPattern.test(transcript)) holdMs += 1000
  else if (connectorPattern.test(transcript)) holdMs += 700

  if (!complete && input.transcriptStableMs < 1100) holdMs += 250
  if (input.transcriptStableMs < MIN_TRANSCRIPT_STABLE_MS) holdMs += 200

  return clamp(holdMs, MIN_AUTO_SUBMIT_SILENCE_MS, input.maxSilenceMs)
}

export function shouldFinalizeVoiceTurn(input: VoiceEndpointInput) {
  const transcript = input.transcript.trim()
  if (!transcript) return false
  if (input.transcriptStableMs < MIN_TRANSCRIPT_STABLE_MS) return false
  return input.silenceMs >= computeVoiceEndpointHoldMs(input)
}

export const shouldAutoSubmitVoiceTurn = shouldFinalizeVoiceTurn
