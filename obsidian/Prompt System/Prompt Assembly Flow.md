# Prompt Assembly Flow

## The Exact Order

In `packages/opencode/src/session/llm.ts`, the system prompt is assembled like this:

```ts
const basePrompt = input.agent.prompt
  ? [
      ...(extendProviderPrompt ? SystemPrompt.provider(input.model) : []),
      input.agent.prompt,
    ]
  : SystemPrompt.provider(input.model)

system.push(
  [
    ...basePrompt,
    ...input.system,
    ...(input.user.system ? [input.user.system] : []),
  ]
    .filter(Boolean)
    .join("\n")
)
```

Then the system is further enriched by `packages/opencode/src/session/prompt.ts`:

```ts
// 1. Instructions (AGENTS.md, etc.)
const instruction = yield* Instruction.Service.pipe(Effect.flatMap((i) => i.system()))
// these are pushed into the system prompt

// 2. Environment info
const env = yield* SystemPrompt.environment(input.model)

// 3. Skills summary
const skills = yield* SystemPrompt.skills(input.agent)

// 4. Per-message system text from the user
if (input.user.system) {
  system.push(input.user.system)
}
```

## Full Stack

```text
1. Base prompt
   ├── provider prompt (or)
   └── agent prompt (optionally + provider prompt)
2. Custom system text passed to stream call
3. AGENTS.md / other instruction files
4. Environment info (directory, worktree, git, platform, date, model name)
5. Available skills summary
6. Per-message system text (user.system on the message)
```

## Plugin Hooks

Plugin hooks can modify system text, messages, params, and headers:

```ts
// Transform the system text
yield* plugin.trigger("experimental.chat.system.transform", { sessionID, model }, { system })

// Transform request params
const params = yield* plugin.trigger("chat.params", { sessionID, agent, model, provider, message }, { temperature, topP, ... })

// Transform request headers
const { headers } = yield* plugin.trigger("chat.headers", ...)
```

## OpenAI OAuth Exception

If using OpenAI OAuth, the system text is passed as `instructions` instead of system messages:

```ts
if (isOpenaiOauth) {
  options.instructions = system.join("\n")
}
```

## Structured Output

When structured output is requested, a system text is prepended:

```
IMPORTANT: You MUST use the StructuredOutput tool to provide your final response...
```

## Max Steps Reminder

If the agent has a `steps` limit, `max-steps.txt` is appended to the prompt to remind the agent about its step budget.
