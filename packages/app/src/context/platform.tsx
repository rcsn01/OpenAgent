import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import { ServerConnection } from "./server"
import type {
  LinuxDisplayBackend,
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
  SpeechTranscriptionSegment,
  SpeechTranscriptionToken,
  TitlebarTheme,
} from "@opencode-ai/core/desktop"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenFilePickerOptions = { title?: string; multiple?: boolean; accept?: string[]; extensions?: string[] }
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type UpdateInfo = { updateAvailable: boolean; version?: string }
export type {
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
  SpeechTranscriptionSegment,
  SpeechTranscriptionToken,
}

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "desktop"

  /** Desktop OS */
  os?: "macos" | "windows" | "linux"

  /** App version */
  version?: string

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog */
  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  /** Open native file picker dialog */
  openFilePickerDialog?(opts?: OpenFilePickerOptions): Promise<PickerPaths>

  /** Save file picker dialog */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Write a UTF-8 text file (desktop only) */
  writeTextFile?(path: string, content: string): Promise<void>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Check for a downloadable desktop update */
  checkUpdate?(): Promise<UpdateInfo>

  /** Install the downloaded update using the platform restart flow */
  updateAndRestart?(): Promise<void>

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Get the configured WSL integration (desktop only) */
  getWslEnabled?(): Promise<boolean>

  /** Set the configured WSL integration (desktop only) */
  setWslEnabled?(config: boolean): Promise<void> | void

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Apply native titlebar theme (desktop only) */
  setTitlebarTheme?(theme: TitlebarTheme): Promise<void> | void

  /** Parse markdown to HTML using native parser (desktop only, returns unprocessed code blocks) */
  parseMarkdown?(markdown: string): Promise<string>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** List locally available speech models (desktop only) */
  listSpeechModels?(quality?: SpeechTranscriptionQuality): Promise<SpeechModelInfo[]>

  /** Download a local speech model (desktop only) */
  installSpeechModel?(model: SpeechModelID, quality?: SpeechTranscriptionQuality): Promise<SpeechModelInfo>

  /** Prepare a local speech recognition runtime (desktop only) */
  prepareSpeechTranscription?(config: SpeechRuntimeConfig): Promise<void>

  /** Start a desktop-owned speech capture session (desktop only) */
  startSpeechCaptureSession?(config?: SpeechCaptureSessionConfig): Promise<SpeechCaptureSessionInfo>

  /** Append raw mono PCM samples into the desktop speech capture session (desktop only) */
  appendSpeechCaptureSamples?(input: SpeechCaptureSamplesInput): Promise<void> | void

  /** Subscribe to desktop speech capture levels (desktop only) */
  onSpeechCaptureLevel?(cb: (event: SpeechCaptureLevelEvent) => void): () => void

  /** Start a chunk inside the desktop speech capture session (desktop only) */
  beginSpeechCaptureChunk?(sessionId: string): Promise<void> | void

  /** Start a full utterance turn inside the desktop speech capture session (desktop only) */
  beginSpeechCaptureTurn?(sessionId: string): Promise<void> | void

  /** Transcribe the current desktop-owned chunk (desktop only) */
  transcribeSpeechCaptureChunk?(input: SpeechCaptureChunkInput): Promise<SpeechTranscription>

  /** Transcribe the current desktop-owned full utterance turn (desktop only) */
  transcribeSpeechCaptureTurn?(input: SpeechCaptureChunkInput): Promise<SpeechTranscription>

  /** Stop a desktop-owned speech capture session (desktop only) */
  stopSpeechCaptureSession?(sessionId: string): Promise<void> | void

  /** Transcribe audio with a local speech recognition runtime (desktop only) */
  transcribeSpeech?(input: SpeechTranscriptionInput): Promise<SpeechTranscription>
}

export type DisplayBackend = LinuxDisplayBackend

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
