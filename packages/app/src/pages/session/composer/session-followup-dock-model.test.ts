import { describe, expect, test } from "bun:test"
import { buildFollowupDockModel } from "./session-followup-dock-model"

describe("buildFollowupDockModel", () => {
  test("keeps a single queued message visible", () => {
    const model = buildFollowupDockModel([{ id: "one", text: "Testing queue UI" }])

    expect(model.total).toBe(1)
    expect(model.items).toEqual([{ id: "one", text: "Testing queue UI" }])
    expect(model.hasMultiple).toBe(false)
  })

  test("keeps all queued messages visible in order", () => {
    const model = buildFollowupDockModel([
      { id: "one", text: "First queued message" },
      { id: "two", text: "Second queued message" },
    ])

    expect(model.total).toBe(2)
    expect(model.items.map((item) => item.id)).toEqual(["one", "two"])
    expect(model.hasMultiple).toBe(true)
  })
})
