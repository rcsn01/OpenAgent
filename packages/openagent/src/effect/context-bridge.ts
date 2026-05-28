import { AsyncLocalStorage } from "async_hooks"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import type { WorkspaceID } from "@/control-plane/schema"
import type { InstanceContext } from "@/project/instance-context"

export interface EffectContextRefs {
  readonly instance?: InstanceContext
  readonly workspace?: WorkspaceID
}

const storage = new AsyncLocalStorage<EffectContextRefs>()

export function current(): EffectContextRefs {
  return storage.getStore() ?? {}
}

export function restore<R>(refs: EffectContextRefs, fn: () => R): R {
  const previous = current()
  const next: EffectContextRefs = {
    instance: refs.instance ?? previous.instance,
    workspace: refs.workspace ?? previous.workspace,
  }
  const run = () => storage.run(next, fn)
  if (next.workspace !== undefined) return WorkspaceContext.restore(next.workspace, run)
  return run()
}

export * as EffectContextBridge from "./context-bridge"
