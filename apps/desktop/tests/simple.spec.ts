import { test, expect } from '@playwright/test';

test('page loads HTML', async ({ page }) => {
  // Inject mock BEFORE the app's JS runs
  await page.addInitScript(() => {
    (window as any).__RELAY_MOCK__ = {
      sessionCounter: 0,
      sessions: new Map(),
      listeners: new Map(),
      emit(event: any, payload: any) {
        const fns = this.listeners.get(event);
        if (fns) for (const fn of fns) fn({ payload });
      },
    };
    // Mock Tauri API
    const mock = (window as any).__RELAY_MOCK__;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        const req = args?.request ?? args ?? {};
        if (cmd === 'start_agent') { mock.sessionCounter++; const id = `session-e2e-${mock.sessionCounter}`; mock.sessions.set(id, {running: true}); return id; }
        if (cmd === 'respond_approval') return undefined;
        if (cmd === 'cancel_agent') { const s = mock.sessions.get(req.sessionId); if (s) s.running = false; return undefined; }
        if (cmd === 'get_session_history') { const s = mock.sessions.get(req.sessionId); return { sessionId: req.sessionId, running: s?.running ?? false, messages: [] }; }
        if (cmd === 'warmup_copilot_bridge') return { connected: true, loginRequired: false, url: null, error: null };
        if (cmd === 'get_relay_diagnostics') return { appVersion: '0', targetOs: 'linux', copilotNodeBridgePort: 18080, defaultEdgeCdpPort: 9360, relayAgentDevMode: false, architectureNotes: 'mock' };
        throw new Error(`Unknown: ${cmd}`);
      }
    };
    (window as any).__TAURI_EVENT__ = {
      listen: async (event: string, handler: any) => {
        if (!mock.listeners.has(event)) mock.listeners.set(event, new Set());
        mock.listeners.get(event).add(handler);
        return () => { mock.listeners.get(event)?.delete(handler); };
      }
    };
  });
  await page.goto('/');
  await page.waitForTimeout(2000);
  // Get full HTML
  const html = await page.content();
  console.log('HTML length:', html.length);
  const body = await page.locator('body').innerText();
  console.log('Body text (first 1000):', body.substring(0, 1000));
  // Check if Solid app even tried to render
  const hasRoot = await page.$('#root');
  const rootHTML = await hasRoot?.innerHTML();
  console.log('root innerHTML (first 500):', rootHTML?.substring(0, 500));
  await page.screenshot({ path: '/tmp/playwright-result.png' });
  // Basic assertion
  expect(html.length).toBeGreaterThan(500);
});
