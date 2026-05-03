import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4197"
const runtimeRoot = process.env.PLAYWRIGHT_RUNTIME_ROOT ?? path.resolve(process.cwd(), "e2e/.playwright-runtime")
const modelsPath =
  process.env.PLAYWRIGHT_MODELS_PATH ??
  path.resolve(process.cwd(), "../opencode/test/tool/fixtures/models-api.json")
const quote = (value: string) => JSON.stringify(value)
const backendCommand = [
  `rm -rf ${quote(runtimeRoot)}`,
  `mkdir -p ${quote(path.join(runtimeRoot, "home"))}`,
  `mkdir -p ${quote(path.join(runtimeRoot, "config"))}`,
  `mkdir -p ${quote(path.join(runtimeRoot, "state"))}`,
  `mkdir -p ${quote(path.join(runtimeRoot, "data"))}`,
  `cd ${quote(path.resolve(process.cwd(), "../opencode"))} && bun run --conditions=browser ./src/index.ts serve --pure --hostname ${serverHost} --port ${serverPort}`,
].join(" && ")
const command = `cd ${quote(process.cwd())} && bunx vite --host ${serverHost} --port ${port}`
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? 1) || 1
const reporter = [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]] as const

if (process.env.PLAYWRIGHT_JUNIT_OUTPUT) {
  reporter.push(["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT }])
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter,
  webServer: [
    {
      command: backendCommand,
      url: `http://${serverHost}:${serverPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        HOME: path.join(runtimeRoot, "home"),
        XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
        XDG_STATE_HOME: path.join(runtimeRoot, "state"),
        XDG_DATA_HOME: path.join(runtimeRoot, "data"),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "opencode/big-pickle" }),
        OPENCODE_MODELS_PATH: modelsPath,
      },
    },
    {
      command,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_OPENCODE_SERVER_HOST: serverHost,
        VITE_OPENCODE_SERVER_PORT: serverPort,
      },
    },
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
