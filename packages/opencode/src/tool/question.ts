import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

const QuestionOption = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.optional(Schema.String).annotate({ description: "Explanation of choice" }),
  recommended: Schema.optional(Schema.Boolean).annotate({
    description: "Whether this option is recommended",
  }),
})

const QuestionPrompt = Schema.Struct({
  question: Schema.optional(Schema.String).annotate({ description: "Complete question" }),
  prompt: Schema.optional(Schema.String).annotate({ description: "Alternate question field accepted for compatibility" }),
  header: Schema.optional(Schema.String).annotate({ description: "Very short label (max 30 chars)" }),
  message: Schema.optional(Schema.String).annotate({ description: "Additional prompt text accepted for compatibility" }),
  options: Schema.mutable(Schema.Array(QuestionOption)).annotate({ description: "Available choices" }),
  multiple: Schema.optional(Schema.Boolean).annotate({ description: "Allow selecting multiple choices" }),
  multiSelect: Schema.optional(Schema.Boolean).annotate({
    description: "Alternate multiple-choice field accepted for compatibility",
  }),
  custom: Schema.optional(Schema.Boolean).annotate({ description: "Allow typing a custom answer (default: true)" }),
  allowFreeformInput: Schema.optional(Schema.Boolean).annotate({
    description: "Alternate freeform-input field accepted for compatibility",
  }),
})

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(QuestionPrompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  questions: ReadonlyArray<Question.Info>
  answers: ReadonlyArray<Question.Answer>
}

function summarizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 30) || "Question"
}

function normalizeQuestions(params: Schema.Schema.Type<typeof Parameters>) {
  return params.questions.map((item) => {
    const question = item.question?.trim() || item.prompt?.trim() || item.message?.trim() || "Please clarify"

    return {
      question,
      header: item.header?.trim() || summarizeHeader(question),
      options: item.options.map((option) => ({
        label:
          option.recommended && !option.label.endsWith("(Recommended)")
            ? `${option.label} (Recommended)`
            : option.label,
        description: option.description ?? "",
      })),
      ...(item.multiple ?? item.multiSelect) === undefined ? {} : { multiple: item.multiple ?? item.multiSelect },
      ...(item.custom ?? item.allowFreeformInput) === undefined
        ? {}
        : { custom: item.custom ?? item.allowFreeformInput },
    }
  })
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const questions = normalizeQuestions(params)
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${questions.length} question${questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              questions,
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
