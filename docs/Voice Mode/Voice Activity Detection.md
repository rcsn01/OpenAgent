# Voice Activity Detection

## Signal Processing

The renderer uses a `getUserMedia` → `AudioContext` → `AnalyserNode` pipeline:

1. `getUserMedia` captures raw mic input
2. `AudioContext` creates the audio processing graph
3. `GainNode` applies configurable input boost (`normal` = 1x, `boost` = 3.5x, `max` = 6x)
4. `AnalyserNode` (fftSize = 2048) reads amplitude data every animation frame
5. `ScriptProcessorNode` (bufferSize = 4096) copies audio samples for capture

## RMS Computation

Every animation frame, the system computes RMS over the time-domain waveform:

```ts
analyser.getByteTimeDomainData(audioBuffer)
let total = 0
for (const sample of audioBuffer) {
  const normalized = (sample - 128) / 128
  total += normalized * normalized
}
const rms = Math.sqrt(total / audioBuffer.length)
```

## Speech vs Silence

A frame counts as "speech" when:

```
rms > max(minSpeechThreshold(vadSensitivity), noiseFloor * speechFactor(vadSensitivity))
```

### Parameters by Sensitivity

| Level | speechFactor | minSpeechThreshold |
|-------|--------------|-------------------|
| low | 2.8 | 0.0065 |
| normal | 2.2 | 0.005 |
| high | 1.7 | 0.0035 |

### Adaptive Noise Floor

```ts
if (!state.speaking) noiseFloor = noiseFloor * 0.92 + rms * 0.08
```

The noise floor only adapts during silence. This prevents it from tracking loud speech as background noise.

### Frame Counts

- **Speech declared**: 3 consecutive speech frames (`SPEECH_FRAME_COUNT = 3`)
- **Silence declared**: 8 consecutive silence frames (`SILENCE_FRAME_COUNT = 8`)

## Handling Modes

### Always-On

When speech is detected:
- `startChunkCapture()` begins recording audio from the pre-roll buffer
- Incoming samples are appended to the active chunk
- When silence exceeds `baseSilenceMs`, `flushRecording()` finalizes

### Press-to-Talk

The entire key-hold period is a single forced capture:
- `handleVoiceActivity()` always returns `true` when `pressToTalkActive`
- The chunk starts immediately when the key is held, ends on release
