import { execFile } from "node:child_process"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { randomUUID } from "node:crypto"

export type ComputerUseBridge = {
  url: string
  token: string
  close: () => Promise<void>
}

type BridgeRequest = {
  tool: string
  arguments?: Record<string, unknown>
}

const MAX_BODY_BYTES = 1024 * 1024
const ACCESSIBILITY_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
const SCREEN_RECORDING_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

function json(status: number, body: unknown) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"))
        req.destroy()
      }
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

function runJxa(script: string, args: Record<string, string> = {}) {
  return new Promise<string>((resolve, reject) => {
    const wrapped = `var __openAgentArgs = ${JSON.stringify(args)};\nfunction __openAgentArg(name) { return __openAgentArgs[name]; }\n${script}`
    execFile("osascript", ["-l", "JavaScript", "-e", wrapped], { timeout: 15_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()))
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function accessibilityTrusted(prompt: boolean) {
  if (process.platform !== "darwin") return false
  const { systemPreferences } = await import("electron")
  if (!systemPreferences) return true
  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

async function ensureAccessibilityTrusted() {
  if (process.platform !== "darwin") {
    throw new Error("Computer Use is currently macOS-only.")
  }

  if (await accessibilityTrusted(true)) return
  const { shell } = await import("electron")
  void shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
  throw new Error(
    [
      "OpenAgent needs Accessibility permission before Computer Use can inspect or control apps.",
      "macOS should now be showing an Accessibility permission prompt.",
      "If it does not appear, enable OpenAgent manually in System Settings > Privacy & Security > Accessibility, then restart OpenAgent.",
    ].join("\n"),
  )
}

async function screenRecordingStatus() {
  if (process.platform !== "darwin") return "unknown"
  const { systemPreferences } = await import("electron")
  if (!systemPreferences) return "unknown"
  return systemPreferences.getMediaAccessStatus("screen")
}

async function requestScreenRecordingAccess() {
  if (process.platform !== "darwin") return
  const status = await screenRecordingStatus()
  if (status === "granted") return

  // macOS has no direct askForMediaAccess("screen") API. Requesting a screen
  // thumbnail is the supported way to trigger the Screen Recording consent flow.
  await capturePrimaryScreen({ promptOnly: true }).catch(() => undefined)
}

async function ensureScreenRecordingAccess() {
  await requestScreenRecordingAccess()
  const status = await screenRecordingStatus()
  if (status === "granted") return

  const { shell } = await import("electron")
  if (status === "denied" || status === "restricted") {
    void shell.openExternal(SCREEN_RECORDING_SETTINGS_URL)
  }
  throw new Error(
    [
      "OpenAgent needs Screen Recording permission before Computer Use can take screenshots.",
      `Current Screen Recording permission status: ${status}.`,
      "If macOS did not show a prompt, enable OpenAgent manually in System Settings > Privacy & Security > Screen Recording, then restart OpenAgent.",
    ].join("\n"),
  )
}

async function requestInitialComputerUsePermissions() {
  if (process.platform !== "darwin") return
  await accessibilityTrusted(true)
  await requestScreenRecordingAccess()
}

function scriptPrelude() {
  return String.raw`
function safe(fn, fallback) {
  try {
    var value = fn()
    if (value === undefined || value === null) return fallback
    return value
  } catch (_) {
    return fallback
  }
}

function asArray(value) {
  try {
    if (!value) return []
    var result = value()
    return Array.isArray(result) ? result : []
  } catch (_) {
    return []
  }
}

function scalar(value) {
  try {
    if (value === undefined || value === null) return null
    var kind = typeof value
    if (kind === "string" || kind === "number" || kind === "boolean") return value
    if (Array.isArray(value)) {
      return value.map(function(item) { return scalar(item) }).filter(function(item) { return item !== null })
    }
    return String(value)
  } catch (_) {
    return null
  }
}

function firstLabel(values) {
  for (var i = 0; i < values.length; i++) {
    var item = scalar(values[i])
    if (item === undefined || item === null) continue
    var text = String(item).trim()
    if (text !== "") return text
  }
  return ""
}

function findProcess(identifier) {
  var system = Application("System Events")
  var processes = system.applicationProcesses()
  var needle = String(identifier || "").toLowerCase()
  for (var i = 0; i < processes.length; i++) {
    var process = processes[i]
    var name = safe(function() { return process.name() }, "")
    var bundle = safe(function() { return process.bundleIdentifier() }, "")
    if (String(name).toLowerCase() === needle || String(bundle).toLowerCase() === needle) return process
  }
  for (var j = 0; j < processes.length; j++) {
    var candidate = processes[j]
    var candidateName = safe(function() { return candidate.name() }, "")
    var candidateBundle = safe(function() { return candidate.bundleIdentifier() }, "")
    if (
      String(candidateName).toLowerCase().indexOf(needle) >= 0 ||
      String(candidateBundle).toLowerCase().indexOf(needle) >= 0
    ) return candidate
  }
  throw new Error("App is not running or is not visible to Accessibility: " + identifier)
}

function activateProcess(identifier) {
  var process = null
  try {
    process = findProcess(identifier)
  } catch (_) {
    safe(function() { Application(identifier).activate() }, null)
    for (var i = 0; i < 20; i++) {
      delay(0.1)
      try {
        process = findProcess(identifier)
        break
      } catch (_) {}
    }
    if (!process) throw new Error("App could not be started or focused: " + identifier)
  }
  safe(function() { process.frontmost = true }, null)
  safe(function() {
    var bundle = process.bundleIdentifier()
    if (bundle) Application(bundle).activate()
  }, null)
  delay(0.1)
  return process
}

function elementChildren(element) {
  return asArray(function() { return element.uiElements() })
}

function readElement(element, state, depth, maxDepth, maxChildren) {
  var index = state.next++
  var title = scalar(safe(function() { return element.title() }, ""))
  var description = scalar(safe(function() { return element.description() }, ""))
  var value = scalar(safe(function() { return element.value() }, null))
  var help = scalar(safe(function() { return element.help() }, ""))
  var roleDescription = scalar(safe(function() { return element.roleDescription() }, ""))
  var name = scalar(safe(function() { return element.name() }, ""))
  var identifier = scalar(safe(function() { return element.identifier() }, ""))
  var label = firstLabel([title, description, value, help, roleDescription, name, identifier])
  var children = []
  if (depth < maxDepth) {
    var rawChildren = elementChildren(element)
    for (var i = 0; i < rawChildren.length && i < maxChildren; i++) {
      children.push(readElement(rawChildren[i], state, depth + 1, maxDepth, maxChildren))
    }
  }
  return {
    index: String(index),
    role: safe(function() { return element.role() }, ""),
    subrole: safe(function() { return element.subrole() }, ""),
    title: title,
    description: description,
    value: value,
    help: help,
    roleDescription: roleDescription,
    name: name,
    identifier: identifier,
    label: label,
    enabled: scalar(safe(function() { return element.enabled() }, null)),
    position: scalar(safe(function() { return element.position() }, null)),
    size: scalar(safe(function() { return element.size() }, null)),
    actions: asArray(function() { return element.actions() }).map(function(action) {
      return safe(function() { return action.name() }, "")
    }).filter(Boolean),
    children: children
  }
}

function findElement(process, wantedIndex) {
  var state = { next: 0, found: null }
  function visit(element) {
    var index = String(state.next++)
    if (index === String(wantedIndex)) {
      state.found = element
      return true
    }
    var children = elementChildren(element)
    for (var i = 0; i < children.length; i++) {
      if (visit(children[i])) return true
    }
    return false
  }
  var windows = asArray(function() { return process.windows() })
  for (var i = 0; i < windows.length; i++) {
    if (visit(windows[i])) return state.found
  }
  throw new Error("Element index is not present in the latest app state: " + wantedIndex)
}
`
}

async function listApps() {
  await ensureAccessibilityTrusted()
  const output = await runJxa(`${scriptPrelude()}
var system = Application("System Events")
var processes = system.applicationProcesses()
var frontmost = safe(function() { return processes.whose({ frontmost: true })[0].name() }, "")
JSON.stringify(processes.map(function(process) {
  return {
    name: safe(function() { return process.name() }, ""),
    bundleIdentifier: safe(function() { return process.bundleIdentifier() }, ""),
    frontmost: safe(function() { return process.frontmost() }, false),
    visible: safe(function() { return process.visible() }, false)
  }
}).filter(function(process) { return process.name }).sort(function(a, b) {
  if (a.frontmost !== b.frontmost) return a.frontmost ? -1 : 1
  return a.name.localeCompare(b.name)
}))`)
  return JSON.parse(output)
}

async function getAppState(args: Record<string, unknown>) {
  await ensureAccessibilityTrusted()
  const app = String(args.app ?? "")
  if (!app) throw new Error("get_app_state requires app")
  const screenshot = args.include_screenshot !== false ? await capturePrimaryScreen().catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : null
  const output = await runJxa(`${scriptPrelude()}
var result = {
  app: { requested: __openAgentArg("app") },
  windows: [],
  errors: [],
  screenshot: ${JSON.stringify(screenshot)}
}
try {
  var process = activateProcess(__openAgentArg("app"))
  var state = { next: 0 }
  result.app = {
    requested: __openAgentArg("app"),
    name: scalar(safe(function() { return process.name() }, "")),
    bundleIdentifier: scalar(safe(function() { return process.bundleIdentifier() }, "")),
    frontmost: scalar(safe(function() { return process.frontmost() }, false)),
    visible: scalar(safe(function() { return process.visible() }, false))
  }
  result.windows = asArray(function() { return process.windows() }).map(function(win) {
    try {
      return readElement(win, state, 0, 6, 80)
    } catch (error) {
      result.errors.push(String(error))
      return null
    }
  }).filter(function(win) { return win !== null })
} catch (error) {
  result.errors.push(String(error))
}
JSON.stringify(result)`, { app })
  return JSON.parse(output)
}

async function capturePrimaryScreen(opts: { promptOnly?: boolean } = {}) {
  if (!opts.promptOnly) await ensureScreenRecordingAccess()
  const { desktopCapturer } = await import("electron")
  if (!desktopCapturer) {
    if (opts.promptOnly) return null
    throw new Error("Screen capture is only available inside the Electron desktop app.")
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1600, height: 1000 },
  })
  const source = sources[0]
  if (opts.promptOnly) return null
  if (!source || source.thumbnail.isEmpty()) return null
  const size = source.thumbnail.getSize()
  return {
    mimeType: "image/png",
    width: size.width,
    height: size.height,
    data: source.thumbnail.toDataURL(),
  }
}

async function elementAction(args: Record<string, unknown>, action: "click" | "secondary" | "set_value" | "scroll") {
  await ensureAccessibilityTrusted()
  const app = String(args.app ?? "")
  if (!app) throw new Error(`${action} requires app`)
  const elementIndex = String(args.element_index ?? args.element_id ?? "")
  const value = String(args.value ?? "")
  const secondary = String(args.action ?? "AXShowMenu")
  const direction = String(args.direction ?? "down")
  const output = await runJxa(`${scriptPrelude()}
var process = activateProcess(__openAgentArg("app"))
var element = findElement(process, __openAgentArg("elementIndex"))
var action = __openAgentArg("kind")
if (action === "click") {
  safe(function() { return element.actions.byName("AXPress").perform() }, null)
  if (safe(function() { return element.actions.byName("AXPress").name() }, "") === "") element.click()
} else if (action === "secondary") {
  var actionName = __openAgentArg("secondary")
  element.actions.byName(actionName).perform()
} else if (action === "set_value") {
  element.value = __openAgentArg("value")
} else if (action === "scroll") {
  var direction = __openAgentArg("direction")
  var actionMap = { up: "AXScrollUp", down: "AXScrollDown", left: "AXScrollLeft", right: "AXScrollRight" }
  var actionName = actionMap[direction] || "AXScrollDown"
  element.actions.byName(actionName).perform()
}
JSON.stringify({ ok: true })`, { app, elementIndex, kind: action, secondary, value, direction })
  return JSON.parse(output)
}

async function coordinateClick(args: Record<string, unknown>) {
  await ensureAccessibilityTrusted()
  const app = String(args.app ?? "")
  if (!app) throw new Error("click requires app")
  const x = Number(args.x)
  const y = Number(args.y)
  const clicks = Math.max(1, Number(args.click_count ?? 1) || 1)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click requires either element_index or x/y coordinates")
  const button = String(args.mouse_button ?? "left")
  const output = await runJxa(`${scriptPrelude()}
ObjC.import("ApplicationServices")
activateProcess(__openAgentArg("app"))
var x = Number(__openAgentArg("x"))
var y = Number(__openAgentArg("y"))
var clicks = Number(__openAgentArg("clicks"))
var buttonName = __openAgentArg("button")
var buttons = {
  left: { button: $.kCGMouseButtonLeft, down: $.kCGEventLeftMouseDown, up: $.kCGEventLeftMouseUp },
  right: { button: $.kCGMouseButtonRight, down: $.kCGEventRightMouseDown, up: $.kCGEventRightMouseUp },
  middle: { button: $.kCGMouseButtonCenter, down: $.kCGEventOtherMouseDown, up: $.kCGEventOtherMouseUp }
}
var info = buttons[buttonName] || buttons.left
var point = $.CGPointMake(x, y)
for (var i = 0; i < clicks; i++) {
  var down = $.CGEventCreateMouseEvent(null, info.down, point, info.button)
  var up = $.CGEventCreateMouseEvent(null, info.up, point, info.button)
  $.CGEventPost($.kCGHIDEventTap, down)
  $.CGEventPost($.kCGHIDEventTap, up)
}
JSON.stringify({ ok: true })`, { app, x: String(x), y: String(y), clicks: String(clicks), button })
  return JSON.parse(output)
}

async function coordinateDrag(args: Record<string, unknown>) {
  await ensureAccessibilityTrusted()
  const app = String(args.app ?? "")
  if (!app) throw new Error("drag requires app")
  const fromX = Number(args.from_x)
  const fromY = Number(args.from_y)
  const toX = Number(args.to_x)
  const toY = Number(args.to_y)
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
    throw new Error("drag requires from_x, from_y, to_x, and to_y coordinates")
  }
  const output = await runJxa(`${scriptPrelude()}
ObjC.import("ApplicationServices")
activateProcess(__openAgentArg("app"))
var fromX = Number(__openAgentArg("fromX"))
var fromY = Number(__openAgentArg("fromY"))
var toX = Number(__openAgentArg("toX"))
var toY = Number(__openAgentArg("toY"))
function post(type, x, y) {
  var event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), $.kCGMouseButtonLeft)
  $.CGEventPost($.kCGHIDEventTap, event)
}
post($.kCGEventLeftMouseDown, fromX, fromY)
for (var i = 1; i <= 12; i++) {
  var t = i / 12
  post($.kCGEventLeftMouseDragged, fromX + ((toX - fromX) * t), fromY + ((toY - fromY) * t))
  delay(0.01)
}
post($.kCGEventLeftMouseUp, toX, toY)
JSON.stringify({ ok: true })`, {
    app,
    fromX: String(fromX),
    fromY: String(fromY),
    toX: String(toX),
    toY: String(toY),
  })
  return JSON.parse(output)
}

async function typeText(args: Record<string, unknown>) {
  await ensureAccessibilityTrusted()
  const text = String(args.text ?? "")
  const app = String(args.app ?? "")
  if (!app) throw new Error("type_text requires app")
  const output = await runJxa(`${scriptPrelude()}
activateProcess(__openAgentArg("app"))
Application("System Events").keystroke(__openAgentArg("text"))
JSON.stringify({ ok: true })`, { app, text })
  return JSON.parse(output)
}

async function pressKey(args: Record<string, unknown>) {
  await ensureAccessibilityTrusted()
  const key = String(args.key ?? "")
  const app = String(args.app ?? "")
  if (!app) throw new Error("press_key requires app")
  const output = await runJxa(`${scriptPrelude()}
activateProcess(__openAgentArg("app"))
var system = Application("System Events")
var raw = __openAgentArg("key")
var parts = raw.split("+").map(function(part) { return part.trim().toLowerCase() }).filter(Boolean)
var key = parts.length ? parts[parts.length - 1] : raw
var modifiers = []
if (parts.indexOf("cmd") >= 0 || parts.indexOf("command") >= 0) modifiers.push("command down")
if (parts.indexOf("shift") >= 0) modifiers.push("shift down")
if (parts.indexOf("alt") >= 0 || parts.indexOf("option") >= 0) modifiers.push("option down")
if (parts.indexOf("ctrl") >= 0 || parts.indexOf("control") >= 0) modifiers.push("control down")
if (key.length === 1) {
  if (modifiers.length) system.keystroke(key, { using: modifiers })
  else system.keystroke(key)
} else {
  var codes = { return: 36, enter: 36, tab: 48, escape: 53, esc: 53, delete: 51, backspace: 51, space: 49, up: 126, down: 125, left: 123, right: 124 }
  if (!(key in codes)) throw new Error("Unsupported key: " + raw)
  if (modifiers.length) system.keyCode(codes[key], { using: modifiers })
  else system.keyCode(codes[key])
}
JSON.stringify({ ok: true })`, { app, key })
  return JSON.parse(output)
}

function unsupported(tool: string) {
  return {
    isError: true,
    error: `${tool} requires the native Swift CGEvent bridge, which is not included in this TypeScript bridge yet. Element-based click, scroll, set_value, type_text, press_key, list_apps, and get_app_state are available.`,
  }
}

async function handleBridgeRequest(input: BridgeRequest) {
  const args = input.arguments ?? {}
  switch (input.tool) {
    case "list_apps":
      return { result: await listApps() }
    case "get_app_state":
      return { result: await getAppState(args) }
    case "click":
      return { result: args.element_index || args.element_id ? await elementAction(args, "click") : await coordinateClick(args) }
    case "perform_secondary_action":
      return { result: await elementAction(args, "secondary") }
    case "set_value":
      return { result: await elementAction(args, "set_value") }
    case "scroll":
      return { result: await elementAction(args, "scroll") }
    case "type_text":
      return { result: await typeText(args) }
    case "press_key":
      return { result: await pressKey(args) }
    case "drag":
      return { result: await coordinateDrag(args) }
    default:
      return { isError: true, error: `Unknown Computer Use tool: ${input.tool}` }
  }
}

export async function startComputerUseBridge(): Promise<ComputerUseBridge> {
  const token = randomUUID()
  const server = createServer(async (req, res) => {
    const send = (response: ReturnType<typeof json>) => {
      res.writeHead(response.status, response.headers)
      res.end(response.body)
    }

    if (req.method !== "POST" || req.url !== "/tool") {
      send(json(404, { error: "Not found" }))
      return
    }

    if (req.headers.authorization !== `Bearer ${token}`) {
      send(json(401, { error: "Unauthorized" }))
      return
    }

    try {
      const body = await readBody(req)
      const payload = JSON.parse(body) as BridgeRequest
      send(json(200, await handleBridgeRequest(payload)))
    } catch (error) {
      send(json(500, { isError: true, error: error instanceof Error ? error.message : String(error) }))
    }
  })

  await listenOnLoopback(server)
  void requestInitialComputerUsePermissions().catch(() => undefined)

  const address = server.address()
  if (!address || typeof address === "string") {
    await closeServer(server)
    throw new Error("Failed to start Computer Use bridge")
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () => closeServer(server),
  }
}

async function listenOnLoopback(server: Server) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 45_000 + Math.floor(Math.random() * 10_000)
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening)
          reject(error)
        }
        const onListening = () => {
          server.off("error", onError)
          resolve()
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen({ port, host: "127.0.0.1" })
      })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    }
  }
  throw new Error("Failed to find a free port for Computer Use bridge")
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
