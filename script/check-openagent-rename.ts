import { lstatSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const scanRoots = [
  "package.json",
  "packages/openagent/package.json",
  "packages/openagent/src",
  "packages/app/src",
  "packages/desktop/src",
  "packages/desktop/scripts",
  "packages/desktop/electron-builder.config.ts",
  "packages/slack",
  "packages/ui/src",
]

const skipped = new Set([
  ".git",
  ".turbo",
  ".sst",
  "node_modules",
  "dist",
  "out",
  ".build",
  ".artifacts",
])

const binary = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".icns",
  ".zip",
  ".gz",
  ".tgz",
  ".db",
  ".sqlite",
  ".wasm",
  ".node",
  ".lockb",
])

const banned = [
  /\bOPENCODE_[A-Z0-9_]+\b/,
  /\bx-opencode-[a-z0-9-]+\b/i,
  /\bopencode:\/\//i,
  /(^|[/"'`])\.opencode\b/i,
  /\bopencode\.(jsonc?|db)\b/i,
  /\bopencode\.ai\b/i,
  /\bopencode-desktop\b/i,
  /\bopencode-(dev|beta)\b/i,
  /OPENAGENT_SERVER_USERNAME or 'opencode'/,
  /\?\? "opencode"/,
  /withDefault\("opencode"\)/,
]

const allowlistedFiles = [
  /(^|\/)packages\/openagent\/src\/pi\/model-registry\.ts$/,
  /(^|\/)packages\/openagent\/src\/provider\/(provider|schema|transform)\.ts$/,
  /(^|\/)packages\/openagent\/src\/provider\/models-snapshot\.js$/,
  /(^|\/)packages\/openagent\/src\/tool\/registry\.ts$/,
  /(^|\/)packages\/openagent\/test\/tool\/fixtures\/models-api\.json$/,
  /(^|\/)packages\/ui\/src\/components\/provider-icons\//,
  /(^|\/)packages\/core\/src\/plugin\/provider\/opencode\.ts$/,
  /(^|\/)packages\/core\/test\/plugin\/provider-opencode\.test\.ts$/,
]

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (skipped.has(entry)) continue
    const full = path.join(dir, entry)
    const rel = path.relative(root, full)
    if (rel === "packages/opencode" || rel.startsWith("packages/opencode/")) continue
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) yield* files(full)
    else if (!binary.has(path.extname(entry).toLowerCase())) yield full
  }
}

const failures: string[] = []

for (const scanRoot of scanRoots) {
  const fullRoot = path.join(root, scanRoot)
  const scanFiles = lstatSync(fullRoot).isDirectory() ? files(fullRoot) : [fullRoot]
  for (const file of scanFiles) {
  const rel = path.relative(root, file)
  const text = readFileSync(file, "utf8")
  const allowedProviderFile = allowlistedFiles.some((pattern) => pattern.test(rel))
  if (allowedProviderFile) continue
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const pattern of banned) {
      if (!pattern.test(line)) continue
      failures.push(`${rel}:${index + 1}: ${line.trim()}`)
      break
    }
  })
  }
}

if (failures.length) {
  console.error("Found legacy opencode rename residues outside the allowlist:\n")
  console.error(failures.slice(0, 200).join("\n"))
  if (failures.length > 200) console.error(`...and ${failures.length - 200} more`)
  process.exit(1)
}

console.log("OpenAgent rename guard passed")
