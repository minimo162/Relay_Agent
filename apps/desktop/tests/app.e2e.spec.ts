import { test, expect } from "@playwright/test";

async function emitEvent(page: any, event: string, payload: any) {
  await page.evaluate(
    ({ event, payload }) => {
      const s = (window as any).__RELAY_MOCK__;
      s?.emit(event, payload);
    },
    { event, payload },
  );
}

async function openApp(page: any) {
  await page.goto("/");
  await expect(page.getByRole("banner").getByText("Relay Agent", { exact: true })).toBeVisible();
}

function composer(page: any) {
  return page.locator("textarea");
}

test("first run shows onboarding preflight and hides app chrome", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Confirm the basics, then send your first request")).toBeVisible();
  await expect(page.getByText("Copilot connection", { exact: true })).toBeVisible();
  await expect(page.getByText("Copilot signed in", { exact: true })).toHaveCount(0);
  await expect(page.getByText("CDP reachable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Conversations" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Integrations" })).toHaveCount(0);
  await expect(page.locator("[data-ra-footer-session]")).toHaveCount(0);
});

test("settings modal exposes setup and advanced controls", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Project folder", { exact: true })).toBeVisible();
  await expect(dialog.getByText("New conversation mode", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Copilot connection", { exact: true })).toBeVisible();
  const advanced = dialog.locator("details.ra-settings-details");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("Browser debug port", { exact: true })).not.toBeVisible();
  await advanced.locator("summary").click();
  await expect(dialog.getByText("Browser debug port", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Always on top", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export diagnostics" })).toBeVisible();
});

test("sending the first prompt exits onboarding and creates one conversation", async ({ page }) => {
  await openApp(page);
  await composer(page).fill("review the workspace");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".ra-session-row")).toHaveCount(1);
  await expect(page.getByText("What happens next")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
  await expect(page.locator("[data-ra-footer-session]")).toBeVisible();
});

test("tool rows use human labels instead of raw tool names", async ({ page }) => {
  await openApp(page);
  await composer(page).fill("inspect file");
  await composer(page).press("Control+Enter");
  await emitEvent(page, "agent:tool_start", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
    input: { path: "/tmp/demo.txt" },
  });
  await emitEvent(page, "agent:tool_result", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
    content: JSON.stringify({
      type: "text",
      file: { filePath: "/tmp/demo.txt", numLines: 12, startLine: 1, totalLines: 12, content: "hello" },
    }),
    isError: false,
  });
  await expect(page.getByText("Read file", { exact: true })).toBeVisible();
  await expect(page.getByText("/tmp/demo.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("12 lines loaded of 12")).toBeVisible();
  await expect(page.getByText("read_file")).toHaveCount(0);
});

test("approval overlay uses updated copy and advanced details label", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:approval_needed", {
    sessionId: "session-e2e-1",
    approvalId: "approval-1",
    toolName: "write_file",
    description: "Create or overwrite a file?",
    target: "/tmp/output.txt",
    input: { path: "/tmp/output.txt", content: "hello" },
    workspaceCwdConfigured: true,
  });
  await expect(page.getByRole("button", { name: "Always allow in this conversation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow in this folder" })).toBeVisible();
  await expect(page.getByText("Advanced details")).toBeVisible();
});
