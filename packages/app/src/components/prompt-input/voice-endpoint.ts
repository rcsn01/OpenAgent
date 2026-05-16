function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const fillerPattern = /\b(?:uh|uhh+|um|umm+|er|err+|ah|ahh+|hmm+|mm+)\s*[.?!…]*$/i
const connectorPattern = /\b(?:and|but|so|because|or|if|then|well)\s*[.?!…]*$/i
const punctuationPattern = /[.!?]["')\]]?\s*$/i
const explicitCompletePattern = /\b(?:done|finished|that's it|that is it|thank you|thanks)\s*[.?!…]*$/i
const MIN_ENDPOINT_SETTLED_MS = 700
const MIN_AUTO_SUBMIT_SETTLED_MS = 1800
const DEFAULT_EXTRA_HOLD_MS = 450
const PUNCTUATION_EXTRA_HOLD_MS = 700

export type VoiceEndpointInput = {
  transcript: string
  settledMs: number
  baseSilenceMs: number
  maxSilenceMs: number
}

export function computeVoiceEndpointHoldMs(input: Omit<VoiceEndpointInput, "settledMs">) {
  const transcript = input.transcript.trim()
  const explicitlyComplete = explicitCompletePattern.test(transcript)
  let holdMs = Math.max(input.baseSilenceMs + DEFAULT_EXTRA_HOLD_MS, input.baseSilenceMs * 2)

  if (fillerPattern.test(transcript)) holdMs += 1000
  else if (connectorPattern.test(transcript)) holdMs += 700
  else if (!explicitlyComplete && punctuationPattern.test(transcript)) holdMs += PUNCTUATION_EXTRA_HOLD_MS

  return clamp(holdMs, MIN_AUTO_SUBMIT_SETTLED_MS, input.maxSilenceMs)
}

export function shouldFinalizeVoiceTurn(input: VoiceEndpointInput) {
  const transcript = input.transcript.trim()
  if (!transcript) return false
  if (input.settledMs < MIN_ENDPOINT_SETTLED_MS) return false
  return input.settledMs >= computeVoiceEndpointHoldMs(input)
}

export const shouldAutoSubmitVoiceTurn = shouldFinalizeVoiceTurn
