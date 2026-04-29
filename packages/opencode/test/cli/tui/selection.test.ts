import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as Clipboard from "../../../src/cli/cmd/tui/util/clipboard"
import * as Selection from "../../../src/cli/cmd/tui/util/selection"

describe("tui selection", () => {
  afterEach(() => {
    mock.restore()
  })

  test("copies text from the provided selection", async () => {
    const copy = spyOn(Clipboard, "copy").mockResolvedValue()
    const shown: Array<{ message: string; variant: "info" | "success" | "warning" | "error" }> = []
    const errors: unknown[] = []
    let cleared = 0

    const result = Selection.copySelection(
      { getSelectedText: () => "copied text" },
      { clearSelection: () => cleared++ },
      {
        show: (input) => shown.push(input),
        error: (error) => errors.push(error),
      },
    )

    expect(result).toBe(true)
    expect(copy).toHaveBeenCalledWith("copied text")
    expect(cleared).toBe(1)

    await Promise.resolve()

    expect(shown).toEqual([{ message: "Copied to clipboard", variant: "info" }])
    expect(errors).toEqual([])
  })

  test("does nothing when the selection is empty", () => {
    const copy = spyOn(Clipboard, "copy").mockResolvedValue()
    let cleared = 0

    const result = Selection.copySelection(
      { getSelectedText: () => "" },
      { clearSelection: () => cleared++ },
      {
        show: () => {},
        error: () => {},
      },
    )

    expect(result).toBe(false)
    expect(copy).not.toHaveBeenCalled()
    expect(cleared).toBe(0)
  })
})
