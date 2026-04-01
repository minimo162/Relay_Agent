# Multi-Session Copilot Exploration

## Scope

Task `142` asks whether Relay Agent can safely use multiple M365 Copilot browser sessions for parallel or isolated sub-tasks while staying inside the current Edge CDP approach.

## Current Architecture

- `apps/desktop/scripts/copilot-browser.ts` connects to an already running Edge instance with `chromium.connectOverCDP(...)`.
- The script then resolves a Copilot page and drives a single chat send/read cycle.
- Each command connects, performs one operation, writes structured JSON to stdout, and closes the Playwright CDP connection.
- The real session state lives in the user-owned Edge profile, not in Relay Agent.

## What "Multi-Session" Could Mean

1. Multiple tabs in the same Edge profile, each pinned to a different Copilot thread.
2. Multiple browser contexts created under the same CDP session.
3. Multiple external Edge processes with different remote-debugging ports and possibly different profiles.

## Findings

### Multiple tabs in one profile

Feasible in principle, but not currently safe enough to ship.

- Pros:
  - Works with the existing login model because the user stays in one signed-in Edge profile.
  - Lowest operational overhead.
- Risks:
  - The current script does not identify or persist a specific tab/thread ID.
  - Tab focus changes or app-driven navigation can accidentally reuse the wrong Copilot conversation.
  - M365 Copilot UI selectors are already fragile; adding tab routing increases breakage risk.

### Multiple Playwright browser contexts

Not a good fit for the current product model.

- CDP attaches to the existing Edge session/profile because that is where the M365 login lives.
- Fresh Playwright contexts would not automatically inherit the signed-in Copilot state we depend on.
- Re-implementing authentication is explicitly out of scope for this MVP.

### Multiple Edge processes / profiles

Operationally possible, product-wise too heavy right now.

- It would require profile selection, port allocation, per-profile lifecycle management, and stronger cleanup.
- It also raises user confusion around which signed-in account or chat history is active.
- The current safe vertical slice does not need this complexity.

## Recommended Direction

Defer productizing multi-session Copilot execution for now.

If this becomes necessary later, the smallest credible path is:

1. Add a `chatSessionId` abstraction that maps to a concrete Copilot tab URL or tab handle.
2. Persist that mapping in Relay Agent state.
3. Update `copilot-browser.ts` so every send targets a specific tab instead of "whatever Copilot page is available".
4. Add collision handling for closed tabs, redirected tabs, and stale thread URLs.
5. Re-run live Windows + M365 validation before enabling any concurrency.

## MVP Decision

- Keep the shipped path single-session and single-threaded.
- Preserve the current behavior where manual mode remains the fallback when automation confidence drops.
- Treat multi-session support as a follow-up exploration, not an MVP dependency.

## Open Questions

- Does the current M365 Copilot web app expose stable per-thread URLs or identifiers that survive refresh?
- Are there server-side rate or anti-automation limits when two threads are active in the same signed-in profile?
- Does switching tabs mid-response invalidate the DOM/network capture assumptions in `copilot-browser.ts`?

These questions require live Windows + M365 testing before any implementation should be marked safe.
