# Endpointing and Auto-Submit

## Purpose

The system tries to distinguish a mid-sentence pause from a completed thought, so it can auto-submit the message at the right moment.

## The Heuristic

Core formula from `voice-endpoint.ts`:

```ts
holdMs = max(baseSilenceMs + DEFAULT_EXTRA_HOLD_MS, baseSilenceMs * 2)
  + (filler ? 1000 : connector ? 700 : punctuation ? 700 : 0)
  + (!explicitlyComplete && stableMs < 1100 ? 250 : 0)
  + (stableMs < MIN_TRANSCRIPT_STABLE_MS ? 200 : 0)

autoSubmit = silenceMs >= holdMs && stableMs >= MIN_TRANSCRIPT_STABLE_MS
```

Where:
- `baseSilenceMs` = user setting (800–2600 ms)
- `DEFAULT_EXTRA_HOLD_MS` = 450 ms
- `MIN_TRANSCRIPT_STABLE_MS` = 700 ms
- punctuation is treated as suspicious ASR output, not proof that the user is done

## Clamping

```ts
clamp(holdMs, MIN_AUTO_SUBMIT_SILENCE_MS, maxSilenceMs)
// MIN_AUTO_SUBMIT_SILENCE_MS = 1800 ms
```

The hold time is always at least 1800 ms and never exceeds the hard cutoff.

## Pattern Detection

### Filler Words (add 1000 ms)

```ts
/(uh|uhh+|um|umm+|er|err+|ah|ahh+|hmm+|mm+)\s*[.?!…]*$/i
```

Examples ending with these trigger a longer wait because the user is likely still forming their thought.

### Connector Words (add 700 ms)

```ts
/(and|but|so|because|or|if|then|well)\s*[.?!…]*$/i
```

These suggest the sentence is incomplete — more words likely follow.

### Punctuation (add 700 ms)

```ts
/[.!?]["')\]]?\s*$/i
```

ASR often inserts punctuation mid-thought. A period therefore increases the hold window instead of shortening it.

### Explicit Completion Signals

```ts
/\b(?:done|finished|that\'s it|that is it|thank you|thanks)\s*[.?!…]*$/i
```

Only explicit completion words count as the user saying they are done.

## Transcript Stability

The transcript is considered "stable" when no new transcription result has arrived recently (`transcriptStableMs`). Two stability gates:

- If stable for less than 1100 ms and not explicitly complete → +250 ms
- If stable for less than 700 ms → +200 ms

Both conditions can stack.

## Pause Presets

| Preset | baseSilenceMs | maxSilenceMs | Character |
|--------|---------------|--------------|-----------|
| Short | 800 ms | 2200 ms | Quick back-and-forth |
| Normal | 1200 ms | 3200 ms | Natural pauses |
| Long | 2600 ms | 8000 ms | Long thinking pauses / multi-part dictation |

## Example Scenarios

| Input ending | Complete? | Filler? | Connector? | Hold time (base=1200) |
|-------------|-----------|---------|------------|----------------------|
| "open the file." | no | no | no | ~3100 ms |
| "open the file and" | no | no | yes | ~3100 ms |
| "open the file ummm" | no | yes | no | ~3400 ms |
| "that works" | no | no | no | ~2400 ms |
| "done" | yes | no | no | ~2400 ms |

## Testing

See `voice-endpoint.test.ts` for coverage of:
- Filler words increase hold time over normal endings
- ASR punctuation does not cause early submit
- Explicit completion phrases are distinct from punctuation
- Both transcript stability and silence are required
- Mid-sentence pauses are held open

See [[Voice Mode/Testing]] for more details.
