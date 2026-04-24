# opencode runtime resource

This directory is a checked-in Relay Desktop runtime resource.

Generated files include the bundled `server.js`, Bun executables, migrations,
and runtime assets used by Relay Desktop's embedded opencode tool runtime.
Relay starts these files directly from the Tauri resource directory and does
not require a local opencode checkout at runtime.

The checked-in Bun executables are platform-specific:

- `bun`: Linux x64
- `bun.exe`: Windows x64
