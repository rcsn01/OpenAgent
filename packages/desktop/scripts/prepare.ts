#!/usr/bin/env bun

await import("./prebuild")

const pkg = await Bun.file("./package.json").json()
pkg.version = process.env.OPENCODE_VERSION ?? pkg.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${pkg.version}`)
