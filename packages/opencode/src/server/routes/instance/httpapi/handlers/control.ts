import { Auth } from "@/auth"
import { GeneralChat } from "@/general-chat/general-chat"
import { ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const generalChat = yield* GeneralChat.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const logger = Log.create({ service: ctx.payload.service })
      logger[ctx.payload.level](ctx.payload.message, ctx.payload.extra)
      return true
    })

    const experimentalChatList = Effect.fn("ControlHttpApi.experimentalChatList")(function* () {
      return yield* generalChat.list()
    })

    const experimentalChatCreate = Effect.fn("ControlHttpApi.experimentalChatCreate")(function* () {
      return yield* generalChat.create()
    })

    const experimentalChatGet = Effect.fn("ControlHttpApi.experimentalChatGet")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      return yield* generalChat.get(ctx.params.sessionID)
    })

    const experimentalChatDelete = Effect.fn("ControlHttpApi.experimentalChatDelete")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* generalChat.delete(ctx.params.sessionID)
      return true
    })

    return handlers
      .handle("authSet", authSet)
      .handle("authRemove", authRemove)
      .handle("log", log)
      .handle("experimentalChatList", experimentalChatList)
      .handle("experimentalChatCreate", experimentalChatCreate)
      .handle("experimentalChatGet", experimentalChatGet)
      .handle("experimentalChatDelete", experimentalChatDelete)
  }),
)
