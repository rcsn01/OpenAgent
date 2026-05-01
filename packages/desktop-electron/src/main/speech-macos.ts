import { execFile, spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Readable } from "node:stream"
import { promisify } from "node:util"
import { app, BrowserWindow } from "electron"

const execFileAsync = promisify(execFile)

export type NativeSpeechCaptureLevel = {
  rms: number
  sampleRate: number
}

export type NativeSpeechCapture = {
  process: ChildProcess
}

type AppleSpeechTranscription = {
  text: string
  language?: string
  confidence?: number
  segments?: Array<{
    text: string
    startMs?: number
    endMs?: number
    confidence?: number
  }>
}

const speechNativeRoot = () => join(app.getPath("userData"), "speech", "native")

const helperSourcePath = (name: string) => {
  if (app.isPackaged) return join(process.resourcesPath, "native", name)
  return join(app.getAppPath(), "native", name)
}

const helperBinaryPath = (name: string) => join(speechNativeRoot(), name.replace(/\.swift$/, ""))

async function helperExists(path: string) {
  return access(path)
    .then(() => true)
    .catch(() => false)
}

async function ensureHelperBinary(name: string) {
  const source = helperSourcePath(name)
  const binary = helperBinaryPath(name)
  if (app.isPackaged && (await helperExists(binary))) return binary

  await mkdir(speechNativeRoot(), { recursive: true })
  await execFileAsync("swiftc", [
    "-module-cache-path",
    join(speechNativeRoot(), "module-cache"),
    source,
    "-O",
    "-framework",
    "AVFoundation",
    "-framework",
    "Speech",
    "-o",
    binary,
  ])
  return binary
}

const toFloat32Samples = (chunk: Buffer) => {
  const count = Math.floor(chunk.length / 4)
  const samples = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    samples[index] = chunk.readFloatLE(index * 4)
  }
  return samples
}

export function emitSpeechCaptureLevel(sessionId: string, level: NativeSpeechCaptureLevel) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("speech-capture-level", {
      sessionId,
      rms: level.rms,
      sampleRate: level.sampleRate,
    })
  }
}

export async function startMacOSSpeechCapture(input: {
  onLevel: (level: NativeSpeechCaptureLevel) => void
  onSamples: (samples: Float32Array, sampleRate: number) => void
}) {
  const processRef = spawn(await ensureHelperBinary("voice-capture-macos.swift"), [], {
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessByStdio<null, Readable, Readable>

  const stderr: string[] = []
  processRef.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf8"))
    if (stderr.length > 20) stderr.shift()
  })

  return await new Promise<NativeSpeechCapture>((resolve, reject) => {
    let header = Buffer.alloc(0)
    let remainder = Buffer.alloc(0)
    let sampleRate = 0
    let ready = false
    let settled = false

    const rejectWith = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const consumeBinary = (chunk: Buffer) => {
      const combined = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      const size = combined.length - (combined.length % 4)
      if (size <= 0) {
        remainder = Buffer.from(combined)
        return
      }

      remainder = Buffer.from(combined.subarray(size))
      const samples = toFloat32Samples(combined.subarray(0, size))
      if (!samples.length) return
      let total = 0
      for (const sample of samples) total += sample * sample
      input.onLevel({ rms: Math.sqrt(total / samples.length), sampleRate })
      input.onSamples(samples, sampleRate)
    }

    processRef.once("error", (error) => {
      rejectWith(error instanceof Error ? error : new Error("Failed to start native speech capture"))
    })

    processRef.stdout.on("data", (chunk: Buffer) => {
      if (!ready) {
        header = Buffer.concat([header, chunk])
        const newline = header.indexOf(0x0a)
        if (newline < 0) return
        const payload = header.subarray(0, newline).toString("utf8").trim()
        const rest = Buffer.from(header.subarray(newline + 1))
        header = Buffer.alloc(0)
        try {
          sampleRate = Number(JSON.parse(payload).sampleRate)
        } catch {
          rejectWith(new Error("Native speech capture returned an invalid header"))
          return
        }
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
          rejectWith(new Error("Native speech capture returned an invalid sample rate"))
          return
        }
        ready = true
        settled = true
        resolve({ process: processRef })
        if (rest.length) consumeBinary(rest)
        return
      }

      consumeBinary(chunk)
    })

    processRef.once("exit", (code, signal) => {
      if (ready) return
      const detail = stderr.join("").trim()
      const suffix = detail ? `\n${detail}` : ""
      rejectWith(new Error(`Native speech capture exited before ready (${signal ?? code ?? "unknown"})${suffix}`))
    })
  })
}

export async function transcribeWithAppleSpeech(audioPath: string) {
  const { stdout, stderr } = await execFileAsync(await ensureHelperBinary("apple-speech-transcribe.swift"), [audioPath])
  const payload = stdout.trim()
  if (!payload) {
    const detail = stderr.trim()
    throw new Error(detail || "Apple Speech returned an empty response")
  }

  return JSON.parse(payload) as AppleSpeechTranscription
}
