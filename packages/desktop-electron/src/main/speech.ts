import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import type { SpeechModelID, SpeechModelInfo, SpeechTranscription, SpeechTranscriptionInput } from "../preload/types"

const ONNX_ASR_VERSION = "0.11.0"
const PREFERRED_QUANTIZATION = "int8"
const PYTHON_VERSION = "3.11"
const INSTALL_MANIFEST = "install.json"

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
}

let preparePromise: Promise<void> | undefined
let workerState: WorkerState | undefined

function getSpeechModel(model: SpeechModelID) {
  const info = speechModels[model]
  if (!info) throw new Error(`Unsupported speech model: ${model}`)
  return info
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

function speechModelDirectory(model: SpeechModelID) {
  return join(speechModelsRoot(), model)
}

function speechModelManifestPath(model: SpeechModelID) {
  return join(speechModelDirectory(model), INSTALL_MANIFEST)
}

function speechWorkerPath() {
  if (app.isPackaged) return join(process.resourcesPath, "speech", "worker.py")
  return join(app.getAppPath(), "resources", "speech", "worker.py")
}

function workerEnvironment(model: SpeechModelID) {
  return {
    ...process.env,
    HF_HOME: join(speechRoot(), "huggingface"),
    PARAKEET_MODEL_DIR: speechModelDirectory(model),
    PARAKEET_MODEL_NAME: getSpeechModel(model).model_name,
    PARAKEET_QUANTIZATION: PREFERRED_QUANTIZATION,
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

async function isSpeechModelInstalled(model: SpeechModelID) {
  const manifest = speechModelManifestPath(model)
  const directory = speechModelDirectory(model)
  return (await pathExists(manifest)) && (await pathExists(directory))
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

function startWorker(model: SpeechModelID) {
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
      env: workerEnvironment(model),
      stdio: ["pipe", "pipe", "pipe"],
    },
  )

  workerState = {
    process: processRef,
    pending: new Map(),
    model,
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

async function ensureWorkerReady(model: SpeechModelID) {
  if (workerState?.model === model) return
  if (!(await isSpeechModelInstalled(model))) {
    throw new Error(`${getSpeechModel(model).label} has not been downloaded yet. Open voice settings and download it first.`)
  }
  if (preparePromise) {
    await preparePromise
    if (workerState?.model === model) return
  }
  if (workerState?.pending.size) {
    throw new Error("Voice transcription is still running. Wait for it to finish before switching models.")
  }
  if (workerState) {
    await stopWorker(new Error("Switching local speech models"))
  }

  preparePromise = (async () => {
    await ensureSpeechDirectories()
    await startWorker(model)
  })().finally(() => {
    preparePromise = undefined
  })

  await preparePromise
}

async function toSpeechModelInfo(model: SpeechModelID): Promise<SpeechModelInfo> {
  const info = getSpeechModel(model)
  return {
    id: info.id,
    label: info.label,
    description: info.description,
    downloaded: await isSpeechModelInstalled(model),
    recommended: info.recommended,
    path: speechModelDirectory(model),
  }
}

export async function listSpeechModels() {
  await ensureSpeechDirectories()
  return Promise.all((Object.keys(speechModels) as SpeechModelID[]).map((model) => toSpeechModelInfo(model)))
}

export async function installSpeechModel(model: SpeechModelID) {
  if (await isSpeechModelInstalled(model)) return toSpeechModelInfo(model)
  if (workerState?.pending.size) {
    throw new Error("Voice transcription is still running. Wait for it to finish before downloading another model.")
  }

  await ensureSpeechDirectories()
  if (workerState) {
    await stopWorker(new Error("Preparing a different local speech model"))
  }

  await rm(speechModelDirectory(model), { recursive: true, force: true }).catch(() => undefined)
  await startWorker(model)
  await writeFile(
    speechModelManifestPath(model),
    JSON.stringify(
      {
        id: model,
        model_name: getSpeechModel(model).model_name,
        quantization: PREFERRED_QUANTIZATION,
        installed_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  return toSpeechModelInfo(model)
}

export async function prepareSpeechTranscription(model: SpeechModelID) {
  await ensureWorkerReady(model)
}

export async function transcribeSpeech(input: SpeechTranscriptionInput) {
  await ensureWorkerReady(input.model)
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
      workerState.process.stdin.write(`${JSON.stringify({ type: "transcribe", id, audio_path: audioPath })}\n`)
    })
  } finally {
    await rm(audioPath, { force: true }).catch(() => undefined)
  }
}

export async function disposeSpeechTranscription() {
  if (!workerState) return
  await stopWorker(new Error("The local Parakeet worker was stopped"))
}
