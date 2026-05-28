import { InstanceRuntime } from "../project/instance-runtime"
import { EffectContextBridge } from "@/effect/context-bridge"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  const ctx = await InstanceRuntime.load({ directory })
  try {
    return await EffectContextBridge.restore({ instance: ctx }, cb)
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
}
