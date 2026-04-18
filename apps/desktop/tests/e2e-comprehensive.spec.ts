import { test, expect } from "@playwright/test";
import {
  emitAgentEvent,
  injectRelayMock,
  waitForAgentListener,
  waitForMockSession,
} from "./relay-e2e-harness";

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "networkidle", timeout: 15000 });
  await expect(page.getByRole("banner").getByText("Relay Agent", { exact: true })).toBeVisible();
}

async function seedWorkspace(page: any, path = "/mock/project") {
  await page.addInitScript((workspacePath) => {
    window.localStorage.setItem("relay.settings.workspacePath", workspacePath);
  }, path);
}

async function sendPrompt(page: any, text: string) {
  const textarea = page.locator("textarea");
  await expect(textarea).toBeEditable({ timeout: 5000 });
  await textarea.fill(text);
  await textarea.press("Control+Enter");
}

test.describe("Conversation model", () => {
  test("continuing an idle conversation does not create a new row", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "first task");
    await expect(page.locator(".ra-session-row")).toHaveCount(1);

    await sendPrompt(page, "follow-up task");
    await expect(page.locator(".ra-session-row")).toHaveCount(1);
    await expect(page.getByText("follow-up task")).toBeVisible();
  });

  test("starting a new conversation creates a second row", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "task one");
    await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible({ timeout: 5000 });
    await page
      .locator("[data-ra-shell-drawer='sessions']")
      .getByRole("button", { name: "New chat" })
      .click();
    await sendPrompt(page, "task two");
    await expect(page.locator(".ra-session-row")).toHaveCount(2);
    await page
      .locator("[data-ra-shell-drawer='sessions']")
      .getByRole("button", { name: "New chat" })
      .click();
    await expect(page.locator("[data-ra-composer-textarea]")).toBeEditable();
  });
});

test.describe("Settings and first-run UX", () => {
  test("first-run keeps the normal shell and shows setup in the feed", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await openApp(page);
    await expect(page.getByRole("button", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Context" })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Start with the outcome you need.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.locator("[data-ra-setup-card]")).toBeVisible();
    await expect(page.locator("[data-ra-session-mode]")).toHaveCount(0);
    await expect(page.locator("[data-ra-composer-disabled-note]")).toHaveCount(0);
  });

  test("settings modal shows connection and advanced controls", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
    const advanced = dialog.locator("details.ra-settings-details");
    await expect(advanced).not.toHaveAttribute("open", "");
    await expect(dialog.getByText("Browser debug port")).not.toBeVisible();
    await advanced.locator("summary").click();
    await expect(dialog.getByText("Browser debug port")).toBeVisible();
    await expect(dialog.getByText("Response timeout (ms)")).toBeVisible();
    await expect(dialog.getByText("Always on top")).toBeVisible();
  });

  test("normal chat surfaces sidebar and context rail persistently on wide viewport", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "open the shell");
    await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible();
    await expect(page.locator("[data-ra-shell-drawer='context']")).toBeVisible();
    const rail = page.locator("[data-ra-shell-drawer='context']");
    await expect(rail.getByText("Plan", { exact: true })).toBeVisible();
    await expect(rail.getByText("Session", { exact: true })).toBeVisible();
    await expect(rail.getByText("Integrations", { exact: true })).toBeVisible();
    await expect(rail.getByText("Keys", { exact: true })).toBeVisible();
  });

  test("narrow layout keeps drawer controls and composer actions usable", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await sendPrompt(page, "open the shell");
    await expect(page.getByRole("button", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Context" })).toBeVisible();
    await expect(page.getByTestId("composer-send")).toBeVisible();
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible();
  });

  test("first-run send keeps the draft and shows setup requirements", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await openApp(page);
    await sendPrompt(page, "open the shell");
    await expect(page.locator("[data-ra-first-run-requirements]")).toBeVisible();
    await expect(page.locator("textarea")).toHaveValue("open the shell");
    await expect(page.locator(".ra-session-row")).toHaveCount(0);
  });
});

test.describe("Audit and approvals", () => {
  test("tool audit row renders human labels with input-derived target", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: false });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "inspect files");
    await waitForMockSession(page, "session-e2e-1");
    await waitForAgentListener(page, "agent:tool_start");
    await waitForAgentListener(page, "agent:tool_result");
    await emitAgentEvent(page, "agent:tool_start", {
      sessionId: "session-e2e-1",
      toolUseId: "tool-1",
      toolName: "grep_search",
      input: { pattern: "TODO", path: "/tmp/project" },
    });
    await emitAgentEvent(page, "agent:tool_result", {
      sessionId: "session-e2e-1",
      toolUseId: "tool-1",
      toolName: "grep_search",
      content: JSON.stringify({ numFiles: 2, numMatches: 4 }),
      isError: false,
    });
    await expect(page.getByText("Search file contents")).toBeVisible();
    await expect(page.getByText("TODO · /tmp/project")).toBeVisible();
    await expect(page.getByText("4 hits across 2 files")).toBeVisible();
  });

  test("approval requests render inline with conversation/folder actions", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: false });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "prepare approval");
    await waitForMockSession(page, "session-e2e-1");
    await waitForAgentListener(page, "agent:approval_needed");
    await emitAgentEvent(page, "agent:approval_needed", {
      sessionId: "session-e2e-1",
      approvalId: "approval-1",
      toolName: "bash",
      description: "Run a shell command?",
      target: "npm test @ /tmp/project",
      input: { command: "npm test", cwd: "/tmp/project" },
      workspaceCwdConfigured: true,
    });
    const approvalCard = page.locator("[data-ra-approval-card][data-approval-id='approval-1']");
    await expect(page.getByRole("dialog", { name: "Permission required" })).toHaveCount(0);
    await expect(approvalCard.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
    await expect(approvalCard.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
    await approvalCard.getByRole("button", { name: /^Remember/ }).click();
    await expect(approvalCard.getByRole("menuitem", { name: "Always in this conversation" })).toBeVisible();
    await expect(approvalCard.getByRole("menuitem", { name: "Always in this project" })).toBeVisible();
    await expect(approvalCard.getByText("bash")).toBeVisible();
    await expect(approvalCard.getByText("npm test @ /tmp/project")).toBeVisible();
    await approvalCard.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(approvalCard).toContainText("Allowed");
    await expect(approvalCard.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
  });
});
