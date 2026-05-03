# Implementation History

## Background

Voice mode was built in phases based on the original `VOICE_IMPLEMENTATION_PLAN.md` (since deleted from the repo root). The plan compared the existing implementation against TypeWhisper and identified gaps in native audio capture, rolling transcription buffers, and text quality layers.

## Phase 1: Accuracy Bundle on the Current Stack

**Goal**: Improve always-on dictation without rewriting the whole pipeline.

What was implemented:

- Rolling pre-roll buffer (`250 ms`) in the mic loop
- Soft pause (`baseSilenceMs`) + hard cutoff (`maxSilenceMs`) endpointing
- Merged resumed speech into the same open turn after brief pauses
- Wired `voice-endpoint.ts` filler/connector heuristics so mid-sentence pauses hold the turn open
- Browser DSP toggle setting (echo cancellation / noise suppression / auto gain)
- `fast` vs `accurate` transcription quality mode:
  - `fast` = quantized `int8` ONNX
  - `accurate` = full-precision ONNX

**Key source file**: `packages/app/src/components/prompt-input/voice.ts`

## Phase 2: Text Quality Layers

**Goal**: Improve names, technical terms, and repeated mistakes.

What was implemented:

- Custom dictionary for preferred casing (e.g., "open ai" → "OpenAI")
- Corrections layer with `from => to` rule format
- Both terms fed into transcription engines as prompt hints
- Post-transcription normalization: corrections first, then dictionary casing
- Word-boundary regex matching with tokenization for multi-word terms

**Key source files**:
- `packages/app/src/components/prompt-input/voice-postprocess.ts`
- `packages/app/src/components/prompt-input/voice-prompt.ts`

## Phase 3: Better Parakeet Runtime Behavior

**Goal**: Close the gap within the existing Parakeet path.

What was implemented:

- Minimum-duration padding before transcription (`1000 ms`)
- Short-clip confidence gating (clips shorter than `200 ms` are dropped)
- Richer metadata preserved where supported: segments, language hints, token-level timing
- Improved install/runtime handling for different quality variants

**Key source file**: `packages/desktop-electron/src/main/speech.ts`

## Phase 4: Native Desktop Capture

**Goal**: Move always-on dictation off the browser capture path.

What was implemented:

- `AVAudioEngine`-based macOS audio capture via `voice-capture-macos.swift`
- Rolling `16 kHz` mono ring buffer (`5000 ms` capacity) on the main process side
- Swift helper compiled on first use with `swiftc`
- Binary data protocol: JSON header + raw `Float32` samples
- Main process resampling to `16 kHz`, gain application, RMS computation
- Opt-in via `OPENCODE_ENABLE_NATIVE_SPEECH_CAPTURE=1`

**Key source files**:
- `packages/desktop-electron/native/voice-capture-macos.swift`
- `packages/desktop-electron/src/main/speech-capture.ts`
- `packages/desktop-electron/src/main/speech-capture-native.ts`
- `packages/desktop-electron/src/main/speech-macos.ts`

## Phase 5: Multi-Engine Expansion

**Goal**: Support a better dictation engine when Parakeet is not the best fit.

What was implemented:

- macOS native `SFSpeechRecognizer` path via Apple Speech
- Swift helper (`apple-speech-transcribe.swift`) compiled on first use with `swiftc`
- On-device recognition when supported via `requiresOnDeviceRecognition`
- Automatic fallback from Apple Speech to Parakeet when the native engine fails:
  - SIGABRT detection
  - Timeout handling
  - Permanent per-session fallback flag
- Both engines support the same `SpeechTranscription` interface so the renderer is engine-agnostic

**Key source files**:
- `packages/desktop-electron/native/apple-speech-transcribe.swift`
- `packages/desktop-electron/src/main/speech.ts` (fallback logic)

## Phase 6: Full-Turn Finalization and Safer Endpointing

**Goal**: Stop always-on dictation from sending while the user is still mid-sentence.

This phase was prompted by real dictation failures where the app sent too early:

- Intended: "Show me your complex node dependencies and capabilities."
- Captured/sent: "Show me your complex node dependencies and case."
- Intended: "Look at Andre Karpathy's Auto Research GitHub repo and include his skill into the current repo and make it your skill."
- Captured/sent: "Look at Andre Karpathy's auto research."

What was implemented:

- A full-turn audio buffer that survives across multiple live chunk transcriptions
- Final whole-utterance transcription before auto-submit
- Interim text is replaced by the final full-turn transcript instead of duplicated
- Desktop IPC APIs for beginning and transcribing a complete speech turn
- Longer `Long` pause preset: `2600 / 8000 ms`
- Migration from legacy `Long` timing of `1600 / 4200 ms`
- Endpointing no longer treats ASR punctuation as a completion signal
- Punctuation now adds hold time because ASR can insert periods mid-thought
- Only explicit phrases like "done" or "that's it" count as completion signals

**Key source files**:
- `packages/app/src/components/prompt-input/voice.ts`
- `packages/app/src/components/prompt-input/voice-endpoint.ts`
- `packages/desktop-electron/src/main/speech-capture.ts`
- `packages/desktop-electron/src/main/speech.ts`

## What's Next

The original plan also outlined:
- Short-clip confidence gating (Phases 1–3)
- Vocabulary rescoring with a secondary CTC model
- WhisperKit evaluation

Some of these remain future work. The core improvements covered today are in Phases 1–6.
