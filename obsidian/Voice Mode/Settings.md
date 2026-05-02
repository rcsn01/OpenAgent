# Voice Settings

All settings are configurable via the Voice Settings popover.

## Transcription Settings

### Model

| Model ID | Label | Description |
|----------|-------|-------------|
| `apple-speech` | Apple Speech | macOS native SFSpeechRecognizer (experimental, macOS only) |
| `parakeet-tdt-v3` | Parakeet TDT v3 | Recommended multilingual model |
| `parakeet-tdt-v2` | Parakeet TDT v2 | Earlier release with explicit download option |

### Mode

| Quality | Speed | Model |
|---------|-------|-------|
| `fast` | Low latency | Quantized `int8` |
| `accurate` | Slower, better recognition | Full precision |

Both qualities require downloading the model files first.

## Pause Before Send (Auto-Submit Timing)

| Preset | baseSilenceMs | maxSilenceMs | When to Use |
|--------|---------------|--------------|-------------|
| Short | 800 ms | 2200 ms | Quick back-and-forth |
| Normal | 1200 ms | 3200 ms | Natural speech pauses |
| Long | 1600 ms | 4200 ms | Thinking out loud |

`baseSilenceMs` = soft flush threshold (when to finalize a chunk for transcription)
`maxSilenceMs` = hard cutoff (when to consider the turn complete)

## Audio Settings

### VAD Sensitivity

| Level | speechFactor | minSpeechThreshold | Best For |
|-------|--------------|-------------------|----------|
| `low` | 2.8 | 0.0065 | Noisy rooms |
| `normal` | 2.2 | 0.005 | Most environments |
| `high` | 1.7 | 0.0035 | Quiet speech, distance |

### Mic Boost (Pre-amplification)

| Level | Gain | When to Use |
|-------|------|-------------|
| `normal` | 1x | Loud mic, already clear |
| `boost` | 3.5x | Quieter voice, standard mic |
| `max` | 6x | Very quiet mic, distant |

### Audio Cleanup (Browser DSP)

Toggle browser-level echo cancellation, noise suppression, and auto gain control:

| Setting | Effect |
|---------|--------|
| On | `autoGainControl: true`, `echoCancellation: true`, `noiseSuppression: true` |
| Off | Raw microphone capture (can help if DSP distorts) |

Only used in the browser `getUserMedia` path — native capture ignores this setting.

## Keyboard Settings

### Press-to-Talk Keybind

- Configurable keyboard shortcut
- Captures globally even when the text input does not have focus
- Ignored when `data-voice-ptt-capture="true"` element is focused (prevents self-triggering)
- Press `Esc` to cancel recording, `Backspace` to clear binding

## Vocabulary

### Custom Terms

- One term per line or comma-separated
- Preserves preferred casing after transcription
- Used as prompt terms for transcription engine bias

Example:
```
OpenAI
WhisperKit
TypeScript
```

### Corrections

- One rule per line: `from => to`
- Applied before dictionary normalization
- Fixes recurring ASR errors

Example:
```
codax => Codex
open code => OpenCode
sonnet => Sonnet
```

## Where Settings Are Stored

Voice settings are part of the app-level settings system in `packages/app/src/context/settings.ts`, persisted to user preferences.
