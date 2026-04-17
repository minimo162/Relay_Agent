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
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.locator(".ra-session-row")).toHaveCount(1);
    await page.getByRole("button", { name: "Chats" }).click();

    await sendPrompt(page, "follow-up task");
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.locator(".ra-session-row")).toHaveCount(1);
    await expect(page.getByText("follow-up task")).toBeVisible();
  });

  test("starting a new conversation creates a second row", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "task one");
    await expect(page.getByRole("button", { name: "Chats" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Chats" }).click();
    await page
      .locator("[data-ra-shell-drawer='sessions']")
      .getByRole("button", { name: "New chat" })
      .click();
    await sendPrompt(page, "task two");
    await page.getByRole("button", { name: "Chats" }).click();
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

  test("normal chat opens chats and context from drawer triggers", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await seedWorkspace(page);
    await openApp(page);
    await sendPrompt(page, "open the shell");
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await page.getByRole("button", { name: "Chats" }).click();
    await expect(page.locator("[data-ra-shell-drawer='sessions']")).toHaveCount(0);
    await page.getByRole("button", { name: "Context" }).click();
    await expect(page.locator("[data-ra-shell-drawer='context']")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Integrations" })).toBeVisible();
    await expect(page.getByText("Conversation drives the work.")).toBeVisible();
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
    await expect(approvalCard.getByRole("button", { name: "Allow once" })).toBeVisible();
    await expect(approvalCard.getByRole("button", { name: "Always allow in this conversation" })).toBeVisible();
    await expect(approvalCard.getByRole("button", { name: "Always allow in this folder" })).toBeVisible();
    await expect(approvalCard.getByText("bash")).toBeVisible();
    await expect(approvalCard.getByText("npm test @ /tmp/project")).toBeVisible();
    await approvalCard.getByRole("button", { name: "Allow once" }).click();
    await expect(approvalCard).toContainText("Allowed");
    await expect(approvalCard.getByRole("button", { name: "Allow once" })).toHaveCount(0);
  });
});
