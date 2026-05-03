import { makeEventListener } from "@solid-primitives/event-listener"
import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { matchKeybind, parseKeybind, type Keybind } from "@/context/command"
import type { VoiceInputGain } from "@/context/settings"
import type {
  SpeechCaptureChunkInput,
  SpeechCaptureLevelEvent,
  SpeechCaptureSessionConfig,
  SpeechCaptureSamplesInput,
  SpeechCaptureSessionInfo,
  SpeechModelID,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
} from "@/context/platform"
import type { Prompt } from "@/context/prompt"
import { adoptSpeechCaptureSession } from "./voice-capture-session"
import { shouldAutoSubmitVoiceTurn } from "./voice-endpoint"
import { getVoicePromptTerms, postprocessVoiceTranscript } from "./voice-postprocess"
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
  startSpeechCaptureSession?: (config?: SpeechCaptureSessionConfig) => Promise<SpeechCaptureSessionInfo>
  appendSpeechCaptureSamples?: (input: SpeechCaptureSamplesInput) => Promise<void> | void
  onSpeechCaptureLevel?: (cb: (event: SpeechCaptureLevelEvent) => void) => () => void
  beginSpeechCaptureChunk?: (sessionId: string) => Promise<void> | void
  beginSpeechCaptureTurn?: (sessionId: string) => Promise<void> | void
  transcribeSpeechCaptureChunk?: (input: SpeechCaptureChunkInput) => Promise<SpeechTranscription>
  transcribeSpeechCaptureTurn?: (input: SpeechCaptureChunkInput) => Promise<SpeechTranscription>
  stopSpeechCaptureSession?: (sessionId: string) => Promise<void> | void
  transcribeSpeech?: (input: SpeechTranscriptionInput) => Promise<SpeechTranscription>
  onAutoSubmit?: () => void
}

const TRANSCRIPTION_MIME = "audio/wav"
const MIN_TRANSCRIBE_MS = 200
const MIN_PADDED_TRANSCRIBE_MS = 1000
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
  if (value === "max") return 6
  if (value === "boost") return 3.5
  return 1
}

const promptLength = (prompt: Prompt) =>
  prompt.reduce((total, part) => total + ("content" in part ? part.content.length : 0), 0)

const clonePrompt = (prompt: Prompt) => prompt.map((part) => ({ ...part }))

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
    if (!input.prepareSpeechTranscription || !input.transcribeSpeech) return false
    if (supportsNativeDesktopCapture()) return true
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    return !!navigator.mediaDevices?.getUserMedia
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
  let activeTurnFrames = 0
  let activeTurnBuffers: Float32Array[] = []
  let capturingChunk = false
  let capturingTurn = false
  let finalizingTurn = false
  let sessionRuntime: SpeechRuntimeConfig | undefined
  let speechCaptureSession: SpeechCaptureSessionInfo | undefined
  let disposeSpeechCaptureLevel: (() => void) | undefined
  let sessionRun = 0
  let pendingTranscriptions = 0
  let transcriptionQueue = Promise.resolve()
  let flushPending = false
  let turnTranscript = ""
  let turnTranscriptUpdatedAt = 0
  let turnBasePrompt: Prompt | undefined

  const shouldRunSession = () =>
    supported() && input.mode() === "normal" && (state.manualMicEnabled || state.pressToTalkActive)

  function supportsDesktopCapture() {
    return (
      !!input.startSpeechCaptureSession &&
      !!input.appendSpeechCaptureSamples &&
      !!input.beginSpeechCaptureChunk &&
      !!input.transcribeSpeechCaptureChunk &&
      !!input.stopSpeechCaptureSession
    )
  }

  function supportsNativeDesktopCapture() {
    return supportsDesktopCapture() && !!input.onSpeechCaptureLevel
  }

  const currentRuntime = (): SpeechRuntimeConfig => ({
    model: sessionRuntime?.model ?? input.speechModel(),
    quality: sessionRuntime?.quality ?? input.speechQuality(),
  })

  const promptTerms = () =>
    getVoicePromptTerms({
      dictionary: input.dictionary(),
      corrections: input.corrections(),
    })

  const resetTurn = () => {
    turnTranscript = ""
    turnTranscriptUpdatedAt = 0
    turnBasePrompt = undefined
    activeTurnFrames = 0
    activeTurnBuffers = []
    capturingTurn = false
    finalizingTurn = false
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

  const resetSpeechFrames = () => {
    speechFrames = 0
    silenceFrames = 0
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

  const beginTurnCapture = () => {
    if (capturingTurn) return
    capturingTurn = true
    finalizingTurn = false
    turnBasePrompt = clonePrompt(input.prompt.current())
    if (speechCaptureSession && input.beginSpeechCaptureTurn) {
      Promise.resolve(input.beginSpeechCaptureTurn(speechCaptureSession.id)).catch(() => undefined)
      return
    }
    activeTurnBuffers = [...preRollChunks]
    activeTurnFrames = preRollFrames
  }

  const startChunkCapture = () => {
    if (capturingChunk) return
    beginTurnCapture()
    capturingChunk = true
    if (speechCaptureSession && input.beginSpeechCaptureChunk) {
      Promise.resolve(input.beginSpeechCaptureChunk(speechCaptureSession.id)).catch(() => undefined)
      flushPending = false
      return
    }
    activeChunkBuffers = [...preRollChunks]
    activeChunkFrames = preRollFrames
    flushPending = false
  }

  const appendActiveChunk = (buffer: Float32Array) => {
    if (speechCaptureSession) return
    if (!capturingChunk || !buffer.length) return
    activeChunkBuffers.push(buffer)
    activeChunkFrames += buffer.length
  }

  const appendActiveTurn = (buffer: Float32Array) => {
    if (speechCaptureSession) return
    if (!capturingTurn || !buffer.length) return
    activeTurnBuffers.push(buffer)
    activeTurnFrames += buffer.length
  }

  const takeActiveChunk = () => {
    const durationMs = recordedSampleRate > 0 ? (activeChunkFrames / recordedSampleRate) * 1000 : 0
    const chunks = activeChunkBuffers
    const sampleRate = recordedSampleRate
    const frames = activeChunkFrames
    resetChunkCapture()
    if (!sampleRate || chunks.length === 0 || durationMs < MIN_TRANSCRIBE_MS) return
    return {
      audio: encodeWave(ensureMinimumChunkDuration(chunks, sampleRate, frames), sampleRate),
      originalDurationMs: Math.round(durationMs),
    }
  }

  const takeActiveTurn = () => {
    const durationMs = recordedSampleRate > 0 ? (activeTurnFrames / recordedSampleRate) * 1000 : 0
    const chunks = activeTurnBuffers
    const sampleRate = recordedSampleRate
    const frames = activeTurnFrames
    activeTurnFrames = 0
    activeTurnBuffers = []
    capturingTurn = false
    if (!sampleRate || chunks.length === 0 || durationMs < MIN_TRANSCRIBE_MS) return
    return {
      audio: encodeWave(ensureMinimumChunkDuration(chunks, sampleRate, frames), sampleRate),
      originalDurationMs: Math.round(durationMs),
    }
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
    resetSpeechFrames()
    disposeSpeechCaptureLevel?.()
    disposeSpeechCaptureLevel = undefined
    setState("listening", false)
    setState("speaking", false)
    setState("starting", false)
  }

  const handleVoiceActivity = (active: boolean, now = performance.now()) => {
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
  }

  const handleVoiceLevel = (rms: number, now = performance.now()) => {
    if (!state.speaking) noiseFloor = noiseFloor * 0.92 + rms * 0.08
    const threshold = Math.max(minSpeechThreshold(input.vadSensitivity()), noiseFloor * speechFactor(input.vadSensitivity()))
    const forceCapture = state.pressToTalkActive && !state.manualMicEnabled
    handleVoiceActivity(forceCapture || rms > threshold, now)
  }

  const maybeFinalizeTurn = (now = performance.now()) => {
    if (!turnTranscript || capturingChunk || finalizingTurn || pendingTranscriptions > 0) return false
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

  const queueTranscriptionTask = (
    task: () => Promise<SpeechTranscription | undefined>,
    run: number,
    options?: { final?: boolean; submit?: boolean; basePrompt?: Prompt },
  ) => {
    pendingTranscriptions += 1
    setState("transcribing", true)
    let failed = false

    const next = transcriptionQueue
      .catch(() => undefined)
      .then(async () => {
        const result = await task()
        const transcript = postprocessVoiceTranscript(result?.text ?? "", {
          dictionary: input.dictionary(),
          corrections: input.corrections(),
        })
        if (!transcript) return
        const nextPrompt = applyVoiceTranscript(options?.basePrompt ?? input.prompt.current(), transcript)
        input.prompt.set(nextPrompt, promptLength(nextPrompt))
        if (run !== sessionRun) return
        turnTranscript = options?.final || !turnTranscript ? transcript : `${turnTranscript} ${transcript}`
        turnTranscriptUpdatedAt = performance.now()
      })
      .catch((error) => {
        failed = true
        setState("error", error instanceof Error ? error.message : "Voice transcription failed")
      })
      .finally(() => {
        pendingTranscriptions = Math.max(0, pendingTranscriptions - 1)
        setState("transcribing", pendingTranscriptions > 0)
        if (options?.final) {
          resetTurn()
          if (!failed && options.submit && run === sessionRun && state.manualMicEnabled) input.onAutoSubmit?.()
          return
        }
        if (run === sessionRun) maybeFinalizeTurn()
      })

    transcriptionQueue = next
    return next
  }

  const finalizeTurn = () => {
    if (finalizingTurn) return true
    finalizingTurn = true
    const run = sessionRun
    const runtime = currentRuntime()
    const basePrompt = turnBasePrompt ? clonePrompt(turnBasePrompt) : clonePrompt(input.prompt.current())
    if (speechCaptureSession && input.transcribeSpeechCaptureTurn) {
      const sessionId = speechCaptureSession.id
      const transcribeSpeechCaptureTurn = input.transcribeSpeechCaptureTurn
      void queueTranscriptionTask(
        () =>
          transcribeSpeechCaptureTurn({
            sessionId,
            model: runtime.model,
            quality: runtime.quality,
            promptTerms: promptTerms(),
          }),
        run,
        { final: true, submit: true, basePrompt },
      )
      return true
    }
    if (input.transcribeSpeech) {
      const transcribeSpeech = input.transcribeSpeech
      const clip = takeActiveTurn()
      if (clip) {
        void queueTranscriptionTask(
          () =>
            transcribeSpeech({
              audio: clip.audio,
              mimeType: TRANSCRIPTION_MIME,
              model: runtime.model,
              quality: runtime.quality,
              originalDurationMs: clip.originalDurationMs,
              promptTerms: promptTerms(),
            }),
          run,
          { final: true, submit: true, basePrompt },
        )
        return true
      }
    }
    resetTurn()
    if (state.manualMicEnabled) input.onAutoSubmit?.()
    return true
  }

  const queueTranscription = (clip: { audio: ArrayBuffer; originalDurationMs: number }, runtime: SpeechRuntimeConfig, run: number) => {
    if (!input.transcribeSpeech) return transcriptionQueue
    const transcribeSpeech = input.transcribeSpeech
    return queueTranscriptionTask(
      () =>
        transcribeSpeech({
          audio: clip.audio,
          mimeType: TRANSCRIPTION_MIME,
          model: runtime.model,
          quality: runtime.quality,
          originalDurationMs: clip.originalDurationMs,
          promptTerms: promptTerms(),
        }),
      run,
    )
  }

  const queueDesktopCaptureTranscription = (sessionId: string, runtime: SpeechRuntimeConfig, run: number, stopAfter: boolean) => {
    if (!input.transcribeSpeechCaptureChunk) return transcriptionQueue
    const transcribeSpeechCaptureChunk = input.transcribeSpeechCaptureChunk
    return queueTranscriptionTask(
      async () => {
        try {
          return await transcribeSpeechCaptureChunk({
            sessionId,
            model: runtime.model,
            quality: runtime.quality,
            promptTerms: promptTerms(),
          })
        } finally {
          if (!stopAfter) return
          await Promise.resolve(input.stopSpeechCaptureSession?.(sessionId))
        }
      },
      run,
    )
  }

  const flushRecording = (run = sessionRun) => {
    if (speechCaptureSession) {
      const currentCaptureSession = speechCaptureSession
      resetChunkCapture()
      if (!currentCaptureSession) return
      void queueDesktopCaptureTranscription(currentCaptureSession.id, currentRuntime(), run, false)
      return
    }
    const clip = takeActiveChunk()
    if (!clip) return
    void queueTranscription(clip, currentRuntime(), run)
  }

  const stopSession = (options?: { transcribe?: boolean; discard?: boolean }) => {
    const run = sessionRun
    const runtime = currentRuntime()
    const currentCaptureSession = speechCaptureSession
    const basePrompt = turnBasePrompt ? clonePrompt(turnBasePrompt) : clonePrompt(input.prompt.current())
    speechCaptureSession = undefined
    sessionRun += 1
    stopAudio()
    if (options?.discard) {
      if (currentCaptureSession) void Promise.resolve(input.stopSpeechCaptureSession?.(currentCaptureSession.id))
      resetBuffers({ clearRuntime: true })
      return
    }

    preRollFrames = 0
    preRollChunks = []
    sessionRuntime = undefined
    if (currentCaptureSession) {
      resetChunkCapture()
      if (!options?.transcribe) {
        void Promise.resolve(input.stopSpeechCaptureSession?.(currentCaptureSession.id))
        resetTurn()
        return
      }
      if (input.transcribeSpeechCaptureTurn) {
        const transcribeSpeechCaptureTurn = input.transcribeSpeechCaptureTurn
        void queueTranscriptionTask(
          async () => {
            try {
              return await transcribeSpeechCaptureTurn({
                sessionId: currentCaptureSession.id,
                model: runtime.model,
                quality: runtime.quality,
                promptTerms: promptTerms(),
              })
            } finally {
              await Promise.resolve(input.stopSpeechCaptureSession?.(currentCaptureSession.id))
            }
          },
          run,
          { final: true, basePrompt },
        )
        return
      }
      void queueDesktopCaptureTranscription(currentCaptureSession.id, runtime, run, true)
      return
    }
    const clip = takeActiveTurn() ?? takeActiveChunk()
    const transcribeSpeech = input.transcribeSpeech
    if (!options?.transcribe || !clip) {
      resetTurn()
      return
    }
    if (!transcribeSpeech) {
      resetTurn()
      return
    }
    void queueTranscriptionTask(
      () =>
        transcribeSpeech({
          audio: clip.audio,
          mimeType: TRANSCRIPTION_MIME,
          model: runtime.model,
          quality: runtime.quality,
          originalDurationMs: clip.originalDurationMs,
          promptTerms: promptTerms(),
        }),
      run,
      { final: true, basePrompt },
    )
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
      handleVoiceLevel(rms)

      animationFrame = requestAnimationFrame(step)
    }

    animationFrame = requestAnimationFrame(step)
  }

  const startMicrophone = async () => {
    if (!shouldRunSession() || state.preparing || state.starting || state.listening) return

    const run = ++sessionRun
    resetBuffers()
    resetSpeechFrames()
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

      if (supportsNativeDesktopCapture() && input.startSpeechCaptureSession && input.onSpeechCaptureLevel) {
        const nextSpeechCaptureSession = await input
          .startSpeechCaptureSession({ gain: inputGainValue(input.inputGain()) })
          .catch(() => undefined)
        if (run !== sessionRun || !shouldRunSession()) {
          if (nextSpeechCaptureSession) void Promise.resolve(input.stopSpeechCaptureSession?.(nextSpeechCaptureSession.id))
          return
        }
        const activeSpeechCaptureSession = adoptSpeechCaptureSession(nextSpeechCaptureSession)
        if (activeSpeechCaptureSession) {
          speechCaptureSession = activeSpeechCaptureSession
          disposeSpeechCaptureLevel = input.onSpeechCaptureLevel((event) => {
            if (!speechCaptureSession || event.sessionId !== speechCaptureSession.id) return
            handleVoiceLevel(event.rms)
          })
          setState("listening", true)
          setState("starting", false)
          return
        }
        if (nextSpeechCaptureSession) void Promise.resolve(input.stopSpeechCaptureSession?.(nextSpeechCaptureSession.id))
      }

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
        if (speechCaptureSession?.source === "renderer" && input.appendSpeechCaptureSamples) {
          input.appendSpeechCaptureSamples({
            sessionId: speechCaptureSession.id,
            samples: channel.slice().buffer,
            sampleRate: recordedSampleRate,
          })
        }
        if (state.pressToTalkActive && !state.manualMicEnabled && !capturingChunk) startChunkCapture()
        if (speechCaptureSession) return
        appendActiveTurn(channel)
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
      if (speechCaptureSession) {
        void Promise.resolve(input.stopSpeechCaptureSession?.(speechCaptureSession.id))
        speechCaptureSession = undefined
      }
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
    if (speechCaptureSession) void Promise.resolve(input.stopSpeechCaptureSession?.(speechCaptureSession.id))
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
