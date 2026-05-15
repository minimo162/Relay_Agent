# Relay Sidecar

Relay Sidecar is the hard-cutover host for the browser Workbench. It serves the
static UI, exposes localhost APIs, records run ledgers under user-local app
data, and owns local tool readiness checks.

The sidecar binds to `127.0.0.1` only. State-changing API calls require the
per-run launch token through `X-Relay-Token` or `?token=...`.

```bash
dotnet run --project apps/sidecar/Relay.Sidecar.csproj
```

Build the workbench before running a packaged sidecar:

```bash
pnpm --filter @relay-agent/workbench build
```
