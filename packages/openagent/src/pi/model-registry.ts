import { getModel as getPiModel, getProviders, type Model, type Provider as PiProvider } from "@earendil-works/pi-ai"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { ModelID, ProviderID } from "@/provider/schema"
import { Context, Effect, Layer } from "effect"

const providerMap: Record<string, PiProvider> = {
  "amazon-bedrock": "amazon-bedrock",
  anthropic: "anthropic",
  azure: "azure-openai-responses",
  "azure-cognitive-services": "azure-openai-responses",
  "github-copilot": "github-copilot",
  google: "google",
  "google-vertex": "google-vertex",
  mistral: "mistral",
  openai: "openai",
  opencode: "opencode",
  "opencode-go": "opencode-go",
  openrouter: "openrouter",
  xai: "xai",
  groq: "groq",
  cerebras: "cerebras",
  deepseek: "deepseek",
  "vercel-ai-gateway": "vercel-ai-gateway",
  together: "together",
  fireworks: "fireworks",
  "kimi-coding": "kimi-coding",
}

const modelMap: Record<string, { providerID?: PiProvider; modelID: string }> = {
  "opencode-go/mimo-v2.5-free": { modelID: "mimo-v2.5" },
  "opencode-go/xiaomi/mimo-v2.5": { modelID: "mimo-v2.5" },
  "opencode/xiaomi/mimo-v2.5": { providerID: "opencode-go", modelID: "mimo-v2.5" },
  "opencode/mimo-v2.5": { providerID: "opencode-go", modelID: "mimo-v2.5" },
  "opencode/mimo-v2.5-free": { providerID: "opencode-go", modelID: "mimo-v2.5" },
}

export class UnsupportedPiModelError extends Error {
  constructor(
    readonly providerID: string,
    readonly modelID: string,
    cause?: unknown,
  ) {
    super(`Pi runtime does not support provider/model "${providerID}/${modelID}". Configure a Pi-supported provider/model.`, {
      cause,
    })
    this.name = "UnsupportedPiModelError"
  }
}

export interface Interface {
  readonly resolve: (model: {
    providerID: ProviderID | string
    id?: ModelID | string
    modelID?: ModelID | string
  }) => Effect.Effect<Model<any>, UnsupportedPiModelError>
  readonly getApiKey: (providerID: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@openagent/PiModelRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service

    const resolve: Interface["resolve"] = Effect.fn("PiModelRegistry.resolve")(function* (model) {
      const providerID = String(model.providerID)
      const modelID = String(model.modelID ?? model.id)
      const mapped = modelMap[`${providerID}/${modelID}`]
      const piProvider = mapped?.providerID ?? providerMap[providerID]
      const piModelID = mapped?.modelID ?? modelID
      if (!piProvider || !getProviders().includes(piProvider as any)) {
        return yield* Effect.fail(new UnsupportedPiModelError(providerID, modelID))
      }
      try {
        return getPiModel(piProvider as any, piModelID as never) as Model<any>
      } catch (cause) {
        return yield* Effect.fail(new UnsupportedPiModelError(providerID, modelID, cause))
      }
    })

    const getApiKey: Interface["getApiKey"] = Effect.fn("PiModelRegistry.getApiKey")(function* (providerID) {
      const cfg = yield* config.get()
      const candidateProviderIDs =
        providerID === "opencode-go" ? ["opencode-go", "opencode"] : providerID === "opencode" ? ["opencode", "opencode-go"] : [providerID]
      for (const candidate of candidateProviderIDs) {
        const direct = cfg.provider?.[candidate]?.options?.apiKey
        if (typeof direct === "string" && direct.trim()) return direct
      }
      for (const candidate of candidateProviderIDs) {
        const info = yield* auth.get(candidate).pipe(Effect.orElseSucceed(() => undefined))
        if (info?.type === "api") return info.key
        if (info?.type === "wellknown") return info.key
        if (info?.type === "oauth") return info.access
      }
      return undefined
    })

    return Service.of({ resolve, getApiKey })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Auth.defaultLayer), Layer.provide(Config.defaultLayer))

export function openAgentProviderToPi(providerID: ProviderID | string) {
  return providerMap[String(providerID)]
}

export function isPiSupportedProvider(providerID: ProviderID | string) {
  return Boolean(openAgentProviderToPi(providerID))
}

export type OpenAgentPiModel = Provider.Model

export * as OpenAgentPiModelRegistry from "./model-registry"
