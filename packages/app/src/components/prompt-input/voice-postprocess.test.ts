import { describe, expect, test } from "bun:test"
import {
  getVoicePromptTerms,
  parseVoiceCorrections,
  parseVoiceDictionary,
  postprocessVoiceTranscript,
} from "./voice-postprocess"

describe("voice postprocess", () => {
  test("normalizes dictionary terms with preferred casing", () => {
    expect(
      postprocessVoiceTranscript("please use whisper kit with open ai", {
        dictionary: "WhisperKit\nOpenAI",
        corrections: "",
      }),
    ).toBe("please use WhisperKit with OpenAI")
  })

  test("applies explicit correction rules before dictionary cleanup", () => {
    expect(
      postprocessVoiceTranscript("run sonnet on open code", {
        dictionary: "OpenCode",
        corrections: "sonnet => Sonnet",
      }),
    ).toBe("run Sonnet on OpenCode")
  })

  test("parses settings text defensively", () => {
    expect(parseVoiceDictionary("OpenAI, OpenAI\nWhisperKit")).toEqual(["OpenAI", "WhisperKit"])
    expect(parseVoiceCorrections("codax => Codex\ninvalid rule\nsonnet -> Sonnet")).toEqual([
      { from: "codax", to: "Codex" },
      { from: "sonnet", to: "Sonnet" },
    ])
  })

  test("builds prompt terms from dictionary and correction targets", () => {
    expect(
      getVoicePromptTerms({
        dictionary: "OpenAI\nWhisperKit",
        corrections: "codax => Codex\nopen ai => OpenAI",
      }),
    ).toEqual(["OpenAI", "WhisperKit", "Codex"])
  })
})
