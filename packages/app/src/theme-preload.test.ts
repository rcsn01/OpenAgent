import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#F8F7F7" />'
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("openagent-theme-id", "oc-1")
    localStorage.setItem("openagent-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("openagent-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("openagent-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("openagent-theme-css-light")).toBeNull()
    expect(localStorage.getItem("openagent-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("openagent-theme-id", "nightowl")
    localStorage.setItem("openagent-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("keeps light theme-color for resolved light mode", () => {
    run()

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#F8F7F7")
  })

  test("updates theme-color for resolved dark mode", () => {
    localStorage.setItem("openagent-color-scheme", "dark")

    run()

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#131010")
  })
})
