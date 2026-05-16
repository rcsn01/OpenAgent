export type InitStep = { phase: "server_waiting" } | { phase: "sqlite_waiting" } | { phase: "done" }

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type SqliteMigrationProgress = { type: "InProgress"; value: number } | { type: "Done" }

export type WslConfig = { enabled: boolean }

export type LinuxDisplayBackend = "wayland" | "auto"

export type TitlebarTheme = {
  mode: "light" | "dark"
}

export type WindowConfig = {
  updaterEnabled: boolean
}

export type SpeechModelID = "apple-speech" | "parakeet-tdt-v2" | "parakeet-tdt-v3"
export type SpeechTranscriptionQuality = "fast" | "accurate"
export type SpeechModelInfo = {
  id: SpeechModelID
  label: string
  description: string
  downloaded: boolean
  recommended: boolean
  path: string
}
export type SpeechRuntimeConfig = {
  model: SpeechModelID
  quality: SpeechTranscriptionQuality
}
export type SpeechCaptureSessionSource = "native" | "renderer"
export type SpeechCaptureSessionConfig = {
  gain?: number
}
export type SpeechCaptureSessionInfo = {
  id: string
  source: SpeechCaptureSessionSource
}
export type SpeechCaptureSamplesInput = {
  sessionId: string
  samples: ArrayBuffer
  sampleRate: number
}
export type SpeechCaptureLevelEvent = {
  sessionId: string
  rms: number
  sampleRate: number
}
export type SpeechCaptureChunkInput = {
  sessionId: string
  promptTerms?: string[]
} & SpeechRuntimeConfig

export type SpeechTranscriptionInput = {
  audio: ArrayBuffer
  mimeType: string
  originalDurationMs?: number
  promptTerms?: string[]
} & SpeechRuntimeConfig

export type SpeechTranscriptionSegment = {
  text: string
  startMs?: number
  endMs?: number
  confidence?: number
}

export type SpeechTranscriptionToken = {
  text: string
  startMs?: number
  endMs?: number
  logprob?: number
  confidence?: number
}

export type SpeechTranscription = {
  text: string
  language?: string
  confidence?: number
  segments?: SpeechTranscriptionSegment[]
  tokens?: SpeechTranscriptionToken[]
}
