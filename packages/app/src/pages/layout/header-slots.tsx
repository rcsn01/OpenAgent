import { createContext, useContext, type JSX } from "solid-js"

type LayoutHeaderSlotsContextValue = {
  setMainCenter(slot: JSX.Element | undefined): void
  setMainTrailing(slot: JSX.Element | undefined): void
}

export const LayoutHeaderSlotsContext = createContext<LayoutHeaderSlotsContextValue>()

export function useLayoutHeaderSlots() {
  const ctx = useContext(LayoutHeaderSlotsContext)
  if (!ctx) throw new Error("LayoutHeaderSlotsContext is missing")
  return ctx
}
