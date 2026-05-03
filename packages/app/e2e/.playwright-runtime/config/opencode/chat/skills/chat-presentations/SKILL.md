---
name: chat-presentations
description: Create slide decks for GUI chats by writing a slide-spec JSON file that is ready for export or handoff.
---

# Chat Presentations

Use this skill when the user wants a slide deck, PowerPoint, talk outline, pitch deck, status review, or presentation artifact.

## Workflow

1. Decide the audience and the core narrative.
2. Draft a slide-spec JSON file in the hidden chat workspace.
3. Keep the JSON source next to related deliverables so the deck can be regenerated.
4. If presentation-export tooling is available in the session, export the deck. Otherwise leave a clean slide spec that is ready for export.

## Suggested JSON Shape

```json
{
  "title": "Quarterly review",
  "theme": {
    "accent": "#2563EB"
  },
  "slides": [
    {
      "title": "Executive summary",
      "bullets": [
        "Revenue grew 18% quarter over quarter",
        "Two launch risks need mitigation"
      ]
    },
    {
      "title": "Roadmap",
      "body": "The next quarter focuses on reliability and rollout quality.",
      "bullets": [
        "Finish migration",
        "Run pilot",
        "Expand availability"
      ]
    }
  ]
}
```

## Suggested Filenames

- Source spec: `deliverables/<topic>-deck.json`
- Optional export target: `deliverables/<topic>.pptx`
