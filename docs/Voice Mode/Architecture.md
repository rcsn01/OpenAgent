# Voice Mode Architecture

## Process Split

The voice pipeline runs across two Electron processes:

```
┌─────────────────────────────────────────────────────────────────┐
│                        RENDERER                                  │
│  ┌─────────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐   │
│  │ VAD Loop    │ →│ Chunking │ →│ WAV     │ →│ Transcribe   │   │
│  │ (Analyser)  │  │          │  │ Encode  │  │ Queue        │   │
│  └─────────────┘  └──────────┘  └─────────┘  └──────────────┘   │
│         ↑                                        │               │
│    ┌────┴────┐                              ┌──────┴──────┐        │
│    │ getUser │                              │ IPC         │        │
│    │ Media   │                              │ (or direct) │        │
│    └────┬────┘                              └──────┬──────┘        │
└─────────┼──────────────────────────────────────────┼─────────────┘
          │                                          │
          │    ┌───────────────────────────────────────┘
          │    │
          ↓    ↓
┌──────────────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                               │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ SpeechCapture│  │ Ring Buffer │  │ Parakeet ONNX Worker     │  │
│  │ Session      │ →│ (16kHz)    │ →│ (uv run worker.py)       │  │
│  └──────────────┘  └─────────────┘  └──────────────────────────┘  │
│         ↑                                        │                │
│    ┌────┴────┐                              ┌────┴────┐          │
│    │ Native  │                              │ Apple   │          │
│    │ macOS   │                              │ Speech  │          │
│    │ Capture │                              │ (swift) │          │
│    └─────────┘                              └─────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

## Renderer Responsibilities

- Manage UI state (mic on/off, listening, speaking, transcribing)
- Audio context setup (`AudioContext`, `AnalyserNode`, `ScriptProcessorNode`)
- Voice activity detection (RMS analysis on animation frames)
- Chunk assembly (pre-roll + active buffer)
- WAV encoding
- Transcription queuing
- Post-processing normalization
- Prompt append
- Auto-submit heuristic evaluation

## Main Process Responsibilities

- Model management (download, list, install)
- Worker lifecycle (spawn, maintain, switch, shutdown)
- Native macOS capture session management
- Apple Speech transcription (via compiled Swift helper)
- Ring buffer maintenance for desktop capture
- IPC routing between renderer and speech runtime

## The Two Capture Paths

| Path | Trigger | Data Flow |
|------|---------|-----------|
| Browser `getUserMedia` | Always available | Float32 samples → renderer analyser → renderer chunking → WAV → IPC |
| Native macOS (`voice-capture-macos.swift`) | `OPENCODE_ENABLE_NATIVE_SPEECH_CAPTURE=1` + macOS | Native samples → stdout → main process ring buffer → take chunk → WAV → transcription |

## When Capture Path Is Chosen

In `voice.ts`:

```ts
function supportsDesktopCapture() {
  return (
    !!input.startSpeechCaptureSession &&
    !!input.appendSpeechCaptureSamples &&
    !!input.beginSpeechCaptureChunk &&
    !!input.transcribeSpeechCaptureChunk &&
    !!input.stopSpeechCaptureSession
  )
}

function supportsNativeDesktopCapture() {
  return supportsDesktopCapture() && !!input.onSpeechCaptureLevel
}
```

If all desktop IPC methods are available AND speech capture level events are supported, the system attempts native desktop capture. It falls back to browser audio if native capture fails to initialize.
