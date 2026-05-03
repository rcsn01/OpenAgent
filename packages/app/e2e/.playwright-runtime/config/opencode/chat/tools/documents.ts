import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx"
import { tool } from "@opencode-ai/plugin"

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

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      })
      continue
    }

    const bullet = line.match(/^-\s+(.*)$/)
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
      ? "# " + args.title + "\n\n" + args.markdown.trim()
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
      ].join("\n"),
      metadata: {
        outputPath,
        sourcePath,
      },
    }
  },
})
