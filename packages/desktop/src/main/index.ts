import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow } from "electron"

import contextMenu from "electron-context-menu"

import type { InitStep, ServerReadyData, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { startComputerUseBridge, type ComputerUseBridge } from "./computer-use-bridge"
import {
  getDefaultServerUrl,
  getWslConfig,
  preferAppEnv,
  setDefaultServerUrl,
  setWslConfig,
  findOrStartSharedServer,
} from "./server"
import { createMainWindow, registerRendererProtocol, setBackgroundColor, setDockIcon } from "./windows"
import { migrate } from "./migrate"
import { checkUpdate, checkForUpdates, installUpdate, setupAutoUpdater } from "./updater"
import { disposeSpeechTranscription } from "./speech"
import { Deferred, Effect } from "effect"

const APP_NAMES: Record<string, string> = {
  dev: "OpenAgent Dev",
  beta: "OpenAgent Beta",
  prod: "OpenAgent",
}
const APP_IDS: Record<string, string> = {
  dev: "com.rcsn01.openagent.dev",
  beta: "com.rcsn01.openagent.beta",
  prod: "com.rcsn01.openagent",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const FALLBACK_SERVER_URL = "http://127.0.0.1:4096"

let logger: ReturnType<typeof initLogging>
let mainWindow: BrowserWindow | null = null
let computerUseBridge: ComputerUseBridge | null = null

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

function normalizeServerUrl(input: string | undefined | null) {
  const trimmed = input?.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

function envServerUrl() {
  const openagent = normalizeServerUrl(process.env.OPENAGENT_SERVER_URL)
  if (openagent) return openagent

  const legacy = normalizeServerUrl(process.env.OPENCODE_DESKTOP_SERVER_URL)
  if (legacy) logger.warn("OPENCODE_DESKTOP_SERVER_URL is deprecated; use OPENAGENT_SERVER_URL instead")
  return legacy
}

function openMainWindow() {
  mainWindow = createMainWindow()
  if (!mainWindow) return

  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true, killSidecar)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      void killSidecar().finally(() => {
        app.relaunch()
        app.exit(0)
      })
    },
  })
}

async function killSidecar() {
  return
}

async function stopComputerUseBridge() {
  if (!computerUseBridge) return
  const current = computerUseBridge
  computerUseBridge = null
  await current.close()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "com.rcsn01.openagent.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenAgent Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  logger = initLogging()

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  try {
    computerUseBridge = yield* Effect.promise(() => startComputerUseBridge())
    process.env.OPENAGENT_COMPUTER_USE_BRIDGE_URL = computerUseBridge.url
    process.env.OPENAGENT_COMPUTER_USE_BRIDGE_TOKEN = computerUseBridge.token
    logger.log("computer use bridge started", { url: computerUseBridge.url })
  } catch (error) {
    logger.warn("failed to start computer use bridge", error)
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("openagent://") || arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    void killSidecar()
    void stopComputerUseBridge()
    void disposeSpeechTranscription()
  })

  app.on("will-quit", () => {
    void killSidecar()
    void stopComputerUseBridge()
    void disposeSpeechTranscription()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void Promise.allSettled([killSidecar(), stopComputerUseBridge(), disposeSpeechTranscription()]).finally(() =>
        app.exit(0),
      )
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData>()

  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    awaitInitialization: Effect.fnUntraced(
      function* (sendStep) {
        sendStep(initStep)
        const listener = (step: InitStep) => sendStep(step)
        initEmitter.on("step", listener)
        try {
          logger.log("awaiting server ready")
          const res = yield* Deferred.await(serverReady)
          logger.log("server ready", { url: res.url })
          return res
        } finally {
          initEmitter.off("step", listener)
        }
      },
      (e) => Effect.runPromise(e),
    ),
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
    loadingWindowComplete: () => undefined,
    runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail, killSidecar),
    checkUpdate: async () => checkUpdate(),
    installUpdate: async () => installUpdate(killSidecar),
    setBackgroundColor: (color) => setBackgroundColor(color),
  })

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  app.setAsDefaultProtocolClient("openagent")
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  setupAutoUpdater()

  const directServerUrl = envServerUrl()
  const storedServerUrl = normalizeServerUrl(getDefaultServerUrl())
  const externalServer =
    directServerUrl || storedServerUrl
      ? undefined
      : yield* Effect.promise(() => findOrStartSharedServer()).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              logger.warn("external opencode server discovery failed", error)
              return undefined
            }),
          ),
        )

  const resolvedServer: ServerReadyData = directServerUrl
    ? { url: directServerUrl, username: null, password: null }
    : storedServerUrl
      ? { url: storedServerUrl, username: null, password: null }
      : externalServer
        ? {
            url: externalServer.url,
            username: externalServer.username ?? null,
            password: externalServer.password ?? null,
          }
        : { url: FALLBACK_SERVER_URL, username: null, password: null }

  if (externalServer) logger.log("using external opencode server", { url: externalServer.url })
  if (!directServerUrl && !storedServerUrl && !externalServer) {
    logger.warn("no external opencode server found; showing server selection UI", { fallback: FALLBACK_SERVER_URL })
  }

  yield* Deferred.succeed(serverReady, resolvedServer)
  setInitStep({ phase: "done" })

  openMainWindow()
})

Effect.runFork(main)
