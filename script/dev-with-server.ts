import { spawn, type ChildProcess } from "node:child_process"

const target = process.argv[2]
if (target !== "web" && target !== "desktop") {
  console.error("Usage: bun run script/dev-with-server.ts <web|desktop>")
  process.exit(1)
}

const hostname = process.env.OPENAGENT_SERVER_HOST || "127.0.0.1"
const port = process.env.OPENAGENT_SERVER_PORT || "4096"
const url = `http://${hostname}:${port}`
const healthUrl = new URL("/global/health", url)

async function healthy() {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1_000),
    })
    return response.ok
  } catch {
    return false
  }
}

const detached = process.platform !== "win32"

function start(command: string, args: string[], env = process.env) {
  return spawn(command, args, {
    detached,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
}

function running(child: ChildProcess | undefined) {
  return child?.exitCode === null && child.signalCode === null
}

function stop(child: ChildProcess | undefined, signal: NodeJS.Signals) {
  if (!running(child)) return
  try {
    if (detached && child?.pid) {
      process.kill(-child.pid, signal)
      return
    }
  } catch {}
  child?.kill(signal)
}

function exited(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise<number>((resolve) => {
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    child.once("error", () => resolve(1))
  })
}

let server: ChildProcess | undefined

if (!(await healthy())) {
  server = start(process.env.OPENCODE_BIN_PATH || "opencode", ["serve", "--hostname", hostname, "--port", port])

  for (let attempt = 0; attempt < 100; attempt++) {
    if (await healthy()) break
    if (server.exitCode !== null) {
      process.exit(await exited(server))
    }
    await Bun.sleep(100)
  }

  if (!(await healthy())) {
    stop(server, "SIGTERM")
    console.error(`opencode did not become healthy at ${healthUrl}`)
    process.exit(1)
  }
}

const clientCommand =
  target === "web" ? ["bun", "--cwd", "packages/app", "dev"] : ["bun", "--cwd", "packages/desktop", "dev"]

const client = start(clientCommand[0], clientCommand.slice(1), {
  ...process.env,
  ...(target === "web"
    ? {
        VITE_OPENCODE_SERVER_URL: url,
        VITE_OPENCODE_SERVER_HOST: hostname,
      }
    : {
        OPENAGENT_SERVER_URL: url,
      }),
})

let interruptedExitCode: number | undefined
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interruptedExitCode ??= signal === "SIGINT" ? 130 : 143
    stop(client, "SIGTERM")
    stop(server, "SIGTERM")
    setTimeout(() => {
      stop(client, "SIGKILL")
      stop(server, "SIGKILL")
      process.exit(interruptedExitCode)
    }, 2_000).unref()
  })
}

const code = await exited(client)
if (running(server)) {
  stop(server, "SIGTERM")
  await Promise.race([exited(server!), Bun.sleep(2_000)])
  stop(server, "SIGKILL")
}

process.exit(interruptedExitCode ?? code)
