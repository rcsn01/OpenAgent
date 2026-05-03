import { expect, test } from "@playwright/test"
import {
  base64Url,
  createGeneralChat,
  createGitProject,
  createProjectSession,
  deleteGeneralChats,
  deleteProjectSessions,
  waitForGeneralChatTurn,
  seedAppState,
  sessionRoute,
} from "./helpers"

test("boots the main shell with an opened project session", async ({ page }, testInfo) => {
  const projectDirectory = await createGitProject(testInfo, "shell-project", {
    "src/index.ts": "export const ready = true\n",
  })

  await deleteGeneralChats()
  await deleteProjectSessions(projectDirectory)

  const session = await createProjectSession({
    directory: projectDirectory,
    prompt: "Reply with exactly SHELL_READY",
  })

  await seedAppState(page, {
    projects: [{ worktree: projectDirectory, expanded: true, pinned: false }],
    lastProject: projectDirectory,
    sidebar: { opened: true, width: 256 },
  })

  await page.goto(sessionRoute(projectDirectory, session))

  await expect(page.getByRole("navigation", { name: "Projects and sessions" })).toBeVisible()
  await expect(page.getByRole("button", { name: "shell-project" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "build" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Big Pickle" })).toBeVisible()
  await expect(page.locator("[data-action='prompt-submit']")).toBeVisible()
  await expect(page.getByText("SHELL_READY", { exact: true })).toBeVisible()
})

test("exposes the left sidebar global navigation outcomes", async ({ page }) => {
  await deleteGeneralChats()

  await seedAppState(page, {
    projects: [],
    sidebar: { opened: true, width: 256 },
  })

  await page.goto("/")

  await expect(page.getByText("No projects open", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("No chats yet", { exact: true }).first()).toBeVisible()

  await page.getByRole("button", { name: "Search" }).click()
  await expect(page.getByText("Search chats", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Plugins" }).click()
  await expect(page.getByText("Open a project first", { exact: true })).toBeVisible()
  await expect(page.getByText("Plugins are managed per workspace.", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Automations" }).click()
  await expect(page.getByText("Automations aren't available yet", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("tab", { name: "General" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Providers" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "New chat" }).click()
  await expect(page.getByRole("heading", { name: "Open project" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Search folders" })).toBeVisible()
})

test("creates a general chat, renders a reply, and keeps it across reload", async ({ page }) => {
  await deleteGeneralChats()

  await seedAppState(page, {
    projects: [],
    sidebar: { opened: true, width: 256 },
  })

  await page.goto("/chat")

  await expect(page.getByText("No chats yet", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "chat", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Big Pickle" })).toBeVisible()

  const prompt = page.getByRole("textbox", { name: "Ask anything..." })
  await prompt.click()
  const userText = "Reply with exactly CHAT_READY"
  await prompt.fill(userText)
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/chat\/[^/]+$/)

  const sessionID = page.url().match(/\/chat\/([^/?#]+)/)?.[1]
  if (!sessionID) throw new Error("General chat session id was not present in the URL")

  await waitForGeneralChatTurn({
    sessionID,
    userText,
    assistantText: /^CHAT_READY$/,
  })

  await expect(page.locator("p").filter({ hasText: /^CHAT_READY$/ })).toBeVisible()

  const url = page.url()
  await page.reload()

  await expect(page).toHaveURL(url)
  await expect(page.locator("p").filter({ hasText: /^CHAT_READY$/ })).toBeVisible()
  await expect(page.getByText("Chat · Big Pickle", { exact: true })).toBeVisible()
})

test("submits a new general chat prompt once and settles with a completed assistant turn", async ({ page }) => {
  await deleteGeneralChats()

  await seedAppState(page, {
    projects: [],
    sidebar: { opened: true, width: 256 },
  })

  await page.goto("/chat")

  const userText = "Reply with exactly CHAT_REGRESSION_READY"
  const prompt = page.getByRole("textbox", { name: "Ask anything..." })
  await prompt.click()
  await prompt.fill(userText)
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/chat\/[^/]+$/)

  const sessionID = page.url().match(/\/chat\/([^/?#]+)/)?.[1]
  if (!sessionID) throw new Error("General chat session id was not present in the URL")

  await waitForGeneralChatTurn({
    sessionID,
    userText,
    assistantText: /^CHAT_REGRESSION_READY$/,
  })

  await expect(page.locator("[data-component='user-message']").filter({ hasText: userText })).toHaveCount(1)
  await expect(page.locator("p").filter({ hasText: /^CHAT_REGRESSION_READY$/ })).toBeVisible()
})

test("handles a Word document request without duplicating the prompt or stalling the chat", async ({ page }) => {
  await deleteGeneralChats()

  await seedAppState(page, {
    projects: [],
    sidebar: { opened: true, width: 256 },
  })

  await page.goto("/chat")

  const userText = "Make a word doc, i want to test to see if you can make a word doc."
  const prompt = page.getByRole("textbox", { name: "Ask anything..." })
  await prompt.click()
  await prompt.fill(userText)
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page).toHaveURL(/\/chat\/[^/]+$/)

  const sessionID = page.url().match(/\/chat\/([^/?#]+)/)?.[1]
  if (!sessionID) throw new Error("General chat session id was not present in the URL")

  await waitForGeneralChatTurn({
    sessionID,
    userText,
  })

  await expect(page.locator("[data-component='user-message']").filter({ hasText: userText })).toHaveCount(1)
  await expect(page.locator("[data-action='prompt-submit']")).toBeVisible()
})

test("opens an existing general chat route and redirects away from a missing chat", async ({ page }) => {
  await deleteGeneralChats()

  const chat = await createGeneralChat({
    prompt: "Reply with exactly CHAT_ROUTE_READY",
  })

  await seedAppState(page, {
    projects: [],
    sidebar: { opened: true, width: 256 },
  })

  await page.goto(`/chat/${chat.rootSessionID}`)
  await expect(page.locator("p").filter({ hasText: /^CHAT_ROUTE_READY$/ })).toBeVisible()

  await page.goto("/chat/not-a-real-chat")
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByRole("textbox", { name: "Ask anything..." })).toBeVisible()
})

test("opens the latest project session and starts a new project draft from the sidebar", async ({ page }, testInfo) => {
  const projectDirectory = await createGitProject(testInfo, "resume-project")
  await deleteProjectSessions(projectDirectory)

  await createProjectSession({
    directory: projectDirectory,
    prompt: "Reply with exactly FIRST_PROJECT_READY",
  })
  const latest = await createProjectSession({
    directory: projectDirectory,
    prompt: "Reply with exactly LATEST_PROJECT_READY",
  })

  await seedAppState(page, {
    projects: [{ worktree: projectDirectory, expanded: true, pinned: false }],
    lastProject: projectDirectory,
    sidebar: { opened: true, width: 256 },
  })

  await page.goto("/")

  const projectSection = page.locator("section").filter({
    has: page.getByRole("button", { name: "resume-project" }),
  })

  await projectSection.getByRole("button", { name: "resume-project" }).click()
  await expect(page).toHaveURL(sessionRoute(projectDirectory, latest))
  await expect(page.locator("p").filter({ hasText: /^LATEST_PROJECT_READY$/ })).toBeVisible()

  await page.goto("/")

  await page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "resume-project" }) })
    .getByRole("button", { name: "New session" })
    .click()

  await expect(page).toHaveURL(`/${base64Url(projectDirectory)}/session`)
  await expect(page.getByRole("textbox", { name: "Ask anything..." })).toBeVisible()
})

test("reopens remembered project sessions and persists project actions", async ({ page }, testInfo) => {
  const alphaDirectory = await createGitProject(testInfo, "alpha-project")
  const betaDirectory = await createGitProject(testInfo, "beta-project")

  await deleteProjectSessions(alphaDirectory)
  await deleteProjectSessions(betaDirectory)

  const remembered = await createProjectSession({
    directory: alphaDirectory,
    prompt: "Reply with exactly REMEMBERED_PROJECT_READY",
  })
  await createProjectSession({
    directory: betaDirectory,
    prompt: "Reply with exactly BETA_PROJECT_READY",
  })

  await seedAppState(page, {
    projects: [
      { worktree: alphaDirectory, expanded: true, pinned: false },
      { worktree: betaDirectory, expanded: true, pinned: false },
    ],
    lastProject: alphaDirectory,
    sidebar: { opened: true, width: 256 },
    layoutPage: {
      lastProjectSession: {
        [alphaDirectory]: {
          directory: alphaDirectory,
          id: remembered.id,
          at: Date.now(),
        },
      },
    },
  })

  await page.goto("/")
  const sidebar = page.getByRole("navigation", { name: "Projects and sessions" })
  await page.getByRole("button", { name: "alpha-project" }).click()

  await expect(page).toHaveURL(sessionRoute(alphaDirectory, remembered))
  await expect(page.locator("p").filter({ hasText: /^REMEMBERED_PROJECT_READY$/ })).toBeVisible()

  await page.goto("/")

  const alphaSection = sidebar.locator("section").filter({
    has: page.getByRole("button", { name: "alpha-project" }),
  })
  const betaSection = sidebar.locator("section").filter({
    has: page.getByRole("button", { name: "beta-project" }),
  })
  const alphaMenuTrigger = alphaSection.getByRole("button", { name: "More options" })
  const betaMenuTrigger = betaSection.getByRole("button", { name: "More options" })

  await alphaMenuTrigger.click({ force: true })
  await expect(page.getByRole("menuitem", { name: "Pin project" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Create permanent worktree" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Archive chats" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Remove" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Finder" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Pin project" }).click()

  await expect(sidebar.getByText("Pinned", { exact: true }).first()).toBeVisible()

  await page.reload()
  await expect(sidebar.getByText("Pinned", { exact: true }).first()).toBeVisible()

  await alphaMenuTrigger.click({ force: true })
  await expect(page.getByRole("menuitem", { name: "Unpin project" })).toBeVisible()
  await page.keyboard.press("Escape")

  await alphaMenuTrigger.click({ force: true })
  await page.getByRole("menuitem", { name: "Archive chats" }).click()

  await expect(page.getByRole("heading", { name: "Archive chats" })).toBeVisible()
  await page.getByRole("button", { name: "Archive", exact: true }).click()

  await expect(page.getByText("Chats archived", { exact: true })).toBeVisible()
  await expect(page.getByText("Archived 1 chat.", { exact: true })).toBeVisible()
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("button", { name: "alpha-project" }) })
      .getByText("No chats yet", { exact: true }),
  ).toBeVisible()

  await betaMenuTrigger.click({ force: true })
  await page.getByRole("menuitem", { name: "Remove" }).click()

  await expect(page.getByRole("button", { name: "beta-project" })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole("button", { name: "beta-project" })).toHaveCount(0)
})

test("resizes the review pane and exposes the file tree resize handle", async ({ page }, testInfo) => {
  const projectDirectory = await createGitProject(testInfo, "resize-project", {
    "README.md": "# Resize project\n",
    "src/index.ts": "export const value = 1\n",
  })

  await deleteProjectSessions(projectDirectory)

  const session = await createProjectSession({
    directory: projectDirectory,
    prompt: "Reply with exactly RESIZE_READY",
  })

  await seedAppState(page, {
    projects: [{ worktree: projectDirectory, expanded: true, pinned: false }],
    lastProject: projectDirectory,
    sidebar: { opened: true, width: 256 },
  })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(sessionRoute(projectDirectory, session))

  await expect(page.locator("p").filter({ hasText: /^RESIZE_READY$/ })).toBeVisible()

  const handles = page.locator("[data-component='resize-handle'][data-direction='horizontal']")
  await expect(handles).toHaveCount(2)

  const reviewPanel = page.getByRole("complementary", { name: "Review and files" })
  const initialReviewWidth = (await reviewPanel.boundingBox())?.width
  const reviewHandleBox = await handles.first().boundingBox()

  if (!initialReviewWidth || !reviewHandleBox) throw new Error("Review panel resize handle was not measurable")

  await page.mouse.move(reviewHandleBox.x + reviewHandleBox.width / 2, reviewHandleBox.y + reviewHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(reviewHandleBox.x - 140, reviewHandleBox.y + reviewHandleBox.height / 2)
  await page.mouse.up()

  const widenedReviewWidth = (await reviewPanel.boundingBox())?.width
  expect(widenedReviewWidth).toBeDefined()
  expect(widenedReviewWidth).toBeGreaterThan(initialReviewWidth + 80)

  const fileTreeHandle = handles.nth(1)
  const initialFileTreeHandleBox = await fileTreeHandle.boundingBox()
  if (!initialFileTreeHandleBox) throw new Error("File tree resize handle was not measurable")

  await page.mouse.move(
    initialFileTreeHandleBox.x + initialFileTreeHandleBox.width / 2,
    initialFileTreeHandleBox.y + initialFileTreeHandleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    initialFileTreeHandleBox.x + 120,
    initialFileTreeHandleBox.y + initialFileTreeHandleBox.height / 2,
  )
  await page.mouse.up()

  const resizedFileTreeHandleBox = await fileTreeHandle.boundingBox()
  expect(resizedFileTreeHandleBox).toBeDefined()
  expect(resizedFileTreeHandleBox!.x).toBeGreaterThan(initialFileTreeHandleBox.x + 40)
})
