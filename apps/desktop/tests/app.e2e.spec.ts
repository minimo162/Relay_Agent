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

function composer(page: any) {
  return page.locator("textarea");
}

test("first run shows onboarding preflight and hides app chrome", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Set up once, then ask for the result you want")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm the Copilot connection" })).toBeVisible();
  await expect(page.getByText("Copilot signed in", { exact: true })).toHaveCount(0);
  await expect(page.getByText("CDP reachable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversations" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Integrations" })).toHaveCount(0);
  await expect(page.locator("[data-ra-footer-session]")).toHaveCount(0);
});

test("settings modal exposes setup and advanced controls", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Project folder/)).toBeVisible();
  await expect(dialog.getByText(/New conversation mode/)).toBeVisible();
  await expect(dialog.getByText("Step 2 · Copilot connection")).toBeVisible();
  const advanced = dialog.locator("details.ra-settings-details");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("Browser debug port", { exact: true })).not.toBeVisible();
  await advanced.locator("summary").click();
  await expect(dialog.getByText("Browser debug port", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Always on top", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export diagnostics" })).toBeVisible();
});

test("sending the first prompt exits onboarding and creates one conversation", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: true });
  await openApp(page);
  await composer(page).fill("review the workspace");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".ra-session-row")).toHaveCount(1);
  await expect(page.getByText("What appears here once work starts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test("tool rows use human labels instead of raw tool names", async ({ page }) => {
  await injectRelayMock(page, { autoComplete: false });
  await openApp(page);
  await composer(page).fill("inspect file");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
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
  await openApp(page);
  await composer(page).fill("prepare approval");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
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
  await openApp(page);
  await composer(page).fill("stream a reply");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
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
