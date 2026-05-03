---
name: chat-documents
description: Create polished document drafts for GUI chats by drafting Markdown that is ready for export or handoff.
---

# Chat Documents

Use this skill when the user wants a Word document, memo, report, brief, proposal, or other document deliverable.

## Workflow

1. Clarify the audience, structure, and tone if the request is ambiguous.
2. Draft the content in a Markdown file inside the hidden chat workspace.
3. Keep the Markdown source alongside related deliverables so later edits are easy.
4. If document-export tooling is available in the session, export the draft. Otherwise leave a clean Markdown source file that is ready for export.

## Recommended Markdown Shape

- Use `#`, `##`, and `###` headings.
- Use `-` bullets for unordered lists.
- Use plain paragraphs for normal body copy.
- Keep tables and deeply nested formatting minimal unless the user explicitly asks for them.

## Suggested Filenames

- Source draft: `deliverables/<topic>.md`
- Optional export target: `deliverables/<topic>.docx`
