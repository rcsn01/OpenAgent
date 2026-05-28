const vite = Bun.spawn({
  cmd: ["bun", "--cwd", "packages/app", "dev"],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    vite.kill(signal)
  })
}

process.exit(await vite.exited)
