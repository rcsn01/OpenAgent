import type { Event } from "./types"

type Listener = (directory: string, event: Event) => void

export class EventHub {
  private listeners = new Set<Listener>()

  emit(directory: string, event: Event) {
    for (const listener of this.listeners) listener(directory || "global", event)
  }

  on(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
