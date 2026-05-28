import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

async function signWindows(_configuration: { path: string }) {
  return
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (): Configuration => ({
  artifactName: "opencode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: [
        "index.js",
        "index.d.ts",
        "build/Release/mac_window.node",
        "swift-build/**",
        "voice-capture-macos.swift",
        "apple-speech-transcribe.swift",
      ],
    },
    {
      from: "resources/speech/",
      to: "speech/",
      filter: ["**/*"],
    },
    {
      from: "../server/dist/",
      to: "openagent-server/",
      filter: ["openagent-server*"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    extendInfo: {
      NSMicrophoneUsageDescription: "OpenAgent uses microphone access for hands-free local voice input.",
      NSSpeechRecognitionUsageDescription: "OpenAgent uses speech recognition for native local voice transcription.",
      NSAppleEventsUsageDescription: "OpenAgent uses Apple Events to inspect and control local apps when Computer Use is enabled.",
    },
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "OpenAgent",
    schemes: ["opencode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.opencode.desktop.dev",
        productName: "OpenAgent Dev",
        rpm: { packageName: "opencode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.opencode.desktop.beta",
        productName: "OpenAgent Beta",
        protocols: { name: "OpenAgent Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "rcsn01", repo: "OpenAgent", channel: "latest" },
        rpm: { packageName: "opencode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.opencode.desktop",
        productName: "OpenAgent",
        protocols: { name: "OpenAgent", schemes: ["opencode"] },
        publish: { provider: "github", owner: "rcsn01", repo: "OpenAgent", channel: "latest" },
        rpm: { packageName: "opencode" },
      }
    }
  }
}

export default getConfig()
