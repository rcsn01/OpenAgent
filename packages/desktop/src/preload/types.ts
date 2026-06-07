import type {
  InitStep,
  LinuxDisplayBackend,
  ServerReadyData,
  SpeechCaptureChunkInput,
  SpeechCaptureLevelEvent,
  SpeechCaptureSamplesInput,
  SpeechCaptureSessionConfig,
  SpeechCaptureSessionInfo,
  SpeechCaptureSessionSource,
  SpeechModelID,
  SpeechModelInfo,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
} from "@openagent/core/desktop"

export type {
  InitStep,
  LinuxDisplayBackend,
  ServerReadyData,
  SpeechCaptureChunkInput,
  SpeechCaptureLevelEvent,
  SpeechCaptureSamplesInput,
  SpeechCaptureSessionConfig,
  SpeechCaptureSessionInfo,
  SpeechCaptureSessionSource,
  SpeechModelID,
  SpeechModelInfo,
  SpeechRuntimeConfig,
  SpeechTranscription,
  SpeechTranscriptionInput,
  SpeechTranscriptionQuality,
  SqliteMigrationProgress,
  TitlebarTheme,
  WindowConfig,
  WslConfig,
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
  readTextFile: (path: string) => Promise<string>
  writeExtensionSkillFile: (projectDirectory: string, extensionID: string, relativePath: string, content: string) => Promise<void>
  readExtensionSkillFile: (projectDirectory: string, extensionID: string, relativePath: string) => Promise<string>
  removeExtensionSkillRoot: (projectDirectory: string, extensionID: string) => Promise<void>
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
  beginSpeechCaptureTurn: (sessionId: string) => Promise<void>
  transcribeSpeechCaptureChunk: (input: SpeechCaptureChunkInput) => Promise<SpeechTranscription>
  transcribeSpeechCaptureTurn: (input: SpeechCaptureChunkInput) => Promise<SpeechTranscription>
  stopSpeechCaptureSession: (sessionId: string) => Promise<void>
  transcribeSpeech: (input: SpeechTranscriptionInput) => Promise<SpeechTranscription>
}
