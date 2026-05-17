// @ts-nocheck
import * as mod from "./font"

const docs = `### Overview
Uses native system font stacks for sans and mono typography.

Optional compatibility component. Existing roots can keep rendering it, but it does nothing.

### Semantic typography tokens
- \`--type-body-sm-*\`
- \`--type-label-sm-*\`
- \`--type-code-sm-*\`
- \`--type-body-md-*\`
- \`--type-prose-md-*\`
- \`--type-label-md-*\`
- \`--type-code-md-*\`
- \`--type-title-sm-*\`
- \`--type-title-md-*\`

### Utility classes
- Semantic classes: \`type-body-sm\`, \`type-label-sm\`, \`type-code-sm\`, \`type-body-md\`, \`type-prose-md\`, \`type-label-md\`, \`type-code-md\`, \`type-title-sm\`, \`type-title-md\`
- Compatibility aliases: legacy \`text-12-*\` and literal \`text-13-*\` / \`text-14-*\` / \`text-16-medium\` / \`text-20-medium\`

### API
- No props.

### Variants and states
- No variants.

### Behavior
- Compatibility wrapper only. No font assets are injected or preloaded.

### Accessibility
- Not applicable.

### Theming/tokens
- Theme tokens come from CSS variables, not this component.

`

export default {
  title: "UI/Font",
  id: "components-font",
  component: mod.Font,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "grid", gap: "8px" }}>
      <mod.Font />
      <div style={{ "font-family": "var(--font-family-sans)" }}>OpenAgent Sans Sample</div>
      <div style={{ "font-family": "var(--font-family-mono)" }}>OpenAgent Mono Sample</div>
    </div>
  ),
}

export const TypographyTokens = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <div class="type-title-md">Title md</div>
      <div class="type-title-sm">Title sm</div>
      <div class="type-label-md">Label md</div>
      <div class="type-body-md">Body md copy for dialog text, lists, and long-form UI messaging.</div>
      <div class="type-prose-md">Prose md copy for chat text and navigation that should mirror conversation copy.</div>
      <div class="type-label-sm">Label sm</div>
      <div class="type-body-sm">Body sm copy for compact UI rows and metadata.</div>
      <div class="type-code-md">const answer = "tokenised"</div>
      <div class="type-code-sm">git status --short</div>
    </div>
  ),
}
