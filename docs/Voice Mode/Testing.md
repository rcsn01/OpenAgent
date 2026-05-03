# Voice Mode Testing

## Renderer Tests

### `voice-endpoint.test.ts`

What it covers:
- **Filler detection**: Ending with "uh", "um", "er" increases hold time by 1000 ms over a normal ending
- **Completion detection**: Ending with punctuation or completion words ("done", "finished") submits faster than connector words ("and", "but")
- **Dual gates**: Both `transcriptStableMs` and `silenceMs` must pass their thresholds for auto-submit
- **Mid-sentence pause**: An ending of "... and" with 1000 ms silence and 650 ms stability does NOT submit (below 1800 ms min)

### `voice-postprocess.test.ts`

What it covers:
- **Dictionary casing**: "open ai" + dictionary "OpenAI" → "OpenAI"
- **Corrections before dictionary**: "codax" with corrections "codax => Codex" and dictionary "Codex" → first "codax" → "Codex", then "Codex" stays "Codex"
- **Prompt term extraction**: Combines dictionary entries and correction targets, deduplicating by lowercase
- **Defensive parsing**: Duplicate entries are deduplicated; invalid correction rules (no arrow) are skipped; spaces around arrows are trimmed

### `voice-prompt.test.ts`

What it covers:
- **Trailing text append**: "Hello" + transcript "world" → "Hello world"
- **Non-text preservation**: Image and file parts remain in their original positions; text is appended after last text part before images
- **Position recalculation**: After appending, all text spans get updated `start`/`end` indices

### `voice-capture-session.test.ts`

What it covers:
- **Session adoption**: Only `source: "native"` sessions are kept; `source: "renderer"` sessions are discarded by the adoption filter

## Desktop Tests

### `speech-capture.test.ts`

What it covers:
- **Pre-roll inclusion**: When a chunk begins after 150 ms + 200 ms of samples, the result duration is 250 ms (just the pre-roll)
- **Minimum padding**: A 300 ms + 200 ms chunk gets padded from 450 ms original to 1000 ms minimum encoded audio
- **Short-clip dropping**: A 100 ms + 50 ms chunk falls below the 200 ms minimum and is discarded entirely

### `speech-macos.test.ts`

What it covers:
- **Gain efficacy**: At `volume=0.04`, raw RMS is below `INTERNAL_SPEECH_THRESHOLD` (0.013), but with `gain=3.5` it rises above the threshold
- This proves the mic boost setting actually helps detect quiet speech

## Important Notes

- Tests use `bun:test` and run from package directories (e.g., `packages/desktop-electron` or `packages/app`)
- `speech-macos.test.ts` requires `ffmpeg` in PATH to generate test fixtures
- `speech-capture.test.ts` tests with 48 kHz input to verify resampling behavior
