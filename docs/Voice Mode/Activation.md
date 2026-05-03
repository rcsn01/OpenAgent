# Voice Mode Activation

## Always-On Mode

Toggle the microphone via UI (mic icon). Once enabled:

1. Audio stays live until manually turned off
2. VAD continuously monitors the stream
3. When speech is detected, chunks begin buffering
4. When silence exceeds the soft threshold, audio is transcribed
5. If the user resumes before `maxSilenceMs`, new speech merges into the same turn
6. After natural pause completes, auto-submit may fire

State transitions:

```
[Off] --toggle--> [Preparing] --ready--> [Listening] --speech--> [Capturing]
                                                      ↑     ↓
                                               [Transcribing] ←--silence--
```

## Press-to-Talk Mode

Hold a configurable keyboard shortcut to speak. When released:

1. Capture stops immediately
2. Currently buffered audio is transcribed
3. No silence-based endpoint logic — release = stop
4. The transcript is appended to the prompt

This does not use the auto-submit heuristics. The user manually triggers transcription by releasing the key.

## State Machine

```ts
{
  manualMicEnabled: boolean    // always-on toggle
  pressToTalkActive: boolean  // PTT key held
  preparing: boolean          // model loading
  starting: boolean           // mic init
  listening: boolean         // audio stream active
  speaking: boolean          // VAD triggered
  transcribing: boolean      // awaiting transcription result
}
```

## Keybind Handling

Keybinds use the same parsing system as workspace commands:

```ts
const binding = parseKeybind(input.pressToTalkKeybind())[0]
if (binding && matchKeybind([binding], event)) {
  setState("pressToTalkActive", true)
}
```

Key capture is global at `document` with `capture: true`. The shortcut does not activate when a `data-voice-ptt-capture="true"` element has focus, so you can bind the shortcut to the PTT button itself without recursive triggering.

## Supported Detection

Voice mode is considered supported when:

```ts
if (!input.prepareSpeechTranscription || !input.transcribeSpeech) return false
if (supportsNativeDesktopCapture()) return true
if (typeof window === "undefined" || typeof navigator === "undefined") return false
return !!navigator.mediaDevices?.getUserMedia
```

On the desktop app with speech APIs implemented, it always returns true via the native path. In the browser, it checks for `getUserMedia` support.
