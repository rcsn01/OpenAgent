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

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>
  getWindowConfig: () => Promise<WindowConfig>
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  getWslConfig: () => Promise<WslConfig>
  setWslConfig: (config: WslConfig) => Promise<void>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    accept?: string[]
    extensions?: string[]
  }) => Promise<string | string[] | null>
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  writeTextFile: (path: string, content: string) => Promise<void>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  loadingWindowComplete: () => void
  runUpdater: (alertOnFail: boolean) => Promise<void>
  checkUpdate: () => Promise<{ updateAvailable: boolean; version?: string }>
  installUpdate: () => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  listSpeechModels: (quality?: SpeechTranscriptionQuality) => Promise<SpeechModelInfo[]>
  installSpeechModel: (model: SpeechModelID, quality?: SpeechTranscriptionQuality) => Promise<SpeechModelInfo>
  prepareSpeechTranscription: (config: SpeechRuntimeConfig) => Promise<void>
  startSpeechCaptureSession: (config?: SpeechCaptureSessionConfig) => Promise<SpeechCaptureSessionInfo>
  appendSpeechCaptureSamples: (input: SpeechCaptureSamplesInput) => void
  onSpeechCaptureLevel: (cb: (event: SpeechCaptureLevelEvent) => void) => () => void
  beginSpeechCaptureChunk: (sessionId: string) => Promise<void>
  transcribeSpeechCaptureChunk: (input: SpeechCaptureChunkInput) => Promise<SpeechTranscription>
  stopSpeechCaptureSession: (sessionId: string) => Promise<void>
  transcribeSpeech: (input: SpeechTranscriptionInput) => Promise<SpeechTranscription>
}
