import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { matchKeybind, parseKeybind, type Keybind } from "@/context/command"
import type { VoiceInputGain } from "@/context/settings"
import type {
  SpeechModelID,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
} from "@/context/platform"
import type { Prompt } from "@/context/prompt"
import { shouldAutoSubmitVoiceTurn } from "./voice-endpoint"
import { postprocessVoiceTranscript } from "./voice-postprocess"
import { applyVoiceTranscript } from "./voice-prompt"

type PromptVoiceInput = {
  prompt: {
    current: () => Prompt
    set: (prompt: Prompt, cursorPosition?: number) => void
  }
  mode: Accessor<"normal" | "shell">
  speechModel: Accessor<SpeechModelID>
  speechQuality: Accessor<SpeechTranscriptionQuality>
  inputGain: Accessor<VoiceInputGain>
  dictionary: Accessor<string>
  corrections: Accessor<string>
  audioProcessing: Accessor<boolean>
  pressToTalkKeybind: Accessor<string>
  baseSilenceMs: Accessor<number>
  maxSilenceMs: Accessor<number>
  vadSensitivity: Accessor<"low" | "normal" | "high">
  prepareSpeechTranscription?: (config: SpeechRuntimeConfig) => Promise<void>
  transcribeSpeech?: (input: SpeechTranscriptionInput) => Promise<SpeechTranscription>
  onAutoSubmit?: () => void
}

const TRANSCRIPTION_MIME = "audio/wav"
const MIN_TRANSCRIBE_MS = 200
const MIN_PADDED_TRANSCRIBE_MS = 700
const PRE_ROLL_MS = 250
const SPEECH_FRAME_COUNT = 3
const SILENCE_FRAME_COUNT = 8

const speechFactor = (value: "low" | "normal" | "high") => {
  if (value === "high") return 1.7
  if (value === "low") return 2.8
  return 2.2
}

const minSpeechThreshold = (value: "low" | "normal" | "high") => {
  if (value === "high") return 0.0035
  if (value === "low") return 0.0065
  return 0.005
}

const inputGainValue = (value: VoiceInputGain) => {
  if (value === "max") return 2.8
  if (value === "boost") return 1.9
  return 1
}

const promptLength = (prompt: Prompt) =>
  prompt.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

const normalizeKey = (key: string) => {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

const matchesPressToTalkRelease = (binding: Keybind | undefined, event: KeyboardEvent) => {
  if (!binding) return false
  const key = normalizeKey(event.key)
  if (key === binding.key) return true
  if (key === "control" && binding.ctrl) return true
  if (key === "meta" && binding.meta) return true
  if (key === "shift" && binding.shift) return true
  if (key === "alt" && binding.alt) return true
  return false
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

const ensureMinimumChunkDuration = (buffers: Float32Array[], sampleRate: number, frames: number) => {
  const targetFrames = Math.round((sampleRate * MIN_PADDED_TRANSCRIBE_MS) / 1000)
  if (frames >= targetFrames) return buffers
  return [...buffers, new Float32Array(targetFrames - frames)]
}

export function createPromptVoice(input: PromptVoiceInput) {
  const [state, setState] = createStore<{
    manualMicEnabled: boolean
    pressToTalkActive: boolean
    preparing: boolean
    starting: boolean
    listening: boolean
    speaking: boolean
    transcribing: boolean
    error?: string
  }>({
    manualMicEnabled: false,
    pressToTalkActive: false,
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
    if (state.starting) return "Starting microphone..."
    if (state.pressToTalkActive && state.speaking) return "Release key to stop talking..."
    if (state.pressToTalkActive && state.listening) return "Hold key to keep talking..."
    if (state.manualMicEnabled && state.speaking) return "Listening..."
    if (state.manualMicEnabled && state.listening) return "Mic on"
    if (state.transcribing) return state.manualMicEnabled ? "Mic on and transcribing..." : "Finishing voice note..."
    if (state.manualMicEnabled) return "Mic on"
    return "Microphone off"
  })

  let stream: MediaStream | undefined
  let audioContext: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let processor: ScriptProcessorNode | undefined
  let inputGainNode: GainNode | undefined
  let sink: GainNode | undefined
  let audioBuffer: Uint8Array<ArrayBuffer> | undefined
  let animationFrame = 0
  let speechFrames = 0
  let silenceFrames = 0
  let noiseFloor = 0.006
  let lastSpeechAt = 0
  let recordedSampleRate = 0
  let preRollFrames = 0
  let preRollChunks: Float32Array[] = []
  let activeChunkFrames = 0
  let activeChunkBuffers: Float32Array[] = []
  let capturingChunk = false
  let sessionRuntime: SpeechRuntimeConfig | undefined
  let sessionRun = 0
  let pendingTranscriptions = 0
  let transcriptionQueue = Promise.resolve()
  let flushPending = false
  let turnTranscript = ""
  let turnTranscriptUpdatedAt = 0

  const shouldRunSession = () =>
    supported() && input.mode() === "normal" && (state.manualMicEnabled || state.pressToTalkActive)

  const currentRuntime = (): SpeechRuntimeConfig => ({
    model: sessionRuntime?.model ?? input.speechModel(),
    quality: sessionRuntime?.quality ?? input.speechQuality(),
  })

  const resetTurn = () => {
    turnTranscript = ""
    turnTranscriptUpdatedAt = 0
  }

  const finalizeTurn = () => {
    resetTurn()
    if (state.manualMicEnabled) input.onAutoSubmit?.()
    return true
  }

  const resetChunkCapture = () => {
    activeChunkFrames = 0
    activeChunkBuffers = []
    capturingChunk = false
    flushPending = false
  }

  const resetBuffers = (options?: { clearRuntime?: boolean }) => {
    recordedSampleRate = 0
    preRollFrames = 0
    preRollChunks = []
    resetChunkCapture()
    resetTurn()
    if (options?.clearRuntime) sessionRuntime = undefined
  }

  const trimPreRoll = () => {
    if (!recordedSampleRate) return
    const frameLimit = Math.max(1, Math.round((recordedSampleRate * PRE_ROLL_MS) / 1000))
    while (preRollFrames > frameLimit && preRollChunks.length > 0) {
      const overflow = preRollFrames - frameLimit
      const first = preRollChunks[0]
      if (overflow >= first.length) {
        preRollChunks.shift()
        preRollFrames -= first.length
        continue
      }
      preRollChunks[0] = first.slice(overflow)
      preRollFrames -= overflow
    }
  }

  const appendPreRoll = (buffer: Float32Array) => {
    if (!buffer.length) return
    preRollChunks.push(buffer)
    preRollFrames += buffer.length
    trimPreRoll()
  }

  const startChunkCapture = () => {
    if (capturingChunk) return
    capturingChunk = true
    activeChunkBuffers = [...preRollChunks]
    activeChunkFrames = preRollFrames
    flushPending = false
  }

  const appendActiveChunk = (buffer: Float32Array) => {
    if (!capturingChunk || !buffer.length) return
    activeChunkBuffers.push(buffer)
    activeChunkFrames += buffer.length
  }

  const takeActiveChunk = () => {
    const durationMs = recordedSampleRate > 0 ? (activeChunkFrames / recordedSampleRate) * 1000 : 0
    const chunks = activeChunkBuffers
    const sampleRate = recordedSampleRate
    const frames = activeChunkFrames
    resetChunkCapture()
    if (!sampleRate || chunks.length === 0 || durationMs < MIN_TRANSCRIBE_MS) return
    return encodeWave(ensureMinimumChunkDuration(chunks, sampleRate, frames), sampleRate)
  }

  const stopAudio = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = 0

    if (processor) {
      processor.onaudioprocess = null
      try {
        processor.disconnect()
      } catch {}
      processor = undefined
    }

    if (inputGainNode) {
      try {
        inputGainNode.disconnect()
      } catch {}
      inputGainNode = undefined
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

  const maybeFinalizeTurn = (now = performance.now()) => {
    if (!turnTranscript || capturingChunk || pendingTranscriptions > 0) return false
    const silenceMs = now - lastSpeechAt
    if (silenceMs >= input.maxSilenceMs()) return finalizeTurn()
    const transcriptStableMs = turnTranscriptUpdatedAt ? now - turnTranscriptUpdatedAt : 0
    if (
      !shouldAutoSubmitVoiceTurn({
        transcript: turnTranscript,
        silenceMs,
        transcriptStableMs,
        baseSilenceMs: input.baseSilenceMs(),
        maxSilenceMs: input.maxSilenceMs(),
      })
    ) {
      return false
    }
    return finalizeTurn()
  }

  const queueTranscription = (audio: ArrayBuffer, runtime: SpeechRuntimeConfig, run: number) => {
    if (!input.transcribeSpeech) return transcriptionQueue

    pendingTranscriptions += 1
    setState("transcribing", true)

    const next = transcriptionQueue
      .catch(() => undefined)
      .then(async () => {
        const result = await input.transcribeSpeech?.({
          audio,
          mimeType: TRANSCRIPTION_MIME,
          model: runtime.model,
          quality: runtime.quality,
        })
        const transcript = postprocessVoiceTranscript(result?.text ?? "", {
          dictionary: input.dictionary(),
          corrections: input.corrections(),
        })
        if (!transcript) return
        const nextPrompt = applyVoiceTranscript(input.prompt.current(), transcript)
        input.prompt.set(nextPrompt, promptLength(nextPrompt))
        if (run !== sessionRun) return
        turnTranscript = turnTranscript ? `${turnTranscript} ${transcript}` : transcript
        turnTranscriptUpdatedAt = performance.now()
      })
      .catch((error) => {
        setState("error", error instanceof Error ? error.message : "Voice transcription failed")
      })
      .finally(() => {
        pendingTranscriptions = Math.max(0, pendingTranscriptions - 1)
        setState("transcribing", pendingTranscriptions > 0)
        if (run === sessionRun) maybeFinalizeTurn()
      })

    transcriptionQueue = next
    return next
  }

  const flushRecording = (run = sessionRun) => {
    const audio = takeActiveChunk()
    if (!audio) return
    void queueTranscription(audio, currentRuntime(), run)
  }

  const stopSession = (options?: { transcribe?: boolean; discard?: boolean }) => {
    const run = sessionRun
    const runtime = currentRuntime()
    sessionRun += 1
    stopAudio()
    if (options?.discard) {
      resetBuffers({ clearRuntime: true })
      return
    }

    const audio = takeActiveChunk()
    preRollFrames = 0
    preRollChunks = []
    resetTurn()
    sessionRuntime = undefined
    if (!options?.transcribe || !audio) return
    void queueTranscription(audio, runtime, run)
  }

  const turnOffMicrophone = (options?: { discard?: boolean }) => {
    setState("manualMicEnabled", false)
    setState("pressToTalkActive", false)
    stopSession({
      transcribe: !options?.discard,
      discard: options?.discard,
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
      const threshold = Math.max(minSpeechThreshold(input.vadSensitivity()), noiseFloor * speechFactor(input.vadSensitivity()))
      const forceCapture = state.pressToTalkActive && !state.manualMicEnabled
      const active = forceCapture || rms > threshold
      const now = performance.now()

      if (active) {
        speechFrames += 1
        silenceFrames = 0
        lastSpeechAt = now
      } else {
        silenceFrames += 1
        speechFrames = 0
      }

      if (state.manualMicEnabled && active && speechFrames >= SPEECH_FRAME_COUNT) startChunkCapture()
      if (!state.speaking && speechFrames >= SPEECH_FRAME_COUNT) setState("speaking", true)
      if (state.speaking && silenceFrames >= SILENCE_FRAME_COUNT) setState("speaking", false)

      const silenceMs = now - lastSpeechAt
      if (state.manualMicEnabled && !active && capturingChunk && !flushPending && silenceMs >= input.baseSilenceMs()) {
        flushPending = true
        flushRecording()
      }
      if (state.manualMicEnabled && !active && !capturingChunk) maybeFinalizeTurn(now)

      animationFrame = requestAnimationFrame(step)
    }

    animationFrame = requestAnimationFrame(step)
  }

  const startMicrophone = async () => {
    if (!shouldRunSession() || state.preparing || state.starting || state.listening) return

    const run = ++sessionRun
    resetBuffers()
    noiseFloor = 0.006
    lastSpeechAt = performance.now()
    sessionRuntime = {
      model: input.speechModel(),
      quality: input.speechQuality(),
    }
    setState("error", undefined)
    setState("preparing", true)

    try {
      await input.prepareSpeechTranscription?.(sessionRuntime)
      if (run !== sessionRun || !shouldRunSession()) return

      setState("preparing", false)
      setState("starting", true)

      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: input.audioProcessing()
          ? {
              autoGainControl: true,
              echoCancellation: true,
              noiseSuppression: true,
            }
          : {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            },
      })
      if (run !== sessionRun || !shouldRunSession()) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream = nextStream

      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      audioBuffer = new Uint8Array<ArrayBuffer>(new ArrayBuffer(analyser.fftSize))

      const source = audioContext.createMediaStreamSource(stream)
      inputGainNode = audioContext.createGain()
      inputGainNode.gain.value = inputGainValue(input.inputGain())
      processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!recordedSampleRate) recordedSampleRate = audioContext?.sampleRate ?? event.inputBuffer.sampleRate
        const channel = new Float32Array(event.inputBuffer.getChannelData(0))
        if (state.pressToTalkActive && !state.manualMicEnabled && !capturingChunk) startChunkCapture()
        appendActiveChunk(channel)
        appendPreRoll(channel)
      }

      sink = audioContext.createGain()
      sink.gain.value = 0

      source.connect(inputGainNode)
      inputGainNode.connect(analyser)
      inputGainNode.connect(processor)
      processor.connect(sink)
      sink.connect(audioContext.destination)

      startVadLoop()
      setState("listening", true)
      setState("starting", false)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Microphone access failed")
      setState("manualMicEnabled", false)
      setState("pressToTalkActive", false)
      stopAudio()
      resetBuffers({ clearRuntime: true })
    } finally {
      if (run === sessionRun) {
        setState("preparing", false)
        setState("starting", false)
      }
    }
  }

  const toggleMic = () => {
    if (state.pressToTalkActive || state.preparing || state.starting) return
    if (state.manualMicEnabled) {
      setState("manualMicEnabled", false)
      return
    }
    if (!supported() || input.mode() !== "normal") return
    setState("error", undefined)
    setState("manualMicEnabled", true)
  }

  createEffect(() => {
    if (input.mode() === "normal") return
    if (!state.pressToTalkActive) return
    setState("pressToTalkActive", false)
  })

  createEffect(() => {
    if (!inputGainNode) return
    inputGainNode.gain.value = inputGainValue(input.inputGain())
  })

  createEffect(() => {
    if (shouldRunSession()) {
      if (!state.listening && !state.preparing && !state.starting) void startMicrophone()
      return
    }
    if (!state.listening && !state.preparing && !state.starting) return
    stopSession({ transcribe: true })
  })

  if (typeof document !== "undefined") {
    makeEventListener(
      document,
      "keydown",
      (event) => {
        if (!supported() || state.manualMicEnabled || state.pressToTalkActive || input.mode() !== "normal") return
        const active = document.activeElement
        if (active instanceof HTMLElement && active.dataset.voicePttCapture === "true") return
        const binding = parseKeybind(input.pressToTalkKeybind())[0]
        if (!binding || !matchKeybind([binding], event)) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        setState("error", undefined)
        setState("pressToTalkActive", true)
      },
      { capture: true },
    )

    makeEventListener(
      document,
      "keyup",
      (event) => {
        if (!state.pressToTalkActive || state.manualMicEnabled) return
        const binding = parseKeybind(input.pressToTalkKeybind())[0]
        if (!matchesPressToTalkRelease(binding, event)) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        setState("pressToTalkActive", false)
      },
      { capture: true },
    )
  }

  onCleanup(() => {
    stopAudio()
    resetBuffers({ clearRuntime: true })
  })

  return {
    supported,
    micEnabled: () => state.manualMicEnabled,
    listening: () => state.listening,
    speaking: () => state.speaking,
    status,
    busy: () => state.preparing || state.starting,
    toggleMic,
    turnOffMicrophone,
  }
}
