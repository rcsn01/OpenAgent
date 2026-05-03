# Post-Processing and Text Quality

## Overview

Raw ASR output often makes mistakes with:
- Technical terms and proper nouns
- Casing preferences
- Recurring misrecognitions (e.g., "codax" → "Codex")

The post-processing layer fixes these before inserting into the prompt.

## Dictionary

Users define preferred terms in voice settings. Terms are parsed from comma/newline-separated input:

```ts
export const parseVoiceDictionary = (value: string) =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
```

Example input:
```
OpenAI
WhisperKit
TypeScript
```

### Two Uses of Dictionary

1. **Prompt terms** — fed into transcription engines as hints:
   ```ts
   promptTerms = [...parseVoiceDictionary(dictionary), ...correctionTargets]
   ```
2. **Casing normalization** — replaces case-insensitive matches with preferred casing:
   ```ts
   parseVoiceDictionary(dictionary).reduce(
     (value, item) => replacePhrase(value, item, item),
     corrected
   )
   ```

The normalization uses word boundary regex:
```ts
new RegExp(`\\b${tokens.map(escapeRegex).join("[\\s_-]*")}\\b`, "gi")
```

This allows matching variants like "open ai" → "OpenAI" or "whisper kit" → "WhisperKit".

## Corrections

Rule-based substitutions applied before dictionary normalization.

Format:
```
codax => Codex
open code => OpenCode
sonnet => Sonnet
```

Rules are parsed as:
```ts
const match = item.match(/^(.*?)\s*(?:=>|-\u003e)\s*(.+)$/)
```

### Application Order

Corrections run first, then dictionary normalization:

```ts
corrected = parseVoiceCorrections(corrections).reduce(
  (value, item) => replacePhrase(value, item.from, item.to),
  trimmed
)

final = parseVoiceDictionary(dictionary).reduce(
  (value, item) => replacePhrase(value, item, item),
  corrected
)
```

This means corrections can normalize the transcript before dictionary casing is applied.

## Prompt Term Extraction

Terms fed into engines combine:
1. Dictionary entries
2. Correction targets (the `to` side of rules)
3. Deduplicated by lowercase comparison

```ts
export const getVoicePromptTerms = (input: { dictionary: string; corrections: string }) => {
  const seen = new Set<string>()
  return [
    ...parseVoiceDictionary(input.dictionary),
    ...parseVoiceCorrections(input.corrections).map((item) => item.to),
  ].filter((item) => {
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
```

## Prompt Application

The processed transcript is appended to the prompt in `voice-prompt.ts`:

```ts
export function applyVoiceTranscript(basePrompt: Prompt, transcript: string): Prompt {
  const images = basePrompt.filter((part) => part.type === "image")
  const content = clonePromptParts(basePrompt.filter((part) => part.type !== "image"))

  // Append to last text part if one exists
  if (last?.type === "text") {
    last.content = `${last.content}${needsSeparator(last.content, nextTranscript) ? " " : ""}${nextTranscript}`
  } else {
    content.push({ type: "text", content: nextTranscript, start: 0, end: nextTranscript.length })
  }

  // Update positions
  // Re-append images after text
}
```

### Smart Space Insertion

```ts
const needsSeparator = (value: string, transcript: string) => {
  if (!value) return false
  if (!transcript) return false
  if (/\s$/.test(value)) return false        // existing ends with whitespace — no space needed
  if (/^[,.;:!?)]/.test(transcript)) return false  // new starts with punctuation — no space needed
  return true
}
```

### Image Preservation

Images and file parts are preserved in their original positions. Only text parts are modified.

## Test Coverage

`voice-postprocess.test.ts` verifies:
- Dictionary normalizes casing: "open ai, whisperkit" → "OpenAI, WhisperKit"
- Corrections apply before dictionary normalization
- Prompt terms extract both dictionary and correction targets
- Defensive parsing of malformed rules (duplicates, invalid format)

`voice-prompt.test.ts` verifies:
- Appending to trailing text
- Preserving non-text parts (images, files)
- Correct position recalculation after append
