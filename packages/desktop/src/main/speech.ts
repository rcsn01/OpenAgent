import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import type {
  SpeechCaptureChunkInput,
  SpeechCaptureSessionConfig,
  SpeechCaptureSessionInfo,
  SpeechCaptureSessionSource,
  SpeechCaptureSamplesInput,
  SpeechModelID,
  SpeechModelInfo,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
} from "../preload/types"
import {
  appendSpeechCaptureSamples as appendCaptureSamples,
  beginSpeechCaptureChunk as beginCaptureChunk,
  beginSpeechCaptureTurn as beginCaptureTurn,
  createSpeechCaptureSessionState,
  takeSpeechCaptureChunk,
  takeSpeechCaptureTurn,
  type SpeechCaptureSessionState,
} from "./speech-capture"
import { emitSpeechCaptureLevel, startMacOSSpeechCapture, transcribeWithAppleSpeech } from "./speech-macos"

const ONNX_ASR_VERSION = "0.11.0"
const PREFERRED_QUANTIZATION = "int8"
const PYTHON_VERSION = "3.11"
const INSTALL_MANIFEST = "install.json"
const DEFAULT_QUALITY: SpeechTranscriptionQuality = "fast"

const speechModels = {
  "apple-speech": {
    id: "apple-speech",
    label: "Apple Speech",
    description: "Experimental. Uses macOS native speech recognition when it is available.",
    model_name: undefined,
    recommended: false,
    runtime: "apple",
  },
  "parakeet-tdt-v3": {
    id: "parakeet-tdt-v3",
    label: "Parakeet TDT v3",
    description: "Recommended. Multilingual and the strongest local model.",
    model_name: "nemo-parakeet-tdt-0.6b-v3",
    recommended: true,
    runtime: "parakeet",
  },
  "parakeet-tdt-v2": {
    id: "parakeet-tdt-v2",
    label: "Parakeet TDT v2",
    description: "Earlier Parakeet release with an explicit download option.",
    model_name: "nemo-parakeet-tdt-0.6b-v2",
    recommended: false,
    runtime: "parakeet",
  },
} satisfies Record<
  SpeechModelID,
  {
    id: SpeechModelID
    label: string
    description: string
    recommended: boolean
    runtime: "apple" | "parakeet"
    model_name?: string
  }
>

type WorkerReadyMessage = {
  type: "ready"
  model: string
  quantization?: string
}

type WorkerResponseMessage = {
  type: "response"
  id: string
  text: string
  language?: string
  confidence?: number
  originalDurationMs?: number
  segments?: SpeechTranscription["segments"]
  tokens?: SpeechTranscription["tokens"]
}

type WorkerErrorMessage = {
  type: "error"
  id?: string
  message: string
}

type WorkerMessage = WorkerReadyMessage | WorkerResponseMessage | WorkerErrorMessage

type PendingRequest = {
  resolve: (value: SpeechTranscription) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  originalDurationMs?: number
}

type WorkerState = {
  process: ChildProcessWithoutNullStreams
  pending: Map<string, PendingRequest>
  model: SpeechModelID
  quality: SpeechTranscriptionQuality
}

type SpeechCaptureSession = {
  state: SpeechCaptureSessionState
  source: SpeechCaptureSessionSource
  process?: ChildProcess
}

let preparePromise: Promise<void> | undefined
let workerState: WorkerState | undefined
const speechCaptureSessions = new Map<string, SpeechCaptureSession>()
const fallbackParakeetModels = ["parakeet-tdt-v3", "parakeet-tdt-v2"] as const
let appleSpeechUnavailable = false

const speechQualities = {
  fast: {
    id: "fast",
    label: "Fast",
    quantization: PREFERRED_QUANTIZATION,
  },
  accurate: {
    id: "accurate",
    label: "Accurate",
    quantization: undefined,
  },
} satisfies Record<
  SpeechTranscriptionQuality,
  {
    id: SpeechTranscriptionQuality
    label: string
    quantization?: string
  }
>

function getSpeechModel(model: SpeechModelID) {
  const info = speechModels[model]
  if (!info) throw new Error(`Unsupported speech model: ${model}`)
  return info
}

function normalizeQuality(quality?: SpeechTranscriptionQuality) {
  return quality ?? DEFAULT_QUALITY
}

function getSpeechQuality(quality?: SpeechTranscriptionQuality) {
  return speechQualities[normalizeQuality(quality)]
}

function nativeSpeechCaptureEnabled() {
  return process.env.OPENCODE_ENABLE_NATIVE_SPEECH_CAPTURE === "1"
}

function fallbackParakeetCandidates(quality?: SpeechTranscriptionQuality) {
  const normalizedQuality = normalizeQuality(quality)
  return [
    ...fallbackParakeetModels.map((model) => ({ model, quality: normalizedQuality })),
    ...(normalizedQuality === DEFAULT_QUALITY
      ? []
      : fallbackParakeetModels.map((model) => ({ model, quality: DEFAULT_QUALITY }))),
  ]
}

function speechRoot() {
  return join(app.getPath("userData"), "speech")
}

function speechRequestsRoot() {
  return join(speechRoot(), "requests")
}

function speechModelsRoot() {
  return join(speechRoot(), "models")
}

function speechModelDirectory(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  return join(speechModelsRoot(), normalizeQuality(quality), model)
}

function legacySpeechModelDirectory(model: SpeechModelID) {
  return join(speechModelsRoot(), model)
}

function speechModelManifestPath(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  return join(speechModelDirectory(model, quality), INSTALL_MANIFEST)
}

function speechWorkerPath() {
  if (app.isPackaged) return join(process.resourcesPath, "speech", "worker.py")
  return join(app.getAppPath(), "resources", "speech", "worker.py")
}

function workerEnvironment(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  const config = getSpeechQuality(quality)
  const modelInfo = getSpeechModel(model)
  if (!modelInfo.model_name) throw new Error(`Unsupported worker model: ${model}`)
  return {
    ...process.env,
    HF_HOME: join(speechRoot(), "huggingface"),
    PARAKEET_MODEL_DIR: speechModelDirectory(model, quality),
    PARAKEET_MODEL_NAME: modelInfo.model_name,
    PARAKEET_QUANTIZATION: config.quantization ?? "",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    UV_CACHE_DIR: join(speechRoot(), "uv-cache"),
    UV_NATIVE_TLS: "1",
    UV_NO_PROGRESS: "1",
  }
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function speechModelFiles(quality?: SpeechTranscriptionQuality) {
  if (normalizeQuality(quality) === "accurate") {
    return ["config.json", "vocab.txt", "encoder-model.onnx", "decoder_joint-model.onnx"]
  }
  return ["config.json", "vocab.txt", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx"]
}

async function hasSpeechModelFiles(directory: string, quality?: SpeechTranscriptionQuality) {
  return (await Promise.all(speechModelFiles(quality).map((file) => pathExists(join(directory, file))))).every(Boolean)
}

async function writeSpeechModelManifest(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  const normalizedQuality = normalizeQuality(quality)
  await writeFile(
    speechModelManifestPath(model, normalizedQuality),
    JSON.stringify(
      {
        id: model,
        model_name: getSpeechModel(model).model_name,
        quality: normalizedQuality,
        quantization: getSpeechQuality(normalizedQuality).quantization ?? "default",
        installed_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
}

async function migrateLegacySpeechModel(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  const normalizedQuality = normalizeQuality(quality)
  if (normalizedQuality !== "fast") return
  if (await hasSpeechModelFiles(speechModelDirectory(model, normalizedQuality), normalizedQuality)) return
  if (!(await hasSpeechModelFiles(legacySpeechModelDirectory(model), normalizedQuality))) return

  await mkdir(join(speechModelsRoot(), normalizedQuality), { recursive: true })
  await rm(speechModelDirectory(model, normalizedQuality), { recursive: true, force: true }).catch(() => undefined)
  await rename(legacySpeechModelDirectory(model), speechModelDirectory(model, normalizedQuality)).catch(() => undefined)
}

async function isSpeechModelInstalled(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  if (getSpeechModel(model).runtime === "apple") return process.platform === "darwin"
  const normalizedQuality = normalizeQuality(quality)
  await migrateLegacySpeechModel(model, normalizedQuality)
  if (!(await hasSpeechModelFiles(speechModelDirectory(model, normalizedQuality), normalizedQuality))) return false
  if (await pathExists(speechModelManifestPath(model, normalizedQuality))) return true
  await writeSpeechModelManifest(model, normalizedQuality)
  return true
}

async function fallbackParakeetConfig(quality?: SpeechTranscriptionQuality) {
  return (
    await Promise.all(
      fallbackParakeetCandidates(quality).map(async (candidate) =>
        (await isSpeechModelInstalled(candidate.model, candidate.quality)) ? candidate : undefined,
      ),
    )
  ).find(
    (
      candidate,
    ): candidate is {
      model: (typeof fallbackParakeetModels)[number]
      quality: SpeechTranscriptionQuality
    } => !!candidate,
  )
}

async function ensureSpeechDirectories() {
  await mkdir(speechRoot(), { recursive: true })
  await mkdir(speechRequestsRoot(), { recursive: true })
  await mkdir(speechModelsRoot(), { recursive: true })
}

function clearPendingRequests(pending: Map<string, PendingRequest>, error: Error) {
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(error)
  }
  pending.clear()
}

async function stopWorker(reason: Error) {
  const current = workerState
  if (!current) return

  workerState = undefined
  clearPendingRequests(current.pending, reason)

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      current.process.kill()
      resolve()
    }, 1000)

    current.process.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })

    try {
      current.process.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`)
    } catch {
      current.process.kill()
    }
  })
}

function startWorker(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  const normalizedQuality = normalizeQuality(quality)
  const processRef = spawn(
    "uv",
    [
      "run",
      "--isolated",
      "--python",
      PYTHON_VERSION,
      "--with",
      `onnx-asr[cpu,hub]==${ONNX_ASR_VERSION}`,
      "python",
      "-u",
      speechWorkerPath(),
    ],
    {
      cwd: speechRoot(),
      env: workerEnvironment(model, normalizedQuality),
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  workerState = {
    process: processRef,
    pending: new Map(),
    model,
    quality: normalizedQuality,
  }

  const stderr: string[] = []
  processRef.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf8"))
    if (stderr.length > 20) stderr.shift()
  })

  return new Promise<void>((resolve, reject) => {
    const readyTimer = setTimeout(() => {
      reject(new Error(`Preparing ${getSpeechModel(model).label} timed out`))
    }, 15 * 60 * 1000)

    let stdout = ""
    let ready = false
    let settled = false

    const rejectWith = (error: Error) => {
      settled = true
      clearTimeout(readyTimer)
      workerState = undefined
      reject(error)
    }

    processRef.once("error", (error) => {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT") {
        rejectWith(new Error("Local voice setup requires `uv` in your PATH"))
        return
      }
      rejectWith(error instanceof Error ? error : new Error("Failed to start the local speech worker"))
    })

    processRef.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      while (true) {
        const newline = stdout.indexOf("\n")
        if (newline < 0) break
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        if (!line) continue

        let message: WorkerMessage
        try {
          message = JSON.parse(line) as WorkerMessage
        } catch {
          continue
        }

        if (message.type === "ready") {
          settled = true
          ready = true
          clearTimeout(readyTimer)
          resolve()
          continue
        }

        if (message.type === "response") {
          const pending = workerState?.pending.get(message.id)
          if (!pending) continue
          clearTimeout(pending.timer)
          workerState?.pending.delete(message.id)
          pending.resolve({
            text: message.text,
            language: message.language,
            confidence: message.confidence,
            originalDurationMs: message.originalDurationMs ?? pending.originalDurationMs,
            segments: message.segments,
            tokens: message.tokens,
          })
          continue
        }

        if (message.type !== "error") continue
        const error = new Error(message.message)
        if (!message.id) {
          rejectWith(error)
          continue
        }
        const pending = workerState?.pending.get(message.id)
        if (!pending) continue
        clearTimeout(pending.timer)
        workerState?.pending.delete(message.id)
        pending.reject(error)
      }
    })

    processRef.once("exit", (code, signal) => {
      const detail = stderr.join("").trim()
      const suffix = detail ? `\n${detail}` : ""
      const reason =
        code === 0
          ? new Error("The local Parakeet worker stopped unexpectedly")
          : new Error(`The local Parakeet worker exited (${signal ?? code ?? "unknown"})${suffix}`)
      if (workerState?.process === processRef) {
        clearPendingRequests(workerState.pending, reason)
        workerState = undefined
      }
      if (!ready && !settled) rejectWith(reason)
    })
  })
}

async function ensureWorkerReady(config: SpeechRuntimeConfig) {
  if (getSpeechModel(config.model).runtime === "apple") return
  if (workerState?.model === config.model && workerState.quality === config.quality) return
  if (!(await isSpeechModelInstalled(config.model, config.quality))) {
    throw new Error(
      `${getSpeechModel(config.model).label} (${getSpeechQuality(config.quality).label}) has not been downloaded yet. Open voice settings and download it first.`,
    )
  }
  if (preparePromise) {
    await preparePromise
    if (workerState?.model === config.model && workerState.quality === config.quality) return
  }
  if (workerState?.pending.size) {
    throw new Error("Voice transcription is still running. Wait for it to finish before switching model quality.")
  }
  if (workerState) {
    await stopWorker(new Error("Switching local speech runtime"))
  }

  preparePromise = (async () => {
    await ensureSpeechDirectories()
    await startWorker(config.model, config.quality)
  })().finally(() => {
    preparePromise = undefined
  })

  await preparePromise
}

async function toSpeechModelInfo(model: SpeechModelID, quality?: SpeechTranscriptionQuality): Promise<SpeechModelInfo> {
  const info = getSpeechModel(model)
  return {
    id: info.id,
    label: info.label,
    description: info.description,
    downloaded: await isSpeechModelInstalled(model, quality),
    recommended: info.recommended,
    path: speechModelDirectory(model, quality),
  }
}

export async function listSpeechModels(quality?: SpeechTranscriptionQuality) {
  await ensureSpeechDirectories()
  return Promise.all(
    (Object.keys(speechModels) as SpeechModelID[])
      .filter((model) => process.platform === "darwin" || getSpeechModel(model).runtime !== "apple")
      .map((model) => toSpeechModelInfo(model, quality)),
  )
}

export async function installSpeechModel(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
  if (getSpeechModel(model).runtime === "apple") return toSpeechModelInfo(model, quality)
  const normalizedQuality = normalizeQuality(quality)
  if (await isSpeechModelInstalled(model, normalizedQuality)) return toSpeechModelInfo(model, normalizedQuality)
  if (workerState?.pending.size) {
    throw new Error("Voice transcription is still running. Wait for it to finish before downloading another model.")
  }

  await ensureSpeechDirectories()
  if (workerState) {
    await stopWorker(new Error("Preparing a different local speech runtime"))
  }

  await rm(speechModelDirectory(model, normalizedQuality), { recursive: true, force: true }).catch(() => undefined)
  await startWorker(model, normalizedQuality)
  await writeSpeechModelManifest(model, normalizedQuality)
  return toSpeechModelInfo(model, normalizedQuality)
}

export async function prepareSpeechTranscription(config: SpeechRuntimeConfig) {
  if (getSpeechModel(config.model).runtime === "apple") return
  await ensureWorkerReady(config)
}

export async function startSpeechCaptureSession(config?: SpeechCaptureSessionConfig): Promise<SpeechCaptureSessionInfo> {
  const id = randomUUID()
  const session: SpeechCaptureSession = {
    state: createSpeechCaptureSessionState(),
    source: "renderer",
  }
  speechCaptureSessions.set(id, session)

  if (process.platform !== "darwin" || !nativeSpeechCaptureEnabled()) return { id, source: session.source }

  try {
    session.process = (
      await startMacOSSpeechCapture({
        gain: config?.gain,
        onLevel(level) {
          emitSpeechCaptureLevel(id, level)
        },
        onSamples(samples, sampleRate) {
          appendCaptureSamples(session.state, samples, sampleRate)
        },
      })
    ).process
    session.source = "native"
  } catch {}

  return { id, source: session.source }
}

export function appendSpeechCaptureSamples(input: SpeechCaptureSamplesInput) {
  const session = speechCaptureSessions.get(input.sessionId)
  if (!session) return
  if (session.source !== "renderer") return
  appendCaptureSamples(session.state, new Float32Array(input.samples), input.sampleRate)
}

export function beginSpeechCaptureChunk(sessionId: string) {
  const session = speechCaptureSessions.get(sessionId)
  if (!session) return
  beginCaptureChunk(session.state)
}

export function beginSpeechCaptureTurn(sessionId: string) {
  const session = speechCaptureSessions.get(sessionId)
  if (!session) return
  beginCaptureTurn(session.state)
}

export async function transcribeSpeechCaptureChunk(input: SpeechCaptureChunkInput) {
  const session = speechCaptureSessions.get(input.sessionId)
  if (!session) return { text: "" }
  const clip = takeSpeechCaptureChunk(session.state)
  if (!clip) return { text: "" }
  return transcribeSpeech({
    audio: clip.audio,
    mimeType: "audio/wav",
    model: input.model,
    quality: input.quality,
    originalDurationMs: clip.originalDurationMs,
    promptTerms: input.promptTerms,
  })
}

export async function transcribeSpeechCaptureTurn(input: SpeechCaptureChunkInput) {
  const session = speechCaptureSessions.get(input.sessionId)
  if (!session) return { text: "" }
  const clip = takeSpeechCaptureTurn(session.state)
  if (!clip) return { text: "" }
  return transcribeSpeech({
    audio: clip.audio,
    mimeType: "audio/wav",
    model: input.model,
    quality: input.quality,
    originalDurationMs: clip.originalDurationMs,
    promptTerms: input.promptTerms,
  })
}

export function stopSpeechCaptureSession(sessionId: string) {
  const session = speechCaptureSessions.get(sessionId)
  if (session?.process) session.process.kill()
  speechCaptureSessions.delete(sessionId)
}

export async function transcribeSpeech(input: SpeechTranscriptionInput) {
  const modelInfo = getSpeechModel(input.model)
  if (modelInfo.runtime === "apple") {
    if (appleSpeechUnavailable) {
      const fallback = await fallbackParakeetConfig(input.quality)
      if (!fallback) throw new Error("Apple Speech is unavailable. Switch the voice model to Parakeet and download it in Voice settings.")
      return transcribeSpeech({
        ...input,
        model: fallback.model,
        quality: fallback.quality,
      })
    }
    await ensureSpeechDirectories()
    const id = randomUUID()
    const audioPath = join(speechRequestsRoot(), `${id}.wav`)
    await writeFile(audioPath, Buffer.from(input.audio))
    try {
      return {
        ...(await transcribeWithAppleSpeech(audioPath)),
        originalDurationMs: input.originalDurationMs,
      }
    } catch (error) {
      appleSpeechUnavailable = true
      const fallback = await fallbackParakeetConfig(input.quality)
      if (!fallback) {
        const reason = error instanceof Error ? error.message : "Apple Speech transcription failed"
        throw new Error(`${reason} Switch the voice model to Parakeet and download it in Voice settings.`)
      }
      console.warn(`[speech] Apple Speech failed, falling back to ${fallback.model} (${fallback.quality})`, error)
      return transcribeSpeech({
        ...input,
        model: fallback.model,
        quality: fallback.quality,
      })
    } finally {
      await rm(audioPath, { force: true }).catch(() => undefined)
    }
  }
  await ensureWorkerReady({ model: input.model, quality: input.quality })
  if (!workerState) throw new Error("The local Parakeet worker is unavailable")

  await mkdir(speechRequestsRoot(), { recursive: true })
  const id = randomUUID()
  const audioPath = join(speechRequestsRoot(), `${id}.wav`)
  await writeFile(audioPath, Buffer.from(input.audio))

  try {
    return await new Promise<SpeechTranscription>((resolve, reject) => {
      if (!workerState) {
        reject(new Error("The local Parakeet worker is unavailable"))
        return
      }

      const timer = setTimeout(() => {
        workerState?.pending.delete(id)
        reject(new Error("Local voice transcription timed out"))
      }, 2 * 60 * 1000)

      workerState.pending.set(id, { resolve, reject, timer, originalDurationMs: input.originalDurationMs })
      workerState.process.stdin.write(
        `${JSON.stringify({
          type: "transcribe",
          id,
          audio_path: audioPath,
          original_duration_ms: input.originalDurationMs,
          prompt_terms: input.promptTerms,
        })}\n`,
      )
    })
  } finally {
    await rm(audioPath, { force: true }).catch(() => undefined)
  }
}

export async function disposeSpeechTranscription() {
  for (const session of speechCaptureSessions.values()) {
    if (session.process) session.process.kill()
  }
  speechCaptureSessions.clear()
  if (!workerState) return
  await stopWorker(new Error("The local Parakeet worker was stopped"))
}
