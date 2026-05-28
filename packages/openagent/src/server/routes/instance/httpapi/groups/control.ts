import { Auth } from "@/auth"
import { GeneralChat } from "@/general-chat/general-chat"
import { ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"

const AuthParams = Schema.Struct({
  providerID: ProviderID,
})

const LogQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

export const LogInput = Schema.Struct({
  service: Schema.String.annotate({ description: "Service name for the log entry" }),
  level: Schema.Union([
    Schema.Literal("debug"),
    Schema.Literal("info"),
    Schema.Literal("error"),
    Schema.Literal("warn"),
  ]).annotate({ description: "Log level" }),
  message: Schema.String.annotate({ description: "Log message" }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional metadata for the log entry",
  }),
})

export const ControlPaths = {
  auth: "/auth/:providerID",
  log: "/log",
  experimentalChat: "/experimental/chat",
  experimentalChatByID: "/experimental/chat/:sessionID",
} as const

export const ControlApi = HttpApi.make("control").add(
  HttpApiGroup.make("control")
    .add(
      HttpApiEndpoint.put("authSet", ControlPaths.auth, {
        params: AuthParams,
        payload: Auth.Info,
        success: described(Schema.Boolean, "Successfully set authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.set",
          summary: "Set auth credentials",
          description: "Set authentication credentials",
        }),
      ),
      HttpApiEndpoint.delete("authRemove", ControlPaths.auth, {
        params: AuthParams,
        success: described(Schema.Boolean, "Successfully removed authentication credentials"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "auth.remove",
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
        }),
      ),
      HttpApiEndpoint.post("log", ControlPaths.log, {
        query: LogQuery,
        payload: LogInput,
        success: described(Schema.Boolean, "Log entry written successfully"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "app.log",
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
        }),
      ),
      HttpApiEndpoint.get("experimentalChatList", ControlPaths.experimentalChat, {
        success: described(Schema.Array(GeneralChat.Info), "List of general chats"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.chat.list",
          summary: "List general chats",
          description: "List standalone general chats backed by hidden workspaces.",
        }),
      ),
      HttpApiEndpoint.post("experimentalChatCreate", ControlPaths.experimentalChat, {
        success: described(GeneralChat.Info, "General chat created"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.chat.create",
          summary: "Create general chat",
          description: "Create a standalone general chat backed by a hidden workspace.",
        }),
      ),
      HttpApiEndpoint.get("experimentalChatGet", ControlPaths.experimentalChatByID, {
        params: Schema.Struct({ sessionID: SessionID }),
        success: described(GeneralChat.Info, "General chat"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.chat.get",
          summary: "Get general chat",
          description: "Resolve a general chat session to its hidden backing workspace.",
        }),
      ),
      HttpApiEndpoint.delete("experimentalChatDelete", ControlPaths.experimentalChatByID, {
        params: Schema.Struct({ sessionID: SessionID }),
        success: described(Schema.Boolean, "General chat deleted"),
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.chat.delete",
          summary: "Delete general chat",
          description: "Delete a general chat session and remove its hidden workspace.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "control", description: "Control plane routes." })),
)
