export const MAX_TITLEBAR_HISTORY = 100

export type TitlebarAction = "back" | "forward" | undefined

export type TitlebarHistory = {
  stack: string[]
  index: number
  action: TitlebarAction
}

export function normalizeTitlebarPath(input: string) {
  const url = new URL(input, "http://openagent.local")
  const path = url.pathname.replace(/\/+$/, "") || "/"
  const segments = path.split("/").filter(Boolean)

  if (segments.length === 1) return `/${segments[0]}/session`
  if (segments.length === 2 && segments[1] === "session") return `/${segments[0]}/session`
  if (segments.length === 3 && segments[1] === "session") return `/${segments[0]}/session/${segments[2]}`
  if (segments.length === 2 && segments[1] === "automations") return `/${segments[0]}/automations`
  if (segments.length === 3 && segments[1] === "automations") return `/${segments[0]}/automations/${segments[2]}`

  return path
}

export function applyPath(state: TitlebarHistory, current: string, max = MAX_TITLEBAR_HISTORY): TitlebarHistory {
  current = normalizeTitlebarPath(current)
  if (!state.stack.length) {
    const stack = current === "/" ? ["/"] : ["/", current]
    return { stack, index: stack.length - 1, action: undefined }
  }

  const active = state.stack[state.index]
  if (current === active) {
    if (!state.action) return state
    return { ...state, action: undefined }
  }

  if (state.action) return { ...state, action: undefined }

  if (state.index > 0 && state.stack[state.index - 1] === current) {
    return { ...state, index: state.index - 1, action: undefined }
  }

  if (state.index < state.stack.length - 1 && state.stack[state.index + 1] === current) {
    return { ...state, index: state.index + 1, action: undefined }
  }

  return pushPath(state, current, max)
}

export function pushPath(state: TitlebarHistory, path: string, max = MAX_TITLEBAR_HISTORY): TitlebarHistory {
  path = normalizeTitlebarPath(path)
  const stack = state.stack.slice(0, state.index + 1).concat(path)
  const next = trimHistory(stack, stack.length - 1, max)
  return { ...state, ...next, action: undefined }
}

export function trimHistory(stack: string[], index: number, max = MAX_TITLEBAR_HISTORY) {
  if (stack.length <= max) return { stack, index }
  const cut = stack.length - max
  return {
    stack: stack.slice(cut),
    index: Math.max(0, index - cut),
  }
}

export function backPath(state: TitlebarHistory) {
  if (state.index <= 0) return
  const index = state.index - 1
  const to = state.stack[index]
  if (!to) return
  return { state: { ...state, index, action: "back" as const }, to }
}

export function forwardPath(state: TitlebarHistory) {
  if (state.index >= state.stack.length - 1) return
  const index = state.index + 1
  const to = state.stack[index]
  if (!to) return
  return { state: { ...state, index, action: "forward" as const }, to }
}
