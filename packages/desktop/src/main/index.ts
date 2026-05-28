import { homedir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { attachOrStartServer, type RuntimeEndpoint } from "@openagent/server/launcher"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"
import contextMenu from "electron-context-menu"
import type { WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { getDefaultServerUrl, getWslConfig, preferAppEnv, setDefaultServerUrl, setWslConfig } from "./server"
import { createMainWindow, registerRendererProtocol, setBackgroundColor, setDockIcon } from "./windows"
import { checkUpdate, checkForUpdates, installUpdate, setupAutoUpdater } from "./updater"
import { disposeSpeechTranscription } from "./speech"

const APP_NAMES: Record<string, string> = {
  dev: "OpenAgent Dev",
  beta: "OpenAgent Beta",
  prod: "OpenAgent",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
const pendingDeepLinks: string[] = []
let runtimeEndpoint: RuntimeEndpoint | undefined
const stopRuntime = async () => {
  runtimeEndpoint?.process?.kill()
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function createAppMenu() {
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true, stopRuntime)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      app.relaunch()
      app.exit(0)
    },
  })
}

async function main() {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  try {
    process.chdir(homedir())
  } catch {}

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenAgent Dev")
  app.setAppUserModelId(appId)
  app.setPath("userData", join(app.getPath("appData"), appId))
  logger = initLogging()

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    mode: "openagent-server",
  })

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))
  runtimeEndpoint = await attachOrStartServer()

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) emitDeepLinks(urls)
    mainWindow?.show()
    mainWindow?.focus()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    void disposeSpeechTranscription()
  })

  registerIpcHandlers({
    getRuntimeServer: async () => {
      if (!runtimeEndpoint) runtimeEndpoint = await attachOrStartServer()
      return {
        url: runtimeEndpoint.url,
        token: runtimeEndpoint.token,
        authToken: runtimeEndpoint.authToken,
      }
    },
    getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    getWslConfig: () => Promise.resolve(getWslConfig()),
    setWslConfig: (config: WslConfig) => setWslConfig(config),
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    wslPath: async (path, mode) => wslPath(path, mode),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail, stopRuntime),
    checkUpdate: async () => checkUpdate(),
    installUpdate: async () => installUpdate(stopRuntime),
    setBackgroundColor: (color) => setBackgroundColor(color),
  })

  await app.whenReady()
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  setupAutoUpdater()

  mainWindow = createMainWindow()
  createAppMenu()
}

main().catch((error) => {
  logger?.error("fatal desktop startup error", error)
  app.quit()
})
