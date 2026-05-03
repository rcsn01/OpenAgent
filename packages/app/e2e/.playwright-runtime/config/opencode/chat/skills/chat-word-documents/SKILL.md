---
name: chat-word-documents
description: Create real Word document deliverables for GUI chats by drafting Markdown source and exporting a .docx file.
---

# Chat Word Documents

Use this skill when the user explicitly wants a Word document, a `.docx` file, or wants to test whether chat can create one directly.

## Workflow

1. Draft the document content in Markdown.
2. Save the Markdown source inside the hidden chat workspace.
3. Call `documents_create_docx` to export a real `.docx` file.
4. Return both the Markdown source path and the final `.docx` path when helpful.

## Required Behavior

- Prefer using the export tool over probing the environment.
- Do not install Python packages or shell tools when `documents_create_docx` is available.
- Keep filenames relevant to the deliverable instead of using generic names.

## Suggested Filenames

- Source draft: `deliverables/<topic>.md`
- Exported document: `deliverables/<topic>.docx`
