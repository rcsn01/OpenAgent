import path from "path"
import { mkdir, writeFile } from "fs/promises"
import PptxGenJS from "pptxgenjs"
import { tool } from "@opencode-ai/plugin"

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
    deck.author = "OpenCode Chat"
    deck.company = "OpenCode"
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
      ].join("\n\n")

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
      ].join("\n"),
      metadata: {
        outputPath,
        sourcePath,
      },
    }
  },
})
