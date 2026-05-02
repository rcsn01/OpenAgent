# Endpointing and Auto-Submit

## Purpose

The system tries to distinguish a mid-sentence pause from a completed thought, so it can auto-submit the message at the right moment.

## The Heuristic

Core formula from `voice-endpoint.ts`:

```ts
holdMs = baseSilenceMs + DEFAULT_EXTRA_HOLD_MS
  + (filler ? 1000 : connector ? 700 : 0)
  + (!complete && stableMs < 1100 ? 250 : 0)
  + (stableMs < MIN_TRANSCRIPT_STABLE_MS ? 200 : 0)

autoSubmit = silenceMs >= holdMs && stableMs >= MIN_TRANSCRIPT_STABLE_MS
```

Where:
- `baseSilenceMs` = user setting (800–1600 ms)
- `DEFAULT_EXTRA_HOLD_MS` = 450 ms
- `MIN_TRANSCRIPT_STABLE_MS` = 700 ms

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

### Completion Signals (reduce hold time)

```ts
/(?:[.!?]["')\]]?\s*$|\b(?:done|finished|that\'s it|that is it|thank you|thanks)\s*$)/i
```

Punctuation or explicit completion words suggest the user is done speaking.

## Transcript Stability

The transcript is considered "stable" when no new transcription result has arrived recently (`transcriptStableMs`). Two stability gates:

- If stable for less than 1100 ms and not complete → +250 ms
- If stable for less than 700 ms → +200 ms

Both conditions can stack.

## Pause Presets

| Preset | baseSilenceMs | maxSilenceMs | Character |
|--------|---------------|--------------|-----------|
| Short | 800 ms | 2200 ms | Quick back-and-forth |
| Normal | 1200 ms | 3200 ms | Natural pauses |
| Long | 1600 ms | 4200 ms | Thinking out loud |

## Example Scenarios

| Input ending | Complete? | Filler? | Connector? | Hold time (base=1200) |
|-------------|-----------|---------|------------|----------------------|
| "open the file." | yes | no | no | ~1650 ms |
| "open the file and" | no | no | yes | ~2350 ms |
| "open the file ummm" | no | yes | no | ~2650 ms |
| "that works" | no | no | no | ~1900 ms |
| "done" | yes | no | no | ~1650 ms |

## Testing

See `voice-endpoint.test.ts` for coverage of:
- Filler words increase hold time over normal endings
- Complete utterances submit faster than connectors
- Both transcript stability and silence are required
- Mid-sentence pauses are held open

See [[Voice Mode/Testing]] for more details.
