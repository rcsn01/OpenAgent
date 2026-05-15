import { describe, expect, test } from "bun:test"
import { applyPath, backPath, forwardPath, normalizeTitlebarPath, type TitlebarHistory } from "./titlebar-history"

function history(): TitlebarHistory {
  return { stack: [], index: 0, action: undefined }
}

describe("titlebar history", () => {
  test("normalizes main-panel routes", () => {
    expect(normalizeTitlebarPath("/abc")).toBe("/abc/session")
    expect(normalizeTitlebarPath("/abc/session")).toBe("/abc/session")
    expect(normalizeTitlebarPath("/abc/session/ses_123#message-msg_1")).toBe("/abc/session/ses_123")
    expect(normalizeTitlebarPath("/abc/session?prompt=hello")).toBe("/abc/session")
    expect(normalizeTitlebarPath("/abc/automations")).toBe("/abc/automations")
    expect(normalizeTitlebarPath("/abc/automations/atm_123?x=1#top")).toBe("/abc/automations/atm_123")
  })

  test("append and trim keeps max bounded", () => {
    let state = history()
    state = applyPath(state, "/", 3)
    state = applyPath(state, "/a", 3)
    state = applyPath(state, "/b", 3)
    state = applyPath(state, "/c", 3)

    expect(state.stack).toEqual(["/a/session", "/b/session", "/c/session"])
    expect(state.stack.length).toBe(3)
    expect(state.index).toBe(2)
  })

  test("back and forward indexes stay correct after trimming", () => {
    let state = history()
    state = applyPath(state, "/", 3)
    state = applyPath(state, "/a", 3)
    state = applyPath(state, "/b", 3)
    state = applyPath(state, "/c", 3)

    expect(state.stack).toEqual(["/a/session", "/b/session", "/c/session"])
    expect(state.index).toBe(2)

    const back = backPath(state)
    expect(back?.to).toBe("/b/session")
    expect(back?.state.index).toBe(1)

    const afterBack = applyPath(back!.state, back!.to, 3)
    expect(afterBack.stack).toEqual(["/a/session", "/b/session", "/c/session"])
    expect(afterBack.index).toBe(1)

    const forward = forwardPath(afterBack)
    expect(forward?.to).toBe("/c/session")
    expect(forward?.state.index).toBe(2)

    const afterForward = applyPath(forward!.state, forward!.to, 3)
    expect(afterForward.stack).toEqual(["/a/session", "/b/session", "/c/session"])
    expect(afterForward.index).toBe(2)
  })

  test("action-driven navigation does not push duplicate history entries", () => {
    const state: TitlebarHistory = {
      stack: ["/", "/a", "/b"],
      index: 2,
      action: undefined,
    }

    const back = backPath(state)
    expect(back?.to).toBe("/a")

    const next = applyPath(back!.state, back!.to, 10)
    expect(next.stack).toEqual(["/", "/a", "/b"])
    expect(next.index).toBe(1)
    expect(next.action).toBeUndefined()
  })

  test("equivalent paths do not push duplicate history entries", () => {
    let state = history()
    state = applyPath(state, "/abc")
    state = applyPath(state, "/abc/session")
    state = applyPath(state, "/abc/session?prompt=hello#message-msg_1")

    expect(state.stack).toEqual(["/", "/abc/session"])
    expect(state.index).toBe(1)
  })

  test("external back and forward location changes move the pointer", () => {
    let state = history()
    state = applyPath(state, "/abc/session/a")
    state = applyPath(state, "/abc/automations")
    state = applyPath(state, "/abc/automations/atm_1")

    state = applyPath(state, "/abc/automations")
    expect(state.stack).toEqual(["/", "/abc/session/a", "/abc/automations", "/abc/automations/atm_1"])
    expect(state.index).toBe(2)

    state = applyPath(state, "/abc/automations/atm_1")
    expect(state.stack).toEqual(["/", "/abc/session/a", "/abc/automations", "/abc/automations/atm_1"])
    expect(state.index).toBe(3)
  })
})
