import path from "path"
import { pathToFileURL } from "url"
import type { SlideImageSpec } from "./office"
import { inferTheme, renderSlideSvg, type SlidePreviewSpec, type ThemeSpec } from "./slide_qa"

export type HtmlSlideProjectInput = {
  title?: string
  task?: string
  outputPath?: string
  projectDir?: string
  slides: readonly SlidePreviewSpec[]
  theme?: ThemeSpec
}

export type RenderedSlideImage = SlideImageSpec & {
  previewPath: string
}

export type PlannedSlide = SlidePreviewSpec & {
  purpose?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function slug(value: string) {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return clean || "deck"
}

export function slideProjectDir(input: Pick<HtmlSlideProjectInput, "title" | "task" | "outputPath" | "projectDir">) {
  if (input.projectDir?.trim()) return input.projectDir.trim().replace(/\/+$/g, "")
  const fromOutput = input.outputPath ? path.basename(input.outputPath, path.extname(input.outputPath)) : undefined
  return `deliverables/presentations/${slug(input.title ?? input.task ?? fromOutput ?? "deck")}`
}

export function slideThemeCss(input?: ThemeSpec) {
  const theme = inferTheme({ theme: input })
  return [
    ":root {",
    `  --slide-bg: ${theme.background};`,
    `  --slide-fg: ${theme.foreground};`,
    `  --slide-accent: ${theme.accent};`,
    `  --slide-font: ${theme.fontFamily};`,
    `  --slide-title-size: ${theme.titleSize}px;`,
    `  --slide-body-size: ${theme.bodySize}px;`,
    "}",
    "",
    "* { box-sizing: border-box; }",
    "html, body {",
    "  width: 1280px;",
    "  height: 720px;",
    "  margin: 0;",
    "  overflow: hidden;",
    "  background: var(--slide-bg);",
    "}",
    "body {",
    "  color: var(--slide-fg);",
    "  font-family: var(--slide-font), Arial, sans-serif;",
    "}",
    ".slide {",
    "  position: relative;",
    "  width: 1280px;",
    "  height: 720px;",
    "  padding: 78px 92px 70px;",
    "  background: var(--slide-bg);",
    "}",
    ".slide::before {",
    "  content: '';",
    "  position: absolute;",
    "  inset: 50px 48px 50px 48px;",
    "  width: auto;",
    "  border-radius: 24px;",
    "  background: var(--slide-accent);",
    "  opacity: 0.08;",
    "  z-index: 0;",
    "}",
    ".slide > * {",
    "  position: relative;",
    "  z-index: 1;",
    "}",
    ".kicker {",
    "  margin: 0 0 28px;",
    "  color: var(--slide-accent);",
    "  font-size: 17px;",
    "  font-weight: 700;",
    "}",
    "h1 {",
    "  max-width: 1040px;",
    "  margin: 0 0 30px;",
    "  font-size: var(--slide-title-size);",
    "  line-height: 1.08;",
    "  letter-spacing: 0;",
    "}",
    ".body {",
    "  max-width: 980px;",
    "  margin: 0 0 24px;",
    "  font-size: var(--slide-body-size);",
    "  line-height: 1.45;",
    "}",
    "ul {",
    "  display: grid;",
    "  gap: 12px;",
    "  max-width: 1040px;",
    "  margin: 26px 0 0;",
    "  padding: 0;",
    "  list-style: none;",
    "  font-size: var(--slide-body-size);",
    "  line-height: 1.35;",
    "}",
    "li {",
    "  position: relative;",
    "  padding: 13px 18px 13px 48px;",
    "  border-radius: 14px;",
    "  background: color-mix(in srgb, var(--slide-fg) 8%, transparent);",
    "}",
    "li::before {",
    "  content: '';",
    "  position: absolute;",
    "  left: 20px;",
    "  top: 1.18em;",
    "  width: 10px;",
    "  height: 10px;",
    "  border-radius: 999px;",
    "  background: var(--slide-accent);",
    "}",
    ".slide-number {",
    "  position: absolute;",
    "  right: 72px;",
    "  bottom: 42px;",
    "  color: var(--slide-accent);",
    "  font-size: 15px;",
    "  font-weight: 700;",
    "}",
    ".section .kicker { margin-bottom: 160px; }",
    ".section h1 { max-width: 900px; font-size: 64px; }",
    ".section::after {",
    "  content: attr(data-number);",
    "  position: absolute;",
    "  right: 82px;",
    "  bottom: 80px;",
    "  color: var(--slide-fg);",
    "  opacity: 0.08;",
    "  font-size: 168px;",
    "  font-weight: 800;",
    "}",
    "",
  ].join("\n")
}

export function slideHtml(input: {
  deckTitle?: string
  slide: SlidePreviewSpec
  slideNumber: number
  slideCount: number
}) {
  const bullets = input.slide.bullets ?? []
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=1280, initial-scale=1">',
    `  <title>${escapeHtml(input.slide.title)}</title>`,
    '  <link rel="stylesheet" href="_theme.css">',
    "</head>",
    "<body>",
    `  <main class="slide${input.slide.body || bullets.length ? "" : " section"}" data-number="${String(input.slideNumber).padStart(2, "0")}">`,
    `    <p class="kicker">${escapeHtml(input.deckTitle ?? "Presentation")}</p>`,
    `    <h1>${escapeHtml(input.slide.title)}</h1>`,
    input.slide.body ? `    <p class="body">${escapeHtml(input.slide.body)}</p>` : undefined,
    bullets.length
      ? [
          "    <ul>",
          ...bullets.map((bullet) => `      <li>${escapeHtml(bullet)}</li>`),
          "    </ul>",
        ].join("\n")
      : undefined,
    `    <div class="slide-number">${input.slideNumber}/${input.slideCount}</div>`,
    "  </main>",
    "</body>",
    "</html>",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

export function htmlSlidePaths(projectDir: string, slideCount: number) {
  return Array.from({ length: slideCount }, (_, index) => `${projectDir}/slide-${String(index + 1).padStart(2, "0")}.html`)
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "about",
  "between",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "their",
  "to",
  "vs",
  "with",
])

function words(input: string) {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9+.#-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !STOPWORDS.has(item.toLowerCase()))
}

function keywords(input: string, limit = 8) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const word of words(input)) {
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(word)
    if (out.length >= limit) break
  }
  return out
}

function splitComparison(input: string) {
  const match = input.match(/\b(.+?)\s+(?:vs\.?|versus|compared with|compared to)\s+(.+?)\b/i)
  if (!match) return undefined
  return [match[1].trim(), match[2].trim()] as const
}

function sentenceCase(input: string) {
  const clean = input.trim()
  if (!clean) return clean
  return clean[0].toUpperCase() + clean.slice(1)
}

function ensureBulletLength(input: string) {
  const clean = input.trim().replace(/\s+/g, " ")
  if (clean.length >= 70) return clean
  return `${clean}; explain the specific implication for the audience rather than leaving it as a label.`
}

export function isSubstantiveSlide(slide: SlidePreviewSpec) {
  return !!slide.body?.trim() || (slide.bullets?.some((bullet) => bullet.trim().length >= 24) ?? false)
}

export function enrichSlides(input: {
  task: string
  title?: string
  slides: readonly SlidePreviewSpec[]
}): PlannedSlide[] {
  const deckTitle = input.title ?? input.task
  const comparison = splitComparison(deckTitle) ?? splitComparison(input.task)
  const deckKeywords = keywords(`${deckTitle} ${input.task}`, 10)
  const candidateSlides = input.slides.length
    ? input.slides
    : planSlides({ task: input.task, title: input.title, slideCount: 8 })

  return candidateSlides.map((slide, index) => {
    const existingBullets = slide.bullets?.filter((bullet) => bullet.trim()) ?? []
    if (isSubstantiveSlide(slide)) {
      return {
        ...slide,
        bullets: existingBullets.map(ensureBulletLength),
        purpose: index === 0 ? "cover" : slide.title,
      }
    }

    const title = slide.title || `${deckTitle}: Slide ${index + 1}`
    const focus = keywords(`${title} ${input.task}`, 5)
    const [left, right] = comparison ?? [deckKeywords[0] ?? "Option A", deckKeywords[1] ?? "Option B"]
    const topic = focus[0] ?? title

    if (index === 0) {
      return {
        title,
        body: `A concise executive presentation about ${deckTitle}, framed around the decision, trade-offs, and practical implications for the audience.`,
        bullets: [
          `Central question: what makes ${deckTitle} meaningfully different in real usage, not just feature lists.`,
          `Decision lens: compare capabilities, workflow fit, ecosystem maturity, and operational trade-offs.`,
          `Output: a visual, evidence-led deck with clear takeaways instead of title-only section cards.`,
        ],
        purpose: "cover",
      }
    }

    if (/overview|intro|what is|context/i.test(title)) {
      return {
        title,
        body: `${title} sets the context for the audience and explains why this topic matters now.`,
        bullets: [
          `${left} should be explained through its practical role, primary users, and the kind of work it is best suited for.`,
          `${right} should be positioned with the same level of specificity so the comparison feels balanced.`,
          `The slide should make the audience understand the stakes before moving into feature or technical detail.`,
        ],
        purpose: "overview",
      }
    }

    if (/architecture|model|technical|spec|engine/i.test(title)) {
      return {
        title,
        body: `Compare the technical foundations behind ${deckTitle} in terms the target audience can act on.`,
        bullets: [
          `${left}: summarize architecture, deployment model, context handling, and control surfaces that affect real work.`,
          `${right}: summarize architecture, product surface, agent workflow, and ecosystem assumptions.`,
          `Decision impact: connect the technical differences to reliability, cost, latency, customization, and governance.`,
        ],
        purpose: "technical comparison",
      }
    }

    if (/benchmark|performance|capabilit|feature/i.test(title)) {
      return {
        title,
        body: `Turn capability claims into a side-by-side decision view instead of a generic feature inventory.`,
        bullets: [
          `Reasoning and coding: identify where each option appears strongest and what evidence should support that claim.`,
          `Workflow automation: compare tool use, agentic execution, integrations, and how much setup the user must manage.`,
          `Evaluation caveat: make clear which claims are benchmark-backed, product-positioning, or inferred from available signals.`,
        ],
        purpose: "capability proof",
      }
    }

    if (/developer|integration|workflow|use case|experience/i.test(title)) {
      return {
        title,
        body: `Show how ${deckTitle} changes day-to-day work for the people who would actually adopt it.`,
        bullets: [
          `Setup path: explain how a user starts, connects tools, and moves from prompt to deliverable.`,
          `Workflow fit: call out where the experience favors developers, operators, researchers, or non-technical users.`,
          `Adoption friction: include the likely blockers such as credentials, ecosystem lock-in, local deployment, or regional access.`,
        ],
        purpose: "workflow implications",
      }
    }

    if (/recommend|choose|decision|conclusion|takeaway/i.test(title)) {
      return {
        title,
        body: `Close the deck with a clear recommendation logic rather than a generic summary.`,
        bullets: [
          `Choose ${left} when openness, controllability, cost efficiency, or backend flexibility are the decisive criteria.`,
          `Choose ${right} when integrated agent workflows, desktop/product experience, or broad productivity tooling matter more.`,
          `Final takeaway: the stronger option depends on whether the buyer optimizes for technical control or end-to-end workflow convenience.`,
        ],
        purpose: "recommendation",
      }
    }

    return {
      title,
      body: `${sentenceCase(topic)} should be explained as a specific decision point in the broader ${deckTitle} story.`,
      bullets: [
        `What matters: describe the concrete capability, constraint, or trade-off behind this slide.`,
        `Why it matters: connect the point to cost, speed, quality, risk, or user workflow outcomes.`,
        `How to read it: give the audience one clear takeaway they can use in the final decision.`,
      ],
      purpose: title,
    }
  })
}

export function planSlides(input: { task: string; title?: string; slideCount?: number }): PlannedSlide[] {
  const title =
    input.title ??
    (sentenceCase(input.task.replace(/^create\s+(a\s+)?(professional\s+)?(presentation|deck)\s+(about|on|for)?/i, "").trim()) ||
      "Presentation")
  const comparison = splitComparison(title) ?? splitComparison(input.task)
  const count = Math.max(4, Math.min(input.slideCount ?? (comparison ? 8 : 6), 12))
  const base = comparison
    ? [
        title,
        `Overview: ${comparison[0]}`,
        `Overview: ${comparison[1]}`,
        "Architecture & Model Specs Comparison",
        "Performance Benchmarks & Capabilities",
        "Developer Experience & Integration",
        "Best-Fit Use Cases",
        "Recommendation & Decision Matrix",
      ]
    : [
        title,
        "Context & Stakes",
        "Core Concepts",
        "Evidence & Examples",
        "Practical Workflow",
        "Recommendation & Next Steps",
      ]
  return base.slice(0, count).map((slideTitle) => ({ title: slideTitle }))
}

export function slideSubstanceReport(slides: readonly SlidePreviewSpec[]) {
  const titleOnly = slides.filter((slide) => !isSubstantiveSlide(slide))
  return {
    total: slides.length,
    titleOnly: titleOnly.length,
    titleOnlyRatio: slides.length ? titleOnly.length / slides.length : 0,
    ok: slides.length > 0 && titleOnly.length <= Math.max(1, Math.floor(slides.length * 0.25)),
  }
}

export function svgSlideImages(input: {
  slides: readonly SlidePreviewSpec[]
  theme?: ThemeSpec
  previewDir: string
}): RenderedSlideImage[] {
  return input.slides.map((slide, index) => {
    const name = `slide-${String(index + 1).padStart(2, "0")}`
    return {
      name,
      content: renderSlideSvg({ slide, theme: input.theme, index }),
      extension: "svg" as const,
      mime: "image/svg+xml" as const,
      previewPath: `${input.previewDir}/${name}.svg`,
    }
  })
}

export async function tryRenderHtmlSlides(input: {
  htmlPaths: readonly string[]
  previewDir: string
}): Promise<RenderedSlideImage[] | undefined> {
  let chromium: any
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>
    try {
      ;({ chromium } = await dynamicImport("playwright"))
    } catch {
      ;({ chromium } = await dynamicImport("@playwright/test"))
    }
  } catch {
    return undefined
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const images: RenderedSlideImage[] = []
    for (const [index, htmlPath] of input.htmlPaths.entries()) {
      const name = `slide-${String(index + 1).padStart(2, "0")}`
      await page.goto(pathToFileURL(htmlPath).href)
      const bytes = await page.screenshot({ type: "png", fullPage: false })
      images.push({
        name,
        content: bytes,
        extension: "png",
        mime: "image/png",
        previewPath: `${input.previewDir}/${name}.png`,
      })
    }
    return images
  } finally {
    await browser.close()
  }
}
