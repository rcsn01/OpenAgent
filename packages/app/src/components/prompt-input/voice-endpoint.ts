function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const fillerPattern = /\b(?:uh|uhh+|um|umm+|er|err+|ah|ahh+|hmm+|mm+)\s*[.?!…]*$/i
const connectorPattern = /\b(?:and|but|so|because|or|if|then|well)\s*[.?!…]*$/i
const completePattern = /(?:[.!?]["')\]]?\s*$|\b(?:done|finished|that's it|that is it|thank you|thanks)\s*$)/i

export type VoiceEndpointInput = {
  transcript: string
  silenceMs: number
  transcriptStableMs: number
  baseSilenceMs: number
  maxSilenceMs: number
}

export function computeVoiceEndpointHoldMs(input: Omit<VoiceEndpointInput, "silenceMs">) {
  const transcript = input.transcript.trim()
  let holdMs = input.baseSilenceMs

  if (fillerPattern.test(transcript)) holdMs += 700
  else if (connectorPattern.test(transcript)) holdMs += 400

  if (input.transcriptStableMs < 250) holdMs += 300
  if (input.transcriptStableMs < 120) holdMs += 200
  if (completePattern.test(transcript)) holdMs -= 200

  return clamp(holdMs, 450, input.maxSilenceMs)
}

export function shouldFinalizeVoiceTurn(input: VoiceEndpointInput) {
  const transcript = input.transcript.trim()
  if (!transcript) return false
  if (input.transcriptStableMs < 250) return false
  return input.silenceMs >= computeVoiceEndpointHoldMs(input)
}

export const shouldAutoSubmitVoiceTurn = shouldFinalizeVoiceTurn
