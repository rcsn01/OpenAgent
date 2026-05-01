export type NativeSpeechCaptureLevel = {
  rms: number
  sampleRate: number
}

type NativeSpeechCaptureInput = {
  gain?: number
  onLevel: (level: NativeSpeechCaptureLevel) => void
  onSamples: (samples: Float32Array, sampleRate: number) => void
}

export function applySpeechCaptureGain(samples: Float32Array, gain = 1) {
  if (!samples.length || !Number.isFinite(gain) || gain <= 0 || gain === 1) return samples
  const output = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, samples[index] * gain))
  }
  return output
}

export function emitSpeechCaptureSamples(input: NativeSpeechCaptureInput, samples: Float32Array, sampleRate: number) {
  const normalized = applySpeechCaptureGain(samples, input.gain)
  if (!normalized.length) return
  let total = 0
  for (const sample of normalized) total += sample * sample
  input.onLevel({ rms: Math.sqrt(total / normalized.length), sampleRate })
  input.onSamples(normalized, sampleRate)
}
