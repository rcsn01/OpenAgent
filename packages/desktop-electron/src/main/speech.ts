import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import type {
  SpeechModelID,
  SpeechModelInfo,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
} from "../preload/types"

const ONNX_ASR_VERSION = "0.11.0"
const PREFERRED_QUANTIZATION = "int8"
const PYTHON_VERSION = "3.11"
const INSTALL_MANIFEST = "install.json"
const DEFAULT_QUALITY: SpeechTranscriptionQuality = "fast"

const speechModels = {
  "parakeet-tdt-v3": {
    id: "parakeet-tdt-v3",
    label: "Parakeet TDT v3",
    description: "Recommended. Multilingual and the strongest local model.",
    model_name: "nemo-parakeet-tdt-0.6b-v3",
    recommended: true,
  },
  "parakeet-tdt-v2": {
    id: "parakeet-tdt-v2",
    label: "Parakeet TDT v2",
    description: "Earlier Parakeet release with an explicit download option.",
    model_name: "nemo-parakeet-tdt-0.6b-v2",
    recommended: false,
  },
} satisfies Record<
  SpeechModelID,
  {
    id: SpeechModelID
    label: string
    description: string
    model_name: string
    recommended: boolean
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
}

type WorkerState = {
  process: ChildProcessWithoutNullStreams
  pending: Map<string, PendingRequest>
  model: SpeechModelID
  quality: SpeechTranscriptionQuality
}

let preparePromise: Promise<void> | undefined
let workerState: WorkerState | undefined

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
  return {
    ...process.env,
    HF_HOME: join(speechRoot(), "huggingface"),
    PARAKEET_MODEL_DIR: speechModelDirectory(model, quality),
    PARAKEET_MODEL_NAME: getSpeechModel(model).model_name,
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
  const normalizedQuality = normalizeQuality(quality)
  await migrateLegacySpeechModel(model, normalizedQuality)
  if (!(await hasSpeechModelFiles(speechModelDirectory(model, normalizedQuality), normalizedQuality))) return false
  if (await pathExists(speechModelManifestPath(model, normalizedQuality))) return true
  await writeSpeechModelManifest(model, normalizedQuality)
  return true
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
  return Promise.all((Object.keys(speechModels) as SpeechModelID[]).map((model) => toSpeechModelInfo(model, quality)))
}

export async function installSpeechModel(model: SpeechModelID, quality?: SpeechTranscriptionQuality) {
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
  await ensureWorkerReady(config)
}

export async function transcribeSpeech(input: SpeechTranscriptionInput) {
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

      workerState.pending.set(id, { resolve, reject, timer })
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
  if (!workerState) return
  await stopWorker(new Error("The local Parakeet worker was stopped"))
}
