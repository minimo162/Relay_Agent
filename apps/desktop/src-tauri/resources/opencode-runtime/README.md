# opencode runtime resource

This directory is populated by:

```sh
cd /root/opencode
bun run --cwd packages/opencode build:relay-runtime
```

Generated files include the bundled `server.js`, Bun executable, migrations,
and runtime assets used by Relay Desktop's embedded opencode tool runtime.
