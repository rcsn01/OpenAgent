# Voice Mode

A hands-free dictation system that lets you speak to OpenAgent instead of typing.

## Contents

- [[Voice Mode/Architecture]] — the renderer + main process pipeline
- [[Voice Mode/Activation]] — always-on vs press-to-talk
- [[Voice Mode/Voice Activity Detection]] — RMS-based adaptive detection
- [[Voice Mode/Chunking]] — pre-roll, active buffers, and turn merger
- [[Voice Mode/Endpointing]] — when to auto-submit based on speech patterns
- [[Voice Mode/Transcription]] — Parakeet (ONNX) and Apple Speech (macOS)
- [[Voice Mode/Native Capture]] — macOS AVAudioEngine bypassing browser audio
- [[Voice Mode/Post-Processing]] — dictionary, corrections, and prompt application
- [[Voice Mode/Settings]] — all user-configurable options
- [[Voice Mode/Implementation History]] — the 6 phases of development
- [[Voice Mode/Testing]] — test coverage and what each suite verifies

## Key Source Files

| File | Role |
|------|------|
| `packages/app/src/components/prompt-input/voice.ts` | Main voice controller |
| `packages/desktop-electron/src/main/speech.ts` | IPC handler, model management, worker lifecycle |
| `packages/desktop-electron/src/main/speech-capture.ts` | Ring buffer, resampling, WAV encoding |
| `packages/desktop-electron/native/voice-capture-macos.swift` | Native AVAudioEngine capture |
| `packages/desktop-electron/native/apple-speech-transcribe.swift` | SFSpeechRecognizer wrapper |
| `packages/desktop-electron/resources/speech/worker.py` | ONNX Parakeet worker |
