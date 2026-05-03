# Transcription Engines

## Two Engine Types

### Parakeet (Local ONNX)

The default local model. Runs entirely on-device via a Python ONNX worker.

#### Supported Models

| Model | Description | Runtime |
|-------|-------------|---------|
| `parakeet-tdt-v3` | Recommended, multilingual, strongest accuracy | Parakeet |
| `parakeet-tdt-v2` | Earlier release, explicit download option | Parakeet |

#### Quality Modes

| Mode | Quantization | Model Files |
|------|-------------|-------------|
| Fast | `int8` | `encoder-model.int8.onnx`, `decoder_joint-model.int8.onnx` |
| Accurate | none (full precision) | `encoder-model.onnx`, `decoder_joint-model.onnx` |

#### Worker Protocol

The worker (`resources/speech/worker.py`) is spawned via `uv run` and communicates over stdin/stdout with newline-delimited JSON:

**Request:**
```json
{ "type": "transcribe", "id": "...", "audio_path": "...", "original_duration_ms": ..., "prompt_terms": [...] }
```

**Response:**
```json
{ "type": "response", "id": "...", "text": "...", "language": "...", "confidence": ..., "segments": [...], "tokens": [...] }
```

#### Metadata Returned

- `text`: transcribed text
- `language`: detected language (e.g., "en-US")
- `confidence`: aggregate confidence score
- `segments`: array of `{ text, startMs, endMs, confidence }`
- `tokens`: array of `{ text, startMs, endMs, logprob, confidence }`

### Apple Speech (macOS Native)

Available only on macOS desktop. Uses `SFSpeechRecognizer` with on-device recognition when supported.

#### Implementation

A Swift helper (`apple-speech-transcribe.swift`) is compiled on first use with `swiftc` and cached:

```swift
swiftc -O -framework AVFoundation -framework Speech -o apple-speech-transcribe apple-speech-transcribe.swift
```

The compiled binary reads a WAV file path, calls `SFSpeechURLRecognitionRequest`, and returns a JSON payload with transcript, segments, and per-segment confidence.

#### Fallback Chain

1. User selects "Apple Speech"
2. If `transcribeWithAppleSpeech()` succeeds → return result
3. If it fails (SIGABRT, timeout, unavailable):
   - Set `appleSpeechUnavailable = true`
   - Try fallback to the best available Parakeet model
   - If no Parakeet model → error with instruction to download one

This means once Apple Speech fails once, the session permanently falls back to Parakeet until the app restarts.

## Worker Lifecycle

The Parakeet worker is a single-process singleton:

```ts
let workerState: WorkerState | undefined
```

- **Start**: `ensureWorkerReady(config)` spawns `uv run` with the selected model dir, model name, and quantization flag
- **Switch model/quality**: Stop current worker, start new one
- **Concurrent requests**: Multiple transcriptions are queued in the `pending` map
- **Error handling**: If the worker exits unexpectedly, all pending requests are rejected
- **Cleanup**: Shutdown message sent, 1-second graceful timeout before `kill()`

## Requirements

- Parakeet requires `uv` (Python package manager) in the user's PATH
- Apple Speech requires macOS with speech recognition enabled
- All audio processing is entirely local — nothing leaves the device

## Shared Interface

Both engines conform to the same `SpeechTranscription` interface:

```ts
type SpeechTranscription = {
  text: string
  language?: string
  confidence?: number
  segments?: { text, startMs?, endMs?, confidence? }[]
  tokens?: { text, startMs?, endMs?, logprob?, confidence? }[]
}
```

The renderer does not need to know which engine produced the result.
