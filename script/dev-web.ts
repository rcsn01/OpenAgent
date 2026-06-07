const server = Bun.spawn({
  cmd: [process.env.OPENCODE_BIN_PATH || "opencode", "server", "start", "--json"],
  stdout: "pipe",
  stderr: "inherit",
})

const output = await new Response(server.stdout).text()
const code = await server.exited
if (code !== 0) process.exit(code)

const metadata = JSON.parse(
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? output,
) as { url: string; username?: string; password?: string }
const authToken = metadata.password
  ? Buffer.from(`${metadata.username || "opencode"}:${metadata.password}`).toString("base64")
  : undefined
const vite = Bun.spawn({
  cmd: ["bun", "--cwd", "packages/app", "dev"],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    VITE_OPENCODE_SERVER_URL: process.env.VITE_OPENCODE_SERVER_URL || metadata.url,
    ...(process.env.VITE_OPENCODE_AUTH_TOKEN || !authToken
      ? {}
      : {
          VITE_OPENCODE_AUTH_TOKEN: authToken,
        }),
    VITE_OPENCODE_SERVER_HOST: process.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1",
  },
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    vite.kill(signal)
  })
}

process.exit(await vite.exited)
