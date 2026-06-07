# external orchestration Specialists

The external orchestration-style specialist team is registered as native subagents in `external opencode runtime/src/agent/agent.ts`. Each specialist gets a generated prompt via `specialistPrompt()` with shared external orchestration guidance plus role-specific instructions.

All specialists explicitly cannot call delegation, background task, or `send_message` tools.

## Shared Specialist Prompt

Every specialist receives the same base guidance:
- Part of an external orchestration-style multi-agent system
- Stay inside your specialty
- If work belongs to another specialist, name the correct owner briefly
- Do not attempt partial work outside your domain
- Include file paths in final responses, avoid dumping raw source
- Explain missing API keys or integrations instead of pretending success

## Specialist Agents

### deep-research
- **Owns:** evidence-based web research, citations, source-backed synthesis, balanced analysis
- **Specialist tool:** `deep_research`
- **Additional tools:** `webfetch`, `websearch`
- **Can be:** `send_message` recipient

### data-analyst
- **Owns:** structured data analysis, charts, KPIs, statistical summaries, model-driven insights
- **Specialist tool:** `data_kernel` (isolated IPython-style analysis and chart generation)
- **Can be:** `send_message` recipient

### slides-agent
- **Owns:** presentation creation, editing, visual polish, HTML decks, PPTX export
- **Specialist tools:** `slides_plan`, `slides_modify`, `slides`, `slides_theme`, `slide_screenshot`, `slide_overflow_check`
  - `slides_plan` — create a substantive external orchestration-style storyline and slide plan from a user request
  - `slides_modify` — enrich or repair one slide from a self-contained content brief
  - `slides` — create/export the HTML project and PPTX; title-only inputs are enriched before export
  - `slides_theme` — persist theme tokens with CSS variable generation
  - `slide_screenshot` — SVG slide previews for visual inspection
  - `slide_overflow_check` — density and overflow heuristic reports
- **Can be:** `send_message` recipient

### docs-agent
- **Owns:** formatted documents, Word files, PDFs, Markdown, TXT, outlines, conversions
- **Specialist tool:** `docs`
- **Can be:** `send_message` recipient

### image-generation-agent
- **Owns:** image generation, image editing, composition, visual asset creation
- **Specialist tool:** `image_generation` (Gemini/fal-style image workflows)
- **Can be:** `send_message` recipient

### video-generation-agent
- **Owns:** video generation, editing, assembly, clip composition, media workflows
- **Specialist tool:** `video_generation` (Sora/Veo/Seedance/fal-style video workflows)
- **Can be:** `send_message` recipient

## Non-Specialist Subagents

### general
- Generic provider-prompt subagent with `todowrite` denied
- Useful as a lightweight fallback worker for parallel subtasks
- Is a `send_message` recipient
- Has no specialist tool; relies on normal tools only

### explore
- Fast codebase exploration subagent
- Restricted to: `grep`, `glob`, `list`, `bash`, `webfetch`, `websearch`, `read`
- Uses an explicit prompt file (`explore.txt`) with thoroughness levels
- Spawnable via `task` but not a default communication recipient

## Spawn Rules

- `build` and `assistant` can spawn any subagent through `task`
- The runtime uses the exact requested agent name; no automatic mode conversion
- Blocked spawn names: `build`, `plan`, `assistant`, `chat`, `orchestrator`
- All external orchestration specialists, `general`, and `explore` cannot use `task` themselves

## Related Docs

- [[Agents/Index]] — full agent capability matrix
- [[Agents/Primary Agents]] — build, assistant, and plan comparison
- [[Agents/Permission System]] — tool registry gating and permission enforcement
- [[Architecture/external orchestration Integration]] — native routing, communication flows, OAuth
