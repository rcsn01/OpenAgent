import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@openagent-ai/core/filesystem"
import { Flag } from "@openagent-ai/core/flag/flag"
import { Global } from "@openagent-ai/core/global"

const MARKER = ".openagent-chat-profile.json"
const LEGACY_PATHS: string[] = []

const FILES = {
  "AGENTS.md": `# GUI Chat Profile

This shared profile applies to all GUI chats that use the hidden general-chat workspace.

## Deliverables

- When the user asks for a document, create or refine a Markdown draft in the workspace.
- When the user asks for a slide deck, create a slide-spec JSON file in the workspace.
- When the user asks for a spreadsheet, create a workbook-spec JSON file in the workspace.
- Keep source Markdown or JSON files organized so they can be exported or refined later.

## Shared Skills

- Use \`chat-documents\` for polished document drafts and handoff-ready structure.
- Use \`chat-word-documents\` when the user explicitly wants a real \`.docx\` file.
- Use \`chat-presentations\` for deck outlines and slide specs.
- Use \`chat-powerpoint-presentations\` when the user explicitly wants a real \`.pptx\` file.
- Use \`chat-spreadsheets\` for workbook specs and tabular outputs.
`,
  "package.json": `{
  "name": "openagent-chat-profile",
  "private": true,
  "type": "module",
  "dependencies": {
    "docx": "^9.0.0",
    "pptxgenjs": "^4.0.0"
  }
}
`,
  "skills/chat-documents/SKILL.md": `---
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

- Use \`#\`, \`##\`, and \`###\` headings.
- Use \`-\` bullets for unordered lists.
- Use plain paragraphs for normal body copy.
- Keep tables and deeply nested formatting minimal unless the user explicitly asks for them.

## Suggested Filenames

- Source draft: \`deliverables/<topic>.md\`
- Optional export target: \`deliverables/<topic>.docx\`
`,
  "skills/chat-word-documents/SKILL.md": `---
name: chat-word-documents
description: Create real Word document deliverables for GUI chats by drafting Markdown source and exporting a .docx file.
---

# Chat Word Documents

Use this skill when the user explicitly wants a Word document, a \`.docx\` file, or wants to test whether chat can create one directly.

## Workflow

1. Draft the document content in Markdown.
2. Save the Markdown source inside the hidden chat workspace.
3. Call \`documents_create_docx\` to export a real \`.docx\` file.
4. Return both the Markdown source path and the final \`.docx\` path when helpful.

## Required Behavior

- Prefer using the export tool over probing the environment.
- Do not install Python packages or shell tools when \`documents_create_docx\` is available.
- Keep filenames relevant to the deliverable instead of using generic names.

## Suggested Filenames

- Source draft: \`deliverables/<topic>.md\`
- Exported document: \`deliverables/<topic>.docx\`
`,
  "skills/chat-presentations/SKILL.md": `---
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

\`\`\`json
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
\`\`\`

## Suggested Filenames

- Source spec: \`deliverables/<topic>-deck.json\`
- Optional export target: \`deliverables/<topic>.pptx\`
`,
  "skills/chat-powerpoint-presentations/SKILL.md": `---
name: chat-powerpoint-presentations
description: Create real PowerPoint deliverables for GUI chats by drafting a slide spec and exporting a .pptx file.
---

# Chat PowerPoint Presentations

Use this skill when the user explicitly wants a PowerPoint file, a \`.pptx\`, or wants to verify that chat can create a presentation directly.

## Workflow

1. Draft a structured slide spec.
2. Save the slide spec JSON inside the hidden chat workspace.
3. Call \`presentations_create_pptx\` to export a real \`.pptx\` file.
4. Return both the JSON source path and the final \`.pptx\` path when helpful.

## Required Behavior

- Prefer using the export tool over environment probing.
- Do not install Python packages or shell tools when \`presentations_create_pptx\` is available.
- Keep filenames relevant to the deck instead of using generic names.

## Suggested Filenames

- Source spec: \`deliverables/<topic>-deck.json\`
- Exported deck: \`deliverables/<topic>.pptx\`
`,
  "skills/chat-spreadsheets/SKILL.md": `---
name: chat-spreadsheets
description: Create workbook specs for GUI chats by writing structured JSON that is ready for export or handoff.
---

# Chat Spreadsheets

Use this skill when the user wants an Excel workbook, tracker, table export, model input sheet, or lightweight analysis handoff.

## Workflow

1. Decide the workbook structure and sheet names.
2. Draft a workbook-spec JSON file in the hidden chat workspace.
3. Keep the JSON source next to related deliverables so it can be regenerated.
4. If spreadsheet-export tooling is available in the session, export the workbook. Otherwise leave a clean workbook spec that is ready for export.

## Suggested JSON Shape

\`\`\`json
{
  "sheets": [
    {
      "name": "Tasks",
      "columns": [
        { "header": "Task", "key": "task", "width": 28 },
        { "header": "Owner", "key": "owner", "width": 18 },
        { "header": "Status", "key": "status", "width": 16 }
      ],
      "rows": [
        { "task": "Draft launch plan", "owner": "Avery", "status": "Done" },
        { "task": "Review metrics", "owner": "Sam", "status": "In Progress" }
      ]
    }
  ]
}
\`\`\`

## Suggested Filenames

- Source spec: \`deliverables/<topic>-workbook.json\`
- Optional export target: \`deliverables/<topic>.xlsx\`
`,
  "tools/documents.ts": `import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx"
import { tool } from "@openagent-ai/plugin"

function resolveTarget(base: string, input: string) {
  return path.isAbsolute(input) ? input : path.join(base, input)
}

function parseMarkdown(markdown: string) {
  const blocks: Array<
    | { type: "heading"; level: 1 | 2 | 3; text: string }
    | { type: "bullet"; text: string }
    | { type: "paragraph"; text: string }
  > = []
  const paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim()
    if (!text) return
    blocks.push({ type: "paragraph", text })
    paragraph.length = 0
  }

  for (const rawLine of markdown.split(/\\r?\\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }

    const heading = line.match(/^(#{1,3})\\s+(.*)$/)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      })
      continue
    }

    const bullet = line.match(/^-\\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      blocks.push({ type: "bullet", text: bullet[1].trim() })
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}

function headingLevel(level: 1 | 2 | 3) {
  if (level === 1) return HeadingLevel.HEADING_1
  if (level === 2) return HeadingLevel.HEADING_2
  return HeadingLevel.HEADING_3
}

export const create_docx = tool({
  description: "Create a real Word .docx file from Markdown content for GUI chat deliverables.",
  args: {
    output_path: tool.schema.string().describe("Workspace-relative or absolute path for the final .docx file."),
    markdown: tool.schema.string().describe("Markdown content to export into the Word document."),
    source_path: tool.schema
      .string()
      .optional()
      .describe("Optional workspace-relative or absolute path for the Markdown source file to save."),
    title: tool.schema
      .string()
      .optional()
      .describe("Optional document title to prepend when the Markdown does not already start with one."),
  },
  async execute(args, context) {
    const outputPath = resolveTarget(context.directory, args.output_path)
    const sourcePath = args.source_path ? resolveTarget(context.directory, args.source_path) : undefined
    const markdown = args.title && !args.markdown.trim().startsWith("#")
      ? "# " + args.title + "\\n\\n" + args.markdown.trim()
      : args.markdown

    if (sourcePath) {
      await mkdir(path.dirname(sourcePath), { recursive: true })
      await writeFile(sourcePath, markdown, "utf8")
    }

    const children = parseMarkdown(markdown).map((block) => {
      if (block.type === "heading") {
        return new Paragraph({
          heading: headingLevel(block.level),
          children: [new TextRun(block.text)],
        })
      }
      if (block.type === "bullet") {
        return new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(block.text)],
        })
      }
      return new Paragraph({
        children: [new TextRun(block.text)],
      })
    })

    const doc = new Document({
      sections: [
        {
          children: children.length > 0 ? children : [new Paragraph("")],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, buffer)

    return {
      output: [
        "Created Word document.",
        "DOCX: " + outputPath,
        ...(sourcePath ? ["Markdown source: " + sourcePath] : []),
      ].join("\\n"),
      metadata: {
        outputPath,
        sourcePath,
      },
    }
  },
})
`,
  "tools/presentations.ts": `import path from "path"
import { mkdir, writeFile } from "fs/promises"
import PptxGenJS from "pptxgenjs"
import { tool } from "@openagent-ai/plugin"

function resolveTarget(base: string, input: string) {
  return path.isAbsolute(input) ? input : path.join(base, input)
}

export const create_pptx = tool({
  description: "Create a real PowerPoint .pptx file from a structured slide spec for GUI chat deliverables.",
  args: {
    output_path: tool.schema.string().describe("Workspace-relative or absolute path for the final .pptx file."),
    source_path: tool.schema
      .string()
      .optional()
      .describe("Optional workspace-relative or absolute path for the slide-spec JSON source file."),
    title: tool.schema.string().optional().describe("Optional overall deck title."),
    slides: tool.schema
      .array(
        tool.schema.object({
          title: tool.schema.string().describe("Slide title."),
          body: tool.schema.string().optional().describe("Optional body copy for the slide."),
          bullets: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Optional bullet points for the slide."),
        }),
      )
      .min(1)
      .describe("Ordered slide definitions for the deck."),
  },
  async execute(args, context) {
    const outputPath = resolveTarget(context.directory, args.output_path)
    const sourcePath = args.source_path ? resolveTarget(context.directory, args.source_path) : undefined

    if (sourcePath) {
      await mkdir(path.dirname(sourcePath), { recursive: true })
      await writeFile(
        sourcePath,
        JSON.stringify(
          {
            title: args.title,
            slides: args.slides,
          },
          null,
          2,
        ),
        "utf8",
      )
    }

    const deck = new PptxGenJS()
    deck.layout = "LAYOUT_WIDE"
    deck.author = "OpenAgent Chat"
    deck.company = "OpenAgent"
    if (args.title) deck.subject = args.title
    deck.title = args.title ?? args.slides[0]?.title ?? "Presentation"

    for (const slideSpec of args.slides) {
      const slide = deck.addSlide()
      slide.background = { color: "F8FAFC" }
      slide.addText(slideSpec.title, {
        x: 0.6,
        y: 0.4,
        w: 12,
        h: 0.6,
        fontFace: "Aptos Display",
        fontSize: 24,
        bold: true,
        color: "0F172A",
        margin: 0,
      })

      const content = [
        ...(slideSpec.body ? [slideSpec.body] : []),
        ...((slideSpec.bullets ?? []).map((item) => "• " + item)),
      ].join("\\n\\n")

      if (content) {
        slide.addText(content, {
          x: 0.8,
          y: 1.4,
          w: 11.4,
          h: 4.8,
          fontFace: "Aptos",
          fontSize: 18,
          color: "1E293B",
          breakLine: false,
          valign: "top",
          margin: 0.08,
        })
      }
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await deck.writeFile({ fileName: outputPath })

    return {
      output: [
        "Created PowerPoint presentation.",
        "PPTX: " + outputPath,
        ...(sourcePath ? ["Slide spec: " + sourcePath] : []),
      ].join("\\n"),
      metadata: {
        outputPath,
        sourcePath,
      },
    }
  },
})
`,
} as const

export function directory() {
  return path.join(Flag.OPENAGENT_CONFIG_DIR ?? Global.Path.config, "chat")
}

export const managedWith = Effect.fn("GeneralChatProfile.managedWith")(function* (fs: AppFileSystem.Interface) {
  const dir = directory()
  if (!(yield* fs.isDir(dir))) return false
  return yield* fs.existsSafe(path.join(dir, MARKER))
})

export const managed = Effect.fn("GeneralChatProfile.managed")(function* () {
  return yield* managedWith(yield* AppFileSystem.Service)
})

const marker = () =>
  JSON.stringify(
    {
      managed: true,
      version: 2,
    },
    null,
    2,
  )

const writeMissing = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, dir: string) {
  for (const [relative, content] of Object.entries(FILES)) {
    const target = path.join(dir, relative)
    if (yield* fs.existsSafe(target)) continue
    yield* fs.writeWithDirs(target, content)
  }
  const target = path.join(dir, MARKER)
  if (yield* fs.existsSafe(target)) return
  yield* fs.writeWithDirs(target, marker())
})

const cleanupLegacy = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, dir: string) {
  for (const relative of LEGACY_PATHS) {
    const target = path.join(dir, relative)
    if (!(yield* fs.existsSafe(target))) continue
    yield* fs.remove(target, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void))
  }
})

export const ensureWith = Effect.fn("GeneralChatProfile.ensureWith")(function* (fs: AppFileSystem.Interface) {
  const dir = directory()
  if (!(yield* fs.isDir(dir))) {
    yield* fs.ensureDir(dir)
    yield* writeMissing(fs, dir)
    return dir
  }
  if (!(yield* fs.existsSafe(path.join(dir, MARKER)))) return dir
  yield* cleanupLegacy(fs, dir)
  yield* writeMissing(fs, dir)
  return dir
})

export const ensure = Effect.fn("GeneralChatProfile.ensure")(function* () {
  return yield* ensureWith(yield* AppFileSystem.Service)
})
