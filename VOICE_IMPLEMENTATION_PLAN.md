## Voice Implementation Plan

### Why This Exists

The current local voice path is functional, but it is still much closer to "chunk browser audio on silence and run one-shot ASR" than to a polished dictation product. This document captures the comparison against TypeWhisper and the planned upgrade path so future work stays coherent.

### What TypeWhisper Is Doing Differently

TypeWhisper feels more accurate because it stacks several advantages together:

1. Native audio capture.
It uses a native macOS recorder pipeline instead of browser `getUserMedia()`, which gives it tighter control over buffering, routing, and recovery.

2. Rolling transcription buffers.
It keeps a dedicated 16 kHz mono transcription buffer with current/recent/delta access, rather than repeatedly shipping isolated WAV chunks.

3. Live-session oriented engines.
Its model manager supports streaming/live transcription sessions. That is a better fit for always-on dictation than repeated one-shot decoding.

4. Engine choice.
Its "better accuracy" is not just Parakeet. It also supports WhisperKit, SpeechAnalyzer, and others, so the best-feeling path may be a different engine entirely.

5. Parakeet-specific quality layers.
Its Parakeet plugin pads short audio, applies short-clip confidence gating, produces token timing segments, and optionally performs vocabulary rescoring with a secondary CTC model.

6. Dictionary and correction layers.
It can bias engines toward custom terms and then post-process recurring mistakes afterward. Some perceived accuracy gains come from these text-quality layers, not raw ASR alone.

### Current Gaps In This Repo

1. The always-on mic loop in `packages/app/src/components/prompt-input/voice.ts` still flushes on a simple silence timeout.
2. The semantic endpoint helper in `packages/app/src/components/prompt-input/voice-endpoint.ts` is not wired into the live loop.
3. Browser DSP is always enabled, with no user control over echo cancellation, noise suppression, or auto gain.
4. The local Parakeet worker currently prefers `int8`, with no user-facing accuracy mode.
5. There is no custom dictionary/correction layer for local voice.
6. The desktop speech runtime is still one-shot and file-based, not a continuous live session.

### Plan

#### Phase 1: Accuracy Bundle On The Current Stack

Goal: improve always-on dictation without rewriting the whole pipeline.

1. Add a rolling pre-roll buffer in the renderer mic loop.
2. Change endpointing to soft pause + hard cutoff.
`baseSilenceMs` becomes the soft flush threshold.
`maxSilenceMs` becomes the hard finalize threshold.
3. Merge resumed speech into the same open turn if the user continues after a brief pause.
4. Wire `voice-endpoint.ts` into the live loop so fillers and connectors hold the turn open longer.
5. Add a user setting for browser DSP.
Allow users to turn browser audio cleanup on or off.
6. Add a user-facing transcription quality mode.
`Fast` keeps quantized inference.
`Accurate` uses the non-quantized runtime, even if that is slower and requires a separate local download.

#### Phase 2: Text Quality Layers

Goal: improve names, technical terms, and repeated mistakes.

1. Add a local dictionary for custom terms.
2. Add a corrections layer for common substitutions.
3. Feed supported term prompts into engines that can use them.
4. Add post-transcription correction passes for local voice output.

#### Phase 3: Better Parakeet Runtime Behavior

Goal: close the gap within the existing Parakeet path.

1. Add minimum-duration padding before transcription.
2. Add short-clip confidence gating.
3. Add richer result metadata where supported, including segments and language hints.
4. Improve install/runtime handling for different quality variants.

#### Phase 4: Native Desktop Capture

Goal: move always-on dictation off the browser capture path.

1. Capture microphone audio in Electron/native code.
2. Maintain a rolling 16 kHz mono ring buffer on the desktop side.
3. Feed the speech runtime from native buffers instead of renderer-generated WAV files.
4. Use this as the foundation for more reliable always-on and press-to-talk behavior.

#### Phase 5: Multi-Engine Expansion

Goal: support a better dictation engine when Parakeet is not the best fit.

1. Evaluate a macOS-native WhisperKit path.
2. Evaluate Apple Speech-style native transcription where available.
3. Keep Parakeet as one local option, not the only option.

### What To Implement First

Start with Phase 1.

That is the highest-leverage work for the current complaints about always-on mode missing words and splitting speech incorrectly. The biggest short-term gap is not just the model. It is the capture and chunking architecture around the model.
