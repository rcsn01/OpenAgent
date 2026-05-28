import { contextBridge, ipcRenderer } from "electron"
import type { ElectronAPI } from "./types"

const api: ElectronAPI = {
  installCli: () => ipcRenderer.invoke("install-cli"),
  getRuntimeServer: () => ipcRenderer.invoke("get-runtime-server"),
  getWindowConfig: () => ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  writeTextFile: (path, content) => ipcRenderer.invoke("write-text-file", path, content),
  readTextFile: (path) => ipcRenderer.invoke("read-text-file", path),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  listSpeechModels: (quality) => ipcRenderer.invoke("list-speech-models", quality),
  installSpeechModel: (model, quality) => ipcRenderer.invoke("install-speech-model", model, quality),
  prepareSpeechTranscription: (config) => ipcRenderer.invoke("prepare-speech-transcription", config),
  startSpeechCaptureSession: (config) => ipcRenderer.invoke("start-speech-capture-session", config),
  appendSpeechCaptureSamples: (input) => ipcRenderer.send("append-speech-capture-samples", input),
  onSpeechCaptureLevel: (cb) => {
    const handler = (_: unknown, event: Parameters<typeof cb>[0]) => cb(event)
    ipcRenderer.on("speech-capture-level", handler)
    return () => ipcRenderer.removeListener("speech-capture-level", handler)
  },
  beginSpeechCaptureChunk: (sessionId) => ipcRenderer.invoke("begin-speech-capture-chunk", sessionId),
  beginSpeechCaptureTurn: (sessionId) => ipcRenderer.invoke("begin-speech-capture-turn", sessionId),
  transcribeSpeechCaptureChunk: (input) => ipcRenderer.invoke("transcribe-speech-capture-chunk", input),
  transcribeSpeechCaptureTurn: (input) => ipcRenderer.invoke("transcribe-speech-capture-turn", input),
  stopSpeechCaptureSession: (sessionId) => ipcRenderer.invoke("stop-speech-capture-session", sessionId),
  transcribeSpeech: (input) => ipcRenderer.invoke("transcribe-speech", input),
}

contextBridge.exposeInMainWorld("api", api)
