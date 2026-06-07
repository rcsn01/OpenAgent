import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createAutomationActions, normalizeAutomationState, type AutomationState } from "./store"

describe("automation store", () => {
  test("normalizes persisted automations and trims run history", () => {
    const state = normalizeAutomationState({
      automations: [
        {
          id: "atm_1",
          name: "Crash scan",
          prompt: "check logs",
          directory: "/repo",
          schedule: { type: "interval", minutes: 0 },
          status: "other",
          runs: Array.from({ length: 25 }, (_, i) => ({
            id: `run_${i}`,
            automationID: "atm_1",
            directory: "/repo",
            status: "succeeded",
            startedAt: i + 1,
          })),
        },
      ],
    })

    expect(state.automations).toHaveLength(1)
    expect(state.automations[0]?.status).toBe("active")
    expect(state.automations[0]?.schedule).toEqual({ type: "interval", minutes: 1 })
    expect(state.automations[0]?.runs).toHaveLength(20)
  })

  test("creates, edits, pauses, deletes, and records failed runs", async () => {
    await createRoot(async (dispose) => {
      const [store, setStore] = createStore<AutomationState>({ automations: [] })
      const actions = createAutomationActions({
        store,
        setStore,
        createClient: () =>
          ({
            session: {
              create: async () => {
                throw new Error("boom")
              },
            },
          }) as any,
        globalSync: {
          child: () => [{ session: [] }, () => undefined],
        } as any,
      })

      const created = actions.create({
        name: "One",
        prompt: "Run",
        directory: "/repo",
        schedule: { type: "daily", time: "09:00" },
        status: "active",
      })
      expect(store.automations).toHaveLength(1)

      actions.update(created.id, { name: "Two", status: "paused" })
      expect(store.automations[0]?.name).toBe("Two")
      expect(store.automations[0]?.status).toBe("paused")

      await expect(actions.run(created.id)).rejects.toThrow("boom")
      expect(store.automations[0]?.runs[0]?.status).toBe("failed")
      expect(store.automations[0]?.runs[0]?.error).toContain("boom")

      actions.delete(created.id)
      expect(store.automations).toHaveLength(0)
      dispose()
    })
  })

  test("run now creates a session and sends the prompt with the selected directory", async () => {
    await createRoot(async (dispose) => {
      const calls: string[] = []
      const [store, setStore] = createStore<AutomationState>({ automations: [] })
      const actions = createAutomationActions({
        store,
        setStore,
        createClient: (input) => {
          calls.push(`client:${input.directory}`)
          return {
            session: {
              create: async (body: { title?: string }) => {
                calls.push(`create:${body.title}`)
                return { data: { id: "ses_1", title: body.title, directory: input.directory, time: { created: 1, updated: 1 } } }
              },
              promptAsync: async (body: { sessionID: string; parts: Array<{ text?: string }> }) => {
                calls.push(`prompt:${body.sessionID}:${body.parts[0]?.text}`)
                return { data: undefined }
              },
            },
          } as any
        },
        globalSync: {
          child: () => [{ session: [] }, () => undefined],
        } as any,
      })

      const created = actions.create({
        name: "Nightly",
        prompt: "Summarize",
        directory: "/repo",
        schedule: { type: "daily", time: "09:00" },
        status: "active",
      })

      await actions.run(created.id)
      expect(calls).toEqual(["client:/repo", "create:[Automation] Nightly", "prompt:ses_1:Summarize"])
      expect(store.automations[0]?.runs[0]?.sessionID).toBe("ses_1")
      dispose()
    })
  })

  test("failed prompt runs retain a created session id", async () => {
    await createRoot(async (dispose) => {
      const [store, setStore] = createStore<AutomationState>({ automations: [] })
      const actions = createAutomationActions({
        store,
        setStore,
        createClient: () =>
          ({
            session: {
              create: async () => ({ data: { id: "ses_failed", title: "[Automation] Fails", time: { created: 1, updated: 1 } } }),
              promptAsync: async () => {
                throw new Error("prompt failed")
              },
            },
          }) as any,
        globalSync: {
          child: () => [{ session: [] }, () => undefined],
        } as any,
      })

      const created = actions.create({
        name: "Fails",
        prompt: "Run",
        directory: "/repo",
        schedule: { type: "daily", time: "09:00" },
        status: "active",
      })

      await expect(actions.run(created.id)).rejects.toThrow("prompt failed")
      expect(store.automations[0]?.runs[0]?.sessionID).toBe("ses_failed")
      dispose()
    })
  })

  test("due runner skips paused automations", async () => {
    await createRoot(async (dispose) => {
      let runs = 0
      const [store, setStore] = createStore<AutomationState>({ automations: [] })
      const actions = createAutomationActions({
        store,
        setStore,
        createClient: () => {
          runs += 1
          return {} as any
        },
        globalSync: {
          child: () => [{ session: [] }, () => undefined],
        } as any,
      })

      const created = actions.create({
        name: "Paused",
        prompt: "Run",
        directory: "/repo",
        schedule: { type: "interval", minutes: 5 },
        status: "paused",
      })
      setStore("automations", (item) => item.id === created.id, "nextRunAt", 1)

      actions.runDue(10)
      expect(runs).toBe(0)
      expect(store.automations[0]?.runs).toHaveLength(0)
      dispose()
    })
  })
})
