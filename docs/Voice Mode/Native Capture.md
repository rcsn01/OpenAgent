# Native macOS Audio Capture

## When It Activates

Native capture is only used when:

1. `OPENCODE_ENABLE_NATIVE_SPEECH_CAPTURE=1` is set in environment
2. Platform is macOS
3. Desktop app is running (electron API available)
4. `startSpeechCaptureSession` succeeds with the Swift helper

## Architecture

Native capture bypasses the browser `getUserMedia` path entirely. Audio flows:

```
[macOS Microphone] → [AVAudioEngine tap] → [stdout Float32] → [Node.js main process]
                                                      ↓
                                              [Ring Buffer]
                                                      ↓
                                              [Resample to 16kHz]
                                                      ↓
                                              [RMS computation]
                                                      ↓
                                              [IPC to renderer]
```

## Swift Helper: `voice-capture-macos.swift`

The helper is compiled on first use with `swiftc`:

```swift
swiftc -module-cache-path .../module-cache -O \
  voice-capture-macos.swift \
  -framework AVFoundation \
  -framework Speech \
  -o voice-capture-macos
```

### What It Does

1. Requests microphone authorization via `AVCaptureDevice.authorizationStatus`
2. Creates an `AVAudioEngine`
3. Installs a tap on the input node
4. Detects the actual sample rate from hardware
5. Down-mixes multi-channel input to mono by averaging
6. Writes raw `Float32` samples directly to `stdout` as binary data
7. Prints a UTF-8 JSON header with the sample rate:
   ```json
   {"sampleRate": 44100}
   ```

### Data Protocol

The Electron main process reads from the child process stdout:

```
Line 1: JSON header {"sampleRate": ...} followed by newline
Rest:   Binary Float32 little-endian samples
```

## Electron Main Process Integration

### `speech-macos.ts`

Spawns the Swift helper and wires it into the speech pipeline:

```ts
export async function startMacOSSpeechCapture(input: {
  gain?: number
  onLevel: (level: NativeSpeechCaptureLevel) => void
  onSamples: (samples: Float32Array, sampleRate: number) => void
}) {
  const processRef = spawn(helperBinaryPath, [], { stdio: ["ignore", "pipe", "pipe"] })
  // ...reads JSON header, then binary samples...
}
```

### `speech-capture-native.ts`

Applies configurable gain and computes RMS:

```ts
export function applySpeechCaptureGain(samples: Float32Array, gain = 1) {
  if (gain <= 0 || gain === 1) return samples
  const output = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    output[i] = Math.max(-1, Math.min(1, samples[i] * gain))
  }
  return output
}
```

Gain values:
- `normal` = 1x
- `boost` = 3.5x
- `max` = 6x

### `speech-capture.ts`

The ring buffer maintains a rolling `5000 ms` buffer at `16 kHz`:

```ts
export const SPEECH_CAPTURE_SAMPLE_RATE = 16000
export const DEFAULT_SPEECH_CAPTURE_RING_BUFFER_MS = 5000
export const DEFAULT_SPEECH_CAPTURE_PRE_ROLL_MS = 250
```

Key functions:
- `createSpeechCaptureSessionState()` — initializes ring buffer and pre-roll
- `appendSpeechCaptureSamples()` — resamples and appends to ring, manages active chunk
- `beginSpeechCaptureChunk()` — extracts pre-roll from ring buffer into active chunk
- `takeSpeechCaptureChunk()` — concatenates active buffers, pads, encodes WAV

### Resampling

Linear interpolation when hardware sample rate differs from `16000`:

```ts
const ratio = inputSampleRate / SPEECH_CAPTURE_SAMPLE_RATE
const outputLength = Math.max(1, Math.round(samples.length / ratio))
// Linearly interpolate between adjacent samples
```

## Advantages Over Browser Capture

1. **No browser DSP negotiation** — browser audio processing is bypassed entirely; gain and cleanup are application-controlled
2. **Tighter buffering** — AVAudioEngine provides consistent buffer sizes vs. varying ScriptProcessorNode timing
3. **Faster startup** — no WebRTC permission dialogs, just the system mic authorization
4. **Better recovery** — app can restart the native process without reloading the entire renderer
5. **Consistent sample rate** — hardware delivers its native rate, resampled downstream predictably

## Test Coverage

`speech-capture.test.ts` verifies:
- Pre-roll is included when a chunk begins
- Short chunks are padded to minimum duration
- Clips that are still too short are dropped before padding

`speech-macos.test.ts` verifies:
- Gain boost (3.5x) lifts quiet speech above the detection threshold where raw gain (1x) does not

## Environment Toggle

```bash
OPENCODE_ENABLE_NATIVE_SPEECH_CAPTURE=1 opencode desktop
```

Without this flag, native capture is not attempted and the browser path is used even in the desktop app.
