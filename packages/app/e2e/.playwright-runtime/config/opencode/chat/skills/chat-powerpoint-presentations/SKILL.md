---
name: chat-powerpoint-presentations
description: Create real PowerPoint deliverables for GUI chats by drafting a slide spec and exporting a .pptx file.
---

# Chat PowerPoint Presentations

Use this skill when the user explicitly wants a PowerPoint file, a `.pptx`, or wants to verify that chat can create a presentation directly.

## Workflow

1. Draft a structured slide spec.
2. Save the slide spec JSON inside the hidden chat workspace.
3. Call `presentations_create_pptx` to export a real `.pptx` file.
4. Return both the JSON source path and the final `.pptx` path when helpful.

## Required Behavior

- Prefer using the export tool over environment probing.
- Do not install Python packages or shell tools when `presentations_create_pptx` is available.
- Keep filenames relevant to the deck instead of using generic names.

## Suggested Filenames

- Source spec: `deliverables/<topic>-deck.json`
- Exported deck: `deliverables/<topic>.pptx`
