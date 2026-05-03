import { createStore, reconcile } from "solid-js/store"
import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { persisted } from "@/utils/persist"
import type { SpeechModelID, SpeechTranscriptionQuality } from "./platform"

export type VoiceInputGain = "normal" | "boost" | "max"

export interface NotificationSettings {
  agent: boolean
  permissions: boolean
  errors: boolean
}

export interface SoundSettings {
  agentEnabled: boolean
  agent: string
  permissionsEnabled: boolean
  permissions: string
  errorsEnabled: boolean
  errors: string
}

export interface VoiceSettings {
  baseSilenceMs: number
  maxSilenceMs: number
  vadSensitivity: "low" | "normal" | "high"
  inputGain: VoiceInputGain
  dictionary: string
  corrections: string
  model: SpeechModelID
  quality: SpeechTranscriptionQuality
  audioProcessing: boolean
  pressToTalkKeybind: string
}

export interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    showMessageTimestamps: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showSessionProgressBar: boolean
  }
  updates: {
    startup: boolean
  }
  appearance: {
    fontSize: number
    mono: string
    sans: string
    terminal: string
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  voice: VoiceSettings
  notifications: NotificationSettings
  sounds: SoundSettings
}

export const monoDefault = "System Mono"
export const sansDefault = "System Sans"
export const terminalDefault = "JetBrainsMono Nerd Font Mono"

const monoFallback =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const sansFallback = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const terminalFallback =
  '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const monoBase = monoFallback
const sansBase = sansFallback
const terminalBase = terminalFallback
const defaultVoiceBaseSilenceMs = 1200
const defaultVoiceMaxSilenceMs = 3200

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function input(font: string | undefined) {
  return font ?? ""
}

function family(font: string) {
  if (/^[\w-]+$/.test(font)) return font
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function stack(font: string | undefined, base: string) {
  const value = font?.trim() ?? ""
  if (!value) return base
  return `${family(value)}, ${base}`
}

export function monoInput(font: string | undefined) {
  return input(font)
}

export function sansInput(font: string | undefined) {
  return input(font)
}

export function monoFontFamily(font: string | undefined) {
  return stack(font, monoBase)
}

export function sansFontFamily(font: string | undefined) {
  return stack(font, sansBase)
}

export function terminalInput(font: string | undefined) {
  return input(font)
}

export function terminalFontFamily(font: string | undefined) {
  return stack(font, terminalBase)
}

const defaultSettings: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    followup: "steer",
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showStatus: false,
    showTerminal: false,
    showReasoningSummaries: false,
    showMessageTimestamps: false,
    shellToolPartsExpanded: false,
    editToolPartsExpanded: false,
    showSessionProgressBar: true,
  },
  updates: {
    startup: true,
  },
  appearance: {
    fontSize: 14,
    mono: "",
    sans: "",
    terminal: "",
  },
  keybinds: {},
  permissions: {
    autoApprove: false,
  },
  voice: {
    baseSilenceMs: defaultVoiceBaseSilenceMs,
    maxSilenceMs: defaultVoiceMaxSilenceMs,
    vadSensitivity: "normal",
    inputGain: "boost",
    dictionary: "",
    corrections: "",
    model: "parakeet-tdt-v3",
    quality: "fast",
    audioProcessing: true,
    pressToTalkKeybind: "f6",
  },
  notifications: {
    agent: true,
    permissions: true,
    errors: false,
  },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

function migrateSettings(value: unknown) {
  if (!record(value)) return value
  if (!record(value.voice)) return value
  if (value.voice.model !== "apple-speech") return value
  return {
    ...value,
    voice: {
      ...value.voice,
      model: "parakeet-tdt-v3",
    },
  }
}

export const SettingsTesting = {
  defaults: defaultSettings,
  migrate: migrateSettings,
}

function withFallback<T>(read: () => T | undefined, fallback: T) {
  return createMemo(() => read() ?? fallback)
}

export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
  name: "Settings",
  init: () => {
    const [store, setStore, _, ready] = persisted({ key: "settings.v3", migrate: migrateSettings }, createStore<Settings>(defaultSettings))

    createEffect(() => {
      if (typeof document === "undefined") return
      const root = document.documentElement
      root.style.setProperty("--font-family-mono", monoFontFamily(store.appearance?.mono))
      root.style.setProperty("--font-family-sans", sansFontFamily(store.appearance?.sans))
    })

    createEffect(() => {
      if (store.general?.followup !== "queue") return
      setStore("general", "followup", "steer")
    })

    createEffect(() => {
      if ((store.voice?.baseSilenceMs ?? defaultVoiceBaseSilenceMs) > 650) return
      if ((store.voice?.maxSilenceMs ?? defaultVoiceMaxSilenceMs) > 1800) return
      setStore("voice", "baseSilenceMs", defaultVoiceBaseSilenceMs)
      setStore("voice", "maxSilenceMs", defaultVoiceMaxSilenceMs)
    })

    createEffect(() => {
      if ((store.voice?.baseSilenceMs ?? defaultVoiceBaseSilenceMs) !== 1600) return
      if ((store.voice?.maxSilenceMs ?? defaultVoiceMaxSilenceMs) !== 4200) return
      setStore("voice", "baseSilenceMs", 2600)
      setStore("voice", "maxSilenceMs", 8000)
    })

    return {
      ready,
      get current() {
        return store
      },
      general: {
        autoSave: withFallback(() => store.general?.autoSave, defaultSettings.general.autoSave),
        setAutoSave(value: boolean) {
          setStore("general", "autoSave", value)
        },
        releaseNotes: withFallback(() => store.general?.releaseNotes, defaultSettings.general.releaseNotes),
        setReleaseNotes(value: boolean) {
          setStore("general", "releaseNotes", value)
        },
        followup: withFallback(
          () => (store.general?.followup === "queue" ? "steer" : store.general?.followup),
          defaultSettings.general.followup,
        ),
        setFollowup(value: "queue" | "steer") {
          setStore("general", "followup", value === "queue" ? "steer" : value)
        },
        showFileTree: withFallback(() => store.general?.showFileTree, defaultSettings.general.showFileTree),
        setShowFileTree(value: boolean) {
          setStore("general", "showFileTree", value)
        },
        showNavigation: withFallback(() => store.general?.showNavigation, defaultSettings.general.showNavigation),
        setShowNavigation(value: boolean) {
          setStore("general", "showNavigation", value)
        },
        showSearch: withFallback(() => store.general?.showSearch, defaultSettings.general.showSearch),
        setShowSearch(value: boolean) {
          setStore("general", "showSearch", value)
        },
        showStatus: withFallback(() => store.general?.showStatus, defaultSettings.general.showStatus),
        setShowStatus(value: boolean) {
          setStore("general", "showStatus", value)
        },
        showTerminal: withFallback(() => store.general?.showTerminal, defaultSettings.general.showTerminal),
        setShowTerminal(value: boolean) {
          setStore("general", "showTerminal", value)
        },
        showReasoningSummaries: withFallback(
          () => store.general?.showReasoningSummaries,
          defaultSettings.general.showReasoningSummaries,
        ),
        setShowReasoningSummaries(value: boolean) {
          setStore("general", "showReasoningSummaries", value)
        },
        showMessageTimestamps: withFallback(
          () => store.general?.showMessageTimestamps,
          defaultSettings.general.showMessageTimestamps,
        ),
        setShowMessageTimestamps(value: boolean) {
          setStore("general", "showMessageTimestamps", value)
        },
        shellToolPartsExpanded: withFallback(
          () => store.general?.shellToolPartsExpanded,
          defaultSettings.general.shellToolPartsExpanded,
        ),
        setShellToolPartsExpanded(value: boolean) {
          setStore("general", "shellToolPartsExpanded", value)
        },
        editToolPartsExpanded: withFallback(
          () => store.general?.editToolPartsExpanded,
          defaultSettings.general.editToolPartsExpanded,
        ),
        setEditToolPartsExpanded(value: boolean) {
          setStore("general", "editToolPartsExpanded", value)
        },
        showSessionProgressBar: withFallback(
          () => store.general?.showSessionProgressBar,
          defaultSettings.general.showSessionProgressBar,
        ),
        setShowSessionProgressBar(value: boolean) {
          setStore("general", "showSessionProgressBar", value)
        },
      },
      updates: {
        startup: withFallback(() => store.updates?.startup, defaultSettings.updates.startup),
        setStartup(value: boolean) {
          setStore("updates", "startup", value)
        },
      },
      appearance: {
        fontSize: withFallback(() => store.appearance?.fontSize, defaultSettings.appearance.fontSize),
        setFontSize(value: number) {
          setStore("appearance", "fontSize", value)
        },
        font: withFallback(() => store.appearance?.mono, defaultSettings.appearance.mono),
        setFont(value: string) {
          setStore("appearance", "mono", value.trim() ? value : "")
        },
        uiFont: withFallback(() => store.appearance?.sans, defaultSettings.appearance.sans),
        setUIFont(value: string) {
          setStore("appearance", "sans", value.trim() ? value : "")
        },
        terminalFont: withFallback(() => store.appearance?.terminal, defaultSettings.appearance.terminal),
        setTerminalFont(value: string) {
          setStore("appearance", "terminal", value.trim() ? value : "")
        },
      },
      keybinds: {
        get: (action: string) => store.keybinds?.[action],
        set(action: string, keybind: string) {
          setStore("keybinds", action, keybind)
        },
        reset(action: string) {
          setStore("keybinds", (current) => {
            if (!Object.prototype.hasOwnProperty.call(current, action)) return current
            const next = { ...current }
            delete next[action]
            return next
          })
        },
        resetAll() {
          setStore("keybinds", reconcile({}))
        },
      },
      permissions: {
        autoApprove: withFallback(() => store.permissions?.autoApprove, defaultSettings.permissions.autoApprove),
        setAutoApprove(value: boolean) {
          setStore("permissions", "autoApprove", value)
        },
      },
      voice: {
        model: withFallback(() => store.voice?.model, defaultSettings.voice.model),
        setModel(value: SpeechModelID) {
          setStore("voice", "model", value)
        },
        quality: withFallback(() => store.voice?.quality, defaultSettings.voice.quality),
        setQuality(value: SpeechTranscriptionQuality) {
          setStore("voice", "quality", value)
        },
        inputGain: withFallback(() => store.voice?.inputGain, defaultSettings.voice.inputGain),
        setInputGain(value: VoiceInputGain) {
          setStore("voice", "inputGain", value)
        },
        dictionary: withFallback(() => store.voice?.dictionary, defaultSettings.voice.dictionary),
        setDictionary(value: string) {
          setStore("voice", "dictionary", value)
        },
        corrections: withFallback(() => store.voice?.corrections, defaultSettings.voice.corrections),
        setCorrections(value: string) {
          setStore("voice", "corrections", value)
        },
        audioProcessing: withFallback(
          () => store.voice?.audioProcessing,
          defaultSettings.voice.audioProcessing,
        ),
        setAudioProcessing(value: boolean) {
          setStore("voice", "audioProcessing", value)
        },
        pressToTalkKeybind: withFallback(
          () => store.voice?.pressToTalkKeybind,
          defaultSettings.voice.pressToTalkKeybind,
        ),
        setPressToTalkKeybind(value: string) {
          setStore("voice", "pressToTalkKeybind", value)
        },
        baseSilenceMs: withFallback(() => store.voice?.baseSilenceMs, defaultSettings.voice.baseSilenceMs),
        setBaseSilenceMs(value: number) {
          setStore("voice", "baseSilenceMs", value)
        },
        maxSilenceMs: withFallback(() => store.voice?.maxSilenceMs, defaultSettings.voice.maxSilenceMs),
        setMaxSilenceMs(value: number) {
          setStore("voice", "maxSilenceMs", value)
        },
        vadSensitivity: withFallback(() => store.voice?.vadSensitivity, defaultSettings.voice.vadSensitivity),
        setVadSensitivity(value: VoiceSettings["vadSensitivity"]) {
          setStore("voice", "vadSensitivity", value)
        },
      },
      notifications: {
        agent: withFallback(() => store.notifications?.agent, defaultSettings.notifications.agent),
        setAgent(value: boolean) {
          setStore("notifications", "agent", value)
        },
        permissions: withFallback(() => store.notifications?.permissions, defaultSettings.notifications.permissions),
        setPermissions(value: boolean) {
          setStore("notifications", "permissions", value)
        },
        errors: withFallback(() => store.notifications?.errors, defaultSettings.notifications.errors),
        setErrors(value: boolean) {
          setStore("notifications", "errors", value)
        },
      },
      sounds: {
        agentEnabled: withFallback(() => store.sounds?.agentEnabled, defaultSettings.sounds.agentEnabled),
        setAgentEnabled(value: boolean) {
          setStore("sounds", "agentEnabled", value)
        },
        agent: withFallback(() => store.sounds?.agent, defaultSettings.sounds.agent),
        setAgent(value: string) {
          setStore("sounds", "agent", value)
        },
        permissionsEnabled: withFallback(
          () => store.sounds?.permissionsEnabled,
          defaultSettings.sounds.permissionsEnabled,
        ),
        setPermissionsEnabled(value: boolean) {
          setStore("sounds", "permissionsEnabled", value)
        },
        permissions: withFallback(() => store.sounds?.permissions, defaultSettings.sounds.permissions),
        setPermissions(value: string) {
          setStore("sounds", "permissions", value)
        },
        errorsEnabled: withFallback(() => store.sounds?.errorsEnabled, defaultSettings.sounds.errorsEnabled),
        setErrorsEnabled(value: boolean) {
          setStore("sounds", "errorsEnabled", value)
        },
        errors: withFallback(() => store.sounds?.errors, defaultSettings.sounds.errors),
        setErrors(value: string) {
          setStore("sounds", "errors", value)
        },
      },
    }
  },
})
