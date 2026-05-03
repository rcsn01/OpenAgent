# Chunking and Audio Assembly

## Design Goal

Ship meaningful audio segments to the transcription engine, not every random noise blip. The chunking system balances completeness (don't clip words) with timeliness (don't wait forever).

## The Pre-Roll Buffer

A rolling buffer holds the last `250 ms` of audio before speech starts:

```ts
const PRE_ROLL_MS = 250
```

When `startChunkCapture()` is called, the chunk begins with the pre-roll so the start of words is not clipped.

In browser mode, the pre-roll is maintained as an array of `Float32Array` chunks in `preRollChunks`, trimmed to the frame limit. In native mode, the ring buffer handles pre-roll automatically.

## Active Chunk Buffer

Once speech is detected, subsequent audio frames are appended to `activeChunkBuffers`. The total frames in the active buffer are tracked with `activeChunkFrames`.

## Chunk Finalization

When VAD detects sufficient silence:

```ts
const clip = takeActiveChunk()  // or takeSpeechCaptureChunk(sessionState)
if (clip) {
  queueTranscription(clip, runtime, run)
}
```

The chunk is:
1. **Padded** to a minimum duration of `1000 ms` if too short (`MIN_PADDED_TRANSCRIBE_MS`)
2. **Encoded** to WAV format (mono, 16-bit, 16 kHz in native mode)
3. **Queued** for transcription

This helps transcription quality on very short utterances like "yes" or "no."

## Browser vs Native Chunking

### Browser Path (Renderer-side)

```ts
function takeActiveChunk() {
  const durationMs = (activeChunkFrames / recordedSampleRate) * 1000
  const audio = encodeWave(ensureMinimumChunkDuration(chunks, sampleRate, frames), sampleRate)
  return { audio, originalDurationMs: Math.round(durationMs) }
}
```

### Native Path (Main Process)

```ts
export function takeSpeechCaptureChunk(state: SpeechCaptureSessionState) {
  const originalDurationMs = (state.active_chunk_frames * 1000) / SPEECH_CAPTURE_SAMPLE_RATE
  // ...concatenate ring buffer slices...
  const audio = encodeWave(ensureMinimumChunkDuration(samples), SPEECH_CAPTURE_SAMPLE_RATE)
  return { audio, originalDurationMs }
}
```

## Turn Merging

The system maintains `turnTranscript` and `turnTranscriptUpdatedAt`. When a new transcription arrives and the last speech was recent, the transcript is appended with a space. A turn is considered complete when:

- `maxSilenceMs` passes since last speech, OR
- `shouldAutoSubmitVoiceTurn()` returns true (endpointing)

```ts
function maybeFinalizeTurn() {
  if (!turnTranscript || capturingChunk || pendingTranscriptions > 0) return false
  const silenceMs = now - lastSpeechAt
  if (silenceMs >= maxSilenceMs) return finalizeTurn()
  if (!shouldAutoSubmitVoiceTurn({ ... })) return false
  return finalizeTurn()
}
```

When `finalizeTurn()` is called in always-on mode, it triggers `input.onAutoSubmit?.()` which sends the completed message.
