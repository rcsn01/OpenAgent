import * as Clipboard from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

type Selection = {
  getSelectedText: () => string
}

export function copySelection(selection: Selection | null, renderer: Pick<Renderer, "clearSelection">, toast: Toast): boolean {
  const text = selection?.getSelectedText()
  if (!text) return false

  Clipboard.copy(text)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}

export function copy(renderer: Renderer, toast: Toast): boolean {
  return copySelection(renderer.getSelection(), renderer, toast)
}
