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

function composer(page: any) {
  return page.locator("textarea");
}

async function sendPrompt(page: any, text: string) {
  const textarea = composer(page);
  await expect(textarea).toBeEditable({ timeout: 5000 });
  await textarea.fill(text);
  await textarea.press("Control+Enter");
}

test("first run keeps the normal shell visible and renders setup inline", async ({ page }) => {
  await openApp(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Write the request now. Relay will help finish setup if needed.",
    }),
  ).toBeVisible();
  await expect(page.locator("[data-ra-setup-card]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chats" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Context" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose project" })).toBeVisible();
  await expect(page.locator("[data-ra-session-mode]")).toHaveCount(0);
  await expect(composer(page)).toBeEditable();
  await expect(page.locator("[data-ra-composer-disabled-note]")).toHaveText(
    "Relay keeps the same chat surface and asks for setup only when needed.",
  );
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible();
  await expect(page.getByText("No chats yet")).toBeVisible();
});

test("settings modal exposes setup and advanced controls", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Step 1 · Project/)).toBeVisible();
  await expect(dialog.getByText("Step 2 · Copilot")).toBeVisible();
  const advanced = dialog.locator("details.ra-settings-details");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("Browser debug port", { exact: true })).not.toBeVisible();
  await advanced.locator("summary").click();
  await expect(dialog.getByText("Browser debug port", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Always on top", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export diagnostics" })).toBeVisible();
});

test("sending the first prompt exits onboarding and creates one conversation", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: false });
  await seedWorkspace(page);
  await openApp(page);
  await sendPrompt(page, "review the workspace");
  await expect(page.locator("[data-ra-setup-card]")).toHaveCount(0);
  await expect(page.locator("[data-ra-shell-drawer='sessions']")).toHaveCount(0);
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.locator("[data-ra-shell-drawer='sessions']")).toBeVisible();
  await expect(page.locator(".ra-session-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Context" }).click();
  await expect(page.locator("[data-ra-shell-drawer='context']")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Relay works from the conversation.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
});

test("first-run send keeps the draft and shows setup actions when project is missing", async ({ page }) => {
  await openApp(page);
  await sendPrompt(page, "make the setup simpler");
  const requirements = page.locator("[data-ra-first-run-requirements]");
  await expect(requirements).toBeVisible();
  await expect(requirements.getByRole("button", { name: "Choose project" })).toBeFocused();
  await expect(composer(page)).toHaveValue("make the setup simpler");
  await expect(page.locator(".ra-session-row")).toHaveCount(0);
});

test("tool rows use human labels instead of raw tool names", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: false });
  await seedWorkspace(page);
  await openApp(page);
  await sendPrompt(page, "inspect file");
  await expect(page.getByRole("button", { name: "Chats" })).toBeVisible({ timeout: 5000 });
  await waitForMockSession(page, "session-e2e-1");
  await waitForAgentListener(page, "agent:tool_start");
  await waitForAgentListener(page, "agent:tool_result");

  await emitAgentEvent(page, "agent:tool_start", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
    input: { path: "/tmp/demo.txt" },
  });
  await emitAgentEvent(page, "agent:tool_result", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
    content: JSON.stringify({
      type: "text",
      file: { filePath: "/tmp/demo.txt", numLines: 12, startLine: 1, totalLines: 12, content: "hello" },
    }),
    isError: false,
  });

  const toolRow = page.locator("[data-ra-tool-row]").filter({ hasText: "Read file" }).first();
  await expect(toolRow).toBeVisible();
  await expect(toolRow.getByText("/tmp/demo.txt", { exact: true })).toBeVisible();
  await expect(toolRow.getByText("12 lines loaded of 12")).toBeVisible();
  await expect(toolRow.getByText("Read file", { exact: true })).toBeVisible();
});

test("approval requests render inline instead of blocking the feed", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: false });
  await seedWorkspace(page);
  await openApp(page);
  await sendPrompt(page, "prepare approval");
  await expect(page.getByRole("button", { name: "Chats" })).toBeVisible({ timeout: 5000 });
  await waitForMockSession(page, "session-e2e-1");
  await waitForAgentListener(page, "agent:approval_needed");

  await emitAgentEvent(page, "agent:approval_needed", {
    sessionId: "session-e2e-1",
    approvalId: "approval-1",
    toolName: "write_file",
    description: "Create or overwrite a file?",
    target: "/tmp/output.txt",
    input: { path: "/tmp/output.txt", content: "hello" },
    workspaceCwdConfigured: true,
  });

  const approvalCard = page.locator("[data-ra-approval-card][data-approval-id='approval-1']");
  await expect(page.getByRole("dialog", { name: "Permission required" })).toHaveCount(0);
  await expect(approvalCard.getByRole("button", { name: "Allow once" })).toBeVisible();
  await expect(approvalCard.getByRole("button", { name: "Always allow in this conversation" })).toBeVisible();
  await expect(approvalCard.getByRole("button", { name: "Always allow in this folder" })).toBeVisible();
  await expect(approvalCard.getByText("/tmp/output.txt")).toBeVisible();
});

test("streaming assistant text shows Drafting and suppresses generic working state", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: false });
  await seedWorkspace(page);
  await openApp(page);
  await sendPrompt(page, "stream a reply");
  await expect(page.getByRole("button", { name: "Chats" })).toBeVisible({ timeout: 5000 });
  await waitForMockSession(page, "session-e2e-1");
  await waitForAgentListener(page, "agent:text_delta");

  await emitAgentEvent(page, "agent:text_delta", {
    sessionId: "session-e2e-1",
    text: "First streamed sentence.",
    isComplete: false,
  });

  await expect(page.getByText("Drafting…")).toBeVisible();
  await expect(page.locator("[data-ra-agent-thinking]")).toHaveCount(0);
  await expect(page.getByText("First streamed sentence.")).toBeVisible();

  await emitAgentEvent(page, "agent:text_delta", {
    sessionId: "session-e2e-1",
    text: "",
    isComplete: true,
  });

  await expect(page.getByText("Drafting…")).toHaveCount(0);
});
