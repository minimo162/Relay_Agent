# File Operations E2E Verification

Task `149` remains manual-only because this environment cannot drive the Windows Tauri shell with a logged-in M365 Copilot session.

## Preconditions

- Windows desktop build is available.
- Relay Agent launches with a logged-in M365 Copilot session.
- A disposable workspace contains:
  - `sample.csv`
  - `notes.txt`
  - at least one `.docx`, `.pptx`, and `.pdf` fixture

## Manual Checklist

1. `file.copy`
   - Ask Copilot to copy `sample.csv` to a new absolute destination path.
   - Confirm the approval UI shows the source and destination paths.
   - Approve execution and verify the copied file exists at the destination.

2. `file.move`
   - Ask Copilot to rename or move `sample.csv`.
   - Confirm the approval UI shows the source and destination paths.
   - Approve execution and verify the original path no longer exists and the new path does.

3. `file.delete`
   - Ask Copilot to delete a disposable file.
   - Confirm the approval UI shows the target path and whether recycle-bin mode is used.
   - Approve execution and verify the file is removed from the workspace.

4. `text.search`
   - Ask Copilot to search `notes.txt` with a regex pattern.
   - Verify the read tool executes automatically and returns matching lines with context.

5. `text.replace`
   - Ask Copilot to replace a regex pattern in `notes.txt`.
   - Confirm the approval UI shows the target path, regex, replacement text, and backup behavior.
   - Approve execution and verify the file contents changed as expected and a `.bak` file exists when backup is enabled.

6. `document.read_text`
   - Ask Copilot to read text from `.docx`, `.pptx`, and `.pdf` fixtures.
   - Verify the read tool executes automatically and returns extracted plain text without requiring approval.

7. **Office hybrid read** (Windows + desktop Office; `PowerShell` + `read_file`)
   - **Script smoke:** From `apps/desktop`, run  
     `pwsh -File scripts/office-hybrid-read-sample.ps1 -Path <absolute-path-to.xlsx> -Mode Excel`  
     (or `-Mode Word` / `Ppt` with a matching file). Confirm stdout is **one JSON line** with `pdfPath`, `structured`, and `sourcePath`.
   - **PDF step:** Ensure LiteParse is available (`prep:liteparse-runner` / bundled app). Invoke **`read_file`** with `path` = the `pdfPath` value (or ask the desktop agent to do so in the same turn after PowerShell). Confirm returned text includes the LiteParse header and layout-oriented content.
   - **Agent turn (optional):** Ask Copilot to use the hybrid pattern (COM extract + temp PDF under `%TEMP%\RelayAgent\office-layout\` + `read_file` on the PDF) for a small `.xlsx` fixture. Approve **`PowerShell`** as needed; confirm **`read_file`** runs on the emitted `.pdf` and that numeric answers match **`structured.value2`** from the PowerShell JSON, not inferred from PDF text alone.

## Expected Outcome

- Read tools (`file.list`, `file.read_text`, `file.stat`, `text.search`, `document.read_text`) auto-run inside the agent loop.
- Write tools (`file.copy`, `file.move`, `file.delete`, `text.replace`) stop at the approval gate and only execute after explicit approval.
- The file-operation preview renders alongside the existing spreadsheet preview UI without regressing workbook flows.
