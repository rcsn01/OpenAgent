import { expect, test } from "bun:test"
import { fromOpenAgentMessages } from "./transcript"
import type { MessageV2 } from "@/session/message-v2"

test("projects OpenAgent text messages into Pi agent messages", () => {
  const messages: MessageV2.WithParts[] = [
    {
      info: {
        id: "msg_user" as any,
        sessionID: "ses" as any,
        role: "user",
        time: { created: 1 },
        agent: "assistant",
        model: { providerID: "openai" as any, modelID: "gpt-5" as any },
      },
      parts: [
        {
          id: "part_user_text" as any,
          sessionID: "ses" as any,
          messageID: "msg_user" as any,
          type: "text",
          text: "hello",
        },
      ],
    },
    {
      info: {
        id: "msg_assistant" as any,
        sessionID: "ses" as any,
        role: "assistant",
        time: { created: 2, completed: 3 },
        parentID: "msg_user" as any,
        modelID: "gpt-5" as any,
        providerID: "openai" as any,
        mode: "assistant",
        agent: "assistant",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0.01,
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        {
          id: "part_assistant_text" as any,
          sessionID: "ses" as any,
          messageID: "msg_assistant" as any,
          type: "text",
          text: "hi",
        },
      ],
    },
  ]

  expect(fromOpenAgentMessages(messages)).toMatchObject([
    { role: "user", content: "hello", timestamp: 1 },
    {
      role: "assistant",
      provider: "openai",
      model: "gpt-5",
      content: [{ type: "text", text: "hi" }],
      stopReason: "stop",
      timestamp: 2,
    },
  ])
})

test("projects completed OpenAgent tool parts into Pi tool results", () => {
  const messages: MessageV2.WithParts[] = [
    {
      info: {
        id: "msg_assistant" as any,
        sessionID: "ses" as any,
        role: "assistant",
        time: { created: 2, completed: 3 },
        parentID: "msg_user" as any,
        modelID: "gpt-5" as any,
        providerID: "openai" as any,
        mode: "assistant",
        agent: "assistant",
        path: { cwd: "/tmp", root: "/tmp" },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "tool-calls",
      },
      parts: [
        {
          id: "part_tool" as any,
          sessionID: "ses" as any,
          messageID: "msg_assistant" as any,
          type: "tool",
          callID: "call_1",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "a.ts" },
            output: "contents",
            title: "Read",
            metadata: { filePath: "a.ts" },
            time: { start: 2, end: 3 },
          },
        },
      ],
    },
  ]

  expect(fromOpenAgentMessages(messages)).toMatchObject([
    { role: "assistant", stopReason: "toolUse" },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "contents" }],
      isError: false,
      timestamp: 3,
    },
  ])
})
