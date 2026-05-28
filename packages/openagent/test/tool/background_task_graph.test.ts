import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Parameters } from "../../src/tool/background_task_graph"

const parse = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const accepts = (schema: Schema.Decoder<unknown>, input: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

describe("background_task_graph parameters", () => {
  test("accepts canonical snake_case node keys", () => {
    const parsed = parse(Parameters, {
      nodes: [
        {
          node_id: "collect-alpha",
          description: "collect alpha",
          prompt: "Collect alpha data.",
          subagent_type: "general",
        },
      ],
    })

    expect(parsed.nodes).toHaveLength(1)
  })

  test("accepts compatibility aliases for node and dependency keys", () => {
    expect(
      accepts(Parameters, {
        nodes: [
          {
            nodeID: "collect-beta",
            description: "collect beta",
            prompt: "Collect beta data.",
            subagentType: "general",
          },
          {
            id: "process-ab",
            description: "process alpha beta",
            prompt: "Merge alpha and beta outputs.",
            subagent_type: "general",
            depends_on: ["collect-alpha", "collect-beta"],
          },
        ],
      }),
    ).toBe(true)
  })

  test("rejects nodes without any accepted node id key", () => {
    expect(
      accepts(Parameters, {
        nodes: [
          {
            description: "broken node",
            prompt: "This should fail.",
            subagent_type: "general",
          },
        ],
      }),
    ).toBe(false)
  })
})