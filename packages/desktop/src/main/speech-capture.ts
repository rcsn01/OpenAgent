const WAVE_HEADER_BYTES = 44

export const SPEECH_CAPTURE_SAMPLE_RATE = 16000
export const MIN_SPEECH_CAPTURE_MS = 200
export const MIN_PADDED_SPEECH_CAPTURE_MS = 1000
export const DEFAULT_SPEECH_CAPTURE_PRE_ROLL_MS = 250
export const DEFAULT_SPEECH_CAPTURE_RING_BUFFER_MS = 5000

export type SpeechCaptureSessionState = {
  ring_buffer: Float32Array
  ring_length: number
  ring_offset: number
  pre_roll_frames: number
  active_chunk_buffers: Float32Array[]
  active_chunk_frames: number
  capturing: boolean
  active_turn_buffers: Float32Array[]
  active_turn_frames: number
  capturing_turn: boolean
}

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

const encodeWave = (samples: Float32Array, sampleRate: number) => {
  const output = new ArrayBuffer(WAVE_HEADER_BYTES + samples.length * 2)
  const view = new DataView(output)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, samples.length * 2, true)

  let offset = WAVE_HEADER_BYTES
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return output
}

const resampleMonoBuffer = (samples: Float32Array, inputSampleRate: number) => {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0 || samples.length === 0) return new Float32Array(0)
  if (Math.round(inputSampleRate) === SPEECH_CAPTURE_SAMPLE_RATE) return samples

  const ratio = inputSampleRate / SPEECH_CAPTURE_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const lower = Math.floor(position)
    const upper = Math.min(samples.length - 1, lower + 1)
    const weight = position - lower
    output[index] = samples[lower] * (1 - weight) + samples[upper] * weight
  }

  return output
}

const appendRingBuffer = (state: SpeechCaptureSessionState, samples: Float32Array) => {
  if (samples.length === 0) return
  const source = samples.length >= state.ring_buffer.length ? samples.subarray(samples.length - state.ring_buffer.length) : samples
  const first = Math.min(source.length, state.ring_buffer.length - state.ring_offset)
  state.ring_buffer.set(source.subarray(0, first), state.ring_offset)
  const remaining = source.length - first
  if (remaining > 0) state.ring_buffer.set(source.subarray(first), 0)
  state.ring_offset = (state.ring_offset + source.length) % state.ring_buffer.length
  state.ring_length = Math.min(state.ring_buffer.length, state.ring_length + source.length)
}

const sliceLastFrames = (state: SpeechCaptureSessionState, frames: number) => {
  const count = Math.min(frames, state.ring_length)
  if (count <= 0) return new Float32Array(0)

  const output = new Float32Array(count)
  const start = (state.ring_offset - count + state.ring_buffer.length) % state.ring_buffer.length
  const first = Math.min(count, state.ring_buffer.length - start)
  output.set(state.ring_buffer.subarray(start, start + first), 0)
  if (first < count) output.set(state.ring_buffer.subarray(0, count - first), first)
  return output
}

const ensureMinimumChunkDuration = (samples: Float32Array) => {
  const targetFrames = Math.round((SPEECH_CAPTURE_SAMPLE_RATE * MIN_PADDED_SPEECH_CAPTURE_MS) / 1000)
  if (samples.length >= targetFrames) return samples
  const output = new Float32Array(targetFrames)
  output.set(samples, 0)
  return output
}

export function createSpeechCaptureSessionState() {
  return {
    ring_buffer: new Float32Array(
      Math.round((SPEECH_CAPTURE_SAMPLE_RATE * DEFAULT_SPEECH_CAPTURE_RING_BUFFER_MS) / 1000),
    ),
    ring_length: 0,
    ring_offset: 0,
    pre_roll_frames: Math.round((SPEECH_CAPTURE_SAMPLE_RATE * DEFAULT_SPEECH_CAPTURE_PRE_ROLL_MS) / 1000),
    active_chunk_buffers: [],
    active_chunk_frames: 0,
    capturing: false,
    active_turn_buffers: [],
    active_turn_frames: 0,
    capturing_turn: false,
  } satisfies SpeechCaptureSessionState
}

export function appendSpeechCaptureSamples(state: SpeechCaptureSessionState, samples: Float32Array, inputSampleRate: number) {
  const normalized = resampleMonoBuffer(samples, inputSampleRate)
  if (normalized.length === 0) return
  appendRingBuffer(state, normalized)
  if (state.capturing_turn) {
    state.active_turn_buffers.push(normalized)
    state.active_turn_frames += normalized.length
  }
  if (!state.capturing) return
  state.active_chunk_buffers.push(normalized)
  state.active_chunk_frames += normalized.length
}

export function beginSpeechCaptureTurn(state: SpeechCaptureSessionState) {
  if (state.capturing_turn) return
  const preRoll = sliceLastFrames(state, state.pre_roll_frames)
  state.active_turn_buffers = preRoll.length ? [preRoll] : []
  state.active_turn_frames = preRoll.length
  state.capturing_turn = true
}

export function clearSpeechCaptureTurn(state: SpeechCaptureSessionState) {
  state.active_turn_buffers = []
  state.active_turn_frames = 0
  state.capturing_turn = false
}

export function beginSpeechCaptureChunk(state: SpeechCaptureSessionState) {
  if (state.capturing) return
  const preRoll = sliceLastFrames(state, state.pre_roll_frames)
  state.active_chunk_buffers = preRoll.length ? [preRoll] : []
  state.active_chunk_frames = preRoll.length
  state.capturing = true
}

export function clearSpeechCaptureChunk(state: SpeechCaptureSessionState) {
  state.active_chunk_buffers = []
  state.active_chunk_frames = 0
  state.capturing = false
}

export function takeSpeechCaptureChunk(state: SpeechCaptureSessionState) {
  const originalDurationMs = Math.round((state.active_chunk_frames * 1000) / SPEECH_CAPTURE_SAMPLE_RATE)
  const samples = new Float32Array(state.active_chunk_frames)
  let offset = 0
  for (const buffer of state.active_chunk_buffers) {
    samples.set(buffer, offset)
    offset += buffer.length
  }
  clearSpeechCaptureChunk(state)
  if (samples.length === 0 || originalDurationMs < MIN_SPEECH_CAPTURE_MS) return
  return {
    audio: encodeWave(ensureMinimumChunkDuration(samples), SPEECH_CAPTURE_SAMPLE_RATE),
    originalDurationMs,
  }
}

export function takeSpeechCaptureTurn(state: SpeechCaptureSessionState) {
  const originalDurationMs = Math.round((state.active_turn_frames * 1000) / SPEECH_CAPTURE_SAMPLE_RATE)
  const samples = new Float32Array(state.active_turn_frames)
  let offset = 0
  for (const buffer of state.active_turn_buffers) {
    samples.set(buffer, offset)
    offset += buffer.length
  }
  clearSpeechCaptureTurn(state)
  if (samples.length === 0 || originalDurationMs < MIN_SPEECH_CAPTURE_MS) return
  return {
    audio: encodeWave(ensureMinimumChunkDuration(samples), SPEECH_CAPTURE_SAMPLE_RATE),
    originalDurationMs,
  }
}
