import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { SpeechModelID, SpeechTranscription, SpeechTranscriptionInput } from "@/context/platform"
import type { Prompt } from "@/context/prompt"
import { shouldAutoSubmitVoiceTurn } from "./voice-endpoint"
import { applyVoiceTranscript } from "./voice-prompt"

type PromptVoiceInput = {
  prompt: {
    current: () => Prompt
    set: (prompt: Prompt, cursorPosition?: number) => void
  }
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  autoSubmit: Accessor<boolean>
  setAutoSubmit: (value: boolean) => void
  speechModel: Accessor<SpeechModelID>
  baseSilenceMs: Accessor<number>
  maxSilenceMs: Accessor<number>
  vadSensitivity: Accessor<"low" | "normal" | "high">
  prepareSpeechTranscription?: (model: SpeechModelID) => Promise<void>
  transcribeSpeech?: (input: SpeechTranscriptionInput) => Promise<SpeechTranscription>
  submit: () => void
}

const TRANSCRIPTION_MIME = "audio/wav"
const MIN_TRANSCRIBE_MS = 200

const speechFactor = (value: "low" | "normal" | "high") => {
  if (value === "high") return 2.4
  if (value === "low") return 4
  return 3
}

const promptLength = (prompt: Prompt) =>
  prompt.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

const encodeWave = (buffers: Float32Array[], sampleRate: number) => {
  const totalSamples = buffers.reduce((count, buffer) => count + buffer.length, 0)
  const output = new ArrayBuffer(44 + totalSamples * 2)
  const view = new DataView(output)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + totalSamples * 2, true)
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
  view.setUint32(40, totalSamples * 2, true)

  let offset = 44
  for (const buffer of buffers) {
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, buffer[index]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return output
}

export function createPromptVoice(input: PromptVoiceInput) {
  const [state, setState] = createStore<{
    micEnabled: boolean
    preparing: boolean
    starting: boolean
    listening: boolean
    speaking: boolean
    transcribing: boolean
    error?: string
  }>({
    micEnabled: false,
    preparing: false,
    starting: false,
    listening: false,
    speaking: false,
    transcribing: false,
  })

  const supported = createMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    return !!navigator.mediaDevices?.getUserMedia && !!input.prepareSpeechTranscription && !!input.transcribeSpeech
  })

  const status = createMemo(() => {
    if (!supported()) return "Voice unavailable"
    if (state.error) return state.error
    if (state.preparing) return "Preparing Parakeet model..."
    if (state.transcribing) return input.autoSubmit() ? "Transcribing and sending..." : "Transcribing locally..."
    if (state.starting) return "Starting microphone..."
    if (!state.micEnabled) return "Microphone off"
    if (state.speaking) return input.autoSubmit() ? "Listening for a pause to send..." : "Recording..."
    if (state.listening) return input.autoSubmit() ? "Waiting for you to finish..." : "Recording..."
    return "Microphone off"
  })

  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let processor: ScriptProcessorNode | undefined
  let sink: GainNode | undefined
  let audioBuffer: Uint8Array<ArrayBuffer> | undefined
  let animationFrame = 0
  let endpointTimer: number | undefined
  let speechFrames = 0
  let silenceFrames = 0
  let noiseFloor = 0.006
  let lastSpeechAt = 0
  let recordedSampleRate = 0
  let recordedFrames = 0
  let recordedChunks: Float32Array[] = []
  let sawSpeech = false
  let stoppedByUser = false
  let activeModel: SpeechModelID | undefined

  const resetRecording = () => {
    recordedSampleRate = 0
    recordedFrames = 0
    recordedChunks = []
    sawSpeech = false
    activeModel = undefined
  }

  const stopAudio = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    if (endpointTimer !== undefined) clearInterval(endpointTimer)
    animationFrame = 0
    endpointTimer = undefined

    if (processor) {
      processor.onaudioprocess = null
      try {
        processor.disconnect()
      } catch {}
      processor = undefined
    }

    if (sink) {
      try {
        sink.disconnect()
      } catch {}
      sink = undefined
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      stream = undefined
    }

    if (audioContext) {
      void audioContext.close().catch(() => undefined)
      audioContext = undefined
    }

    analyser = undefined
    audioBuffer = undefined
    speechFrames = 0
    silenceFrames = 0
    setState("listening", false)
    setState("speaking", false)
    setState("starting", false)
  }

  const takeRecording = () => {
    const durationMs = recordedSampleRate > 0 ? (recordedFrames / recordedSampleRate) * 1000 : 0
    const chunks = recordedChunks
    const sampleRate = recordedSampleRate
    resetRecording()
    if (!sampleRate || chunks.length === 0 || durationMs < MIN_TRANSCRIBE_MS) return
    return encodeWave(chunks, sampleRate)
  }

  const finishMicrophone = async (options: { transcribe: boolean; submit: boolean; discard?: boolean }) => {
    stopAudio()
    const model = activeModel ?? input.speechModel()
    const audio = options.discard ? undefined : takeRecording()

    if (!options.transcribe || !audio || !input.transcribeSpeech) return

    setState("transcribing", true)
    try {
      const result = await input.transcribeSpeech({
        audio,
        mimeType: TRANSCRIPTION_MIME,
        model,
      })
      const transcript = result.text.trim()
      if (!transcript) return
      const next = applyVoiceTranscript(input.prompt.current(), transcript)
      input.prompt.set(next, promptLength(next))
      if (options.submit) input.submit()
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Voice transcription failed")
    } finally {
      setState("transcribing", false)
    }
  }

  const turnOffMicrophone = (options?: { transcribe?: boolean; submit?: boolean; discard?: boolean }) => {
    stoppedByUser = true
    setState("micEnabled", false)
    void finishMicrophone({
      transcribe: options?.transcribe ?? false,
      submit: options?.submit ?? false,
      discard: options?.discard ?? false,
    })
  }

  const startVadLoop = () => {
    if (!analyser || !audioBuffer) return
    const step = () => {
      if (!analyser || !audioBuffer) return

      analyser.getByteTimeDomainData(audioBuffer)
      let total = 0
      for (const sample of audioBuffer) {
        const normalized = (sample - 128) / 128
        total += normalized * normalized
      }

      const rms = Math.sqrt(total / audioBuffer.length)
      if (!state.speaking) noiseFloor = noiseFloor * 0.92 + rms * 0.08
      const threshold = Math.max(0.008, noiseFloor * speechFactor(input.vadSensitivity()))
      const active = rms > threshold
      const now = performance.now()

      if (active) {
        speechFrames += 1
        silenceFrames = 0
        lastSpeechAt = now
        sawSpeech = true
      } else {
        silenceFrames += 1
        speechFrames = 0
      }

      if (!state.speaking && speechFrames >= 3) setState("speaking", true)
      if (state.speaking && silenceFrames >= 8) setState("speaking", false)

      animationFrame = requestAnimationFrame(step)
    }

    animationFrame = requestAnimationFrame(step)
  }

  const startMicrophone = async () => {
    if (!supported() || state.preparing || state.starting || state.listening || state.transcribing || input.mode() !== "normal") return

    stoppedByUser = false
    resetRecording()
    noiseFloor = 0.006
    lastSpeechAt = performance.now()
    activeModel = input.speechModel()
    setState("error", undefined)
    setState("preparing", true)

    try {
      await input.prepareSpeechTranscription?.(activeModel)
      if (stoppedByUser || !state.micEnabled || input.mode() !== "normal") return

      setState("preparing", false)
      setState("starting", true)

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      audioBuffer = new Uint8Array<ArrayBuffer>(new ArrayBuffer(analyser.fftSize))
      recordedSampleRate = audioContext.sampleRate

      const source = audioContext.createMediaStreamSource(stream)
      processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0)
        recordedChunks.push(new Float32Array(channel))
        recordedFrames += channel.length
      }

      sink = audioContext.createGain()
      sink.gain.value = 0

      source.connect(analyser)
      source.connect(processor)
      processor.connect(sink)
      sink.connect(audioContext.destination)

      startVadLoop()
      endpointTimer = window.setInterval(() => {
        if (!input.autoSubmit() || !state.listening || state.speaking || !sawSpeech) return
        const silenceMs = performance.now() - lastSpeechAt
        if (
          shouldAutoSubmitVoiceTurn({
            transcript: "voice",
            silenceMs,
            transcriptStableMs: silenceMs,
            baseSilenceMs: input.baseSilenceMs(),
            maxSilenceMs: input.maxSilenceMs(),
          })
        ) {
          setState("micEnabled", false)
          void finishMicrophone({ transcribe: true, submit: true })
        }
      }, 100)

      setState("listening", true)
      setState("starting", false)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Microphone access failed")
      setState("micEnabled", false)
      stopAudio()
      resetRecording()
    } finally {
      setState("preparing", false)
      setState("starting", false)
    }
  }

  const toggleMic = () => {
    if (state.micEnabled) {
      if (state.transcribing) return
      turnOffMicrophone(state.listening ? { transcribe: true } : { discard: true })
      return
    }
    if (state.preparing || state.starting || state.transcribing) return
    if (!supported() || input.mode() !== "normal") return
    setState("micEnabled", true)
    void startMicrophone()
  }

  createEffect(() => {
    if (input.mode() === "normal") return
    if (!state.micEnabled && !state.listening) return
    turnOffMicrophone({ discard: true })
  })

  createEffect(() => {
    if (!input.working()) return
    if (!state.micEnabled && !state.listening) return
    turnOffMicrophone({ discard: true })
  })

  onCleanup(() => {
    stopAudio()
    resetRecording()
  })

  return {
    supported,
    micEnabled: () => state.micEnabled,
    listening: () => state.listening,
    speaking: () => state.speaking,
    autoSubmit: input.autoSubmit,
    setAutoSubmit: input.setAutoSubmit,
    status,
    busy: () => state.preparing || state.starting || state.listening || state.transcribing,
    toggleMic,
    turnOffMicrophone,
  }
}
