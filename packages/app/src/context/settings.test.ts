import { describe, expect, test } from "bun:test"
import { PersistTesting } from "@/utils/persist"
import { SettingsTesting } from "./settings"

describe("settings migration", () => {
  test("keeps queue follow-up behavior enabled", () => {
    expect(SettingsTesting.defaults.general.followup).toBe("queue")

    const normalized = PersistTesting.normalize(
      SettingsTesting.defaults,
      JSON.stringify({
        general: {
          followup: "queue",
        },
      }),
      SettingsTesting.migrate,
    )

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!).general.followup).toBe("queue")
  })

  test("migrates legacy apple speech selections to parakeet", () => {
    const normalized = PersistTesting.normalize(
      SettingsTesting.defaults,
      JSON.stringify({
        voice: {
          model: "apple-speech",
          quality: "accurate",
        },
      }),
      SettingsTesting.migrate,
    )

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!).voice.model).toBe("parakeet-tdt-v3")
    expect(JSON.parse(normalized!).voice.quality).toBe("accurate")
  })

  test("keeps existing parakeet selections unchanged", () => {
    const normalized = PersistTesting.normalize(
      SettingsTesting.defaults,
      JSON.stringify({
        voice: {
          model: "parakeet-tdt-v2",
          quality: "fast",
        },
      }),
      SettingsTesting.migrate,
    )

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!).voice.model).toBe("parakeet-tdt-v2")
  })

  test("migrates legacy voice preset controls to numeric sliders", () => {
    const normalized = PersistTesting.normalize(
      SettingsTesting.defaults,
      JSON.stringify({
        voice: {
          vadSensitivity: "high",
          inputGain: "max",
        },
      }),
      SettingsTesting.migrate,
    )

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!).voice.vadSensitivity).toBe(75)
    expect(JSON.parse(normalized!).voice.inputGain).toBe(6)
  })

  test("clamps numeric voice slider values", () => {
    const normalized = PersistTesting.normalize(
      SettingsTesting.defaults,
      JSON.stringify({
        voice: {
          vadSensitivity: 200,
          inputGain: 0,
        },
      }),
      SettingsTesting.migrate,
    )

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!).voice.vadSensitivity).toBe(100)
    expect(JSON.parse(normalized!).voice.inputGain).toBe(1)
  })
})
