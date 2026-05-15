# Relay Document Search Sources

This directory is the active TypeScript source for the bundled Relay document
search executor used by the desktop app. It intentionally sits outside
`src/` because these files are transpiled by the document-search bundler, not by
the SolidJS frontend typecheck.

The files were originally imported from the AionUi overlay tree, but the
desktop build and test loader now use this Relay-owned location as the source
of truth.
