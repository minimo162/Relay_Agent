#requires -Version 5.1
<#
.SYNOPSIS
  Template: hybrid Office read — COM batch data + ExportAsFixedFormat PDF for read_file/LiteParse.

.DESCRIPTION
  The Relay agent may **inline** this logic in a PowerShell tool command instead of invoking this file.
  Outputs **one JSON object** to stdout: structured data + **pdfPath** (absolute). Call **read_file**
  on pdfPath in the same relay_tool array for layout text.

  Excel: **structured.value2** is source of truth for numbers; PDF/LiteParse is layout hints only.

.PARAMETER Path
  Absolute path to .xlsx, .docx, or .pptx (Office must be installed).

.PARAMETER Mode
  Excel | Word | Ppt

.PARAMETER SheetName
  Excel only; default first worksheet.

.PARAMETER RangeAddress
  Excel only; e.g. "A1:Z100". Default: UsedRange on the sheet.

.NOTES
  Temp PDFs: $env:TEMP\RelayAgent\office-layout\<guid>.pdf
  Use try/finally and Quit(); ScreenUpdating/DisplayAlerts off where applicable.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [ValidateSet('Excel', 'Word', 'Ppt')]
    [string] $Mode,

    [string] $SheetName = '',

    [string] $RangeAddress = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "Path not found: $Path"
}

$resolved = (Resolve-Path -LiteralPath $Path).Path
$layoutRoot = Join-Path $env:TEMP 'RelayAgent\office-layout'
New-Item -ItemType Directory -Force -Path $layoutRoot | Out-Null
$pdfName = [guid]::NewGuid().ToString('n') + '.pdf'
$pdfPath = Join-Path $layoutRoot $pdfName

function Convert-Value2ToJsonable {
    param($v)
    if ($null -eq $v) { return $null }
    if ($v -is [string] -or $v -is [double] -or $v -is [int] -or $v -is [long] -or $v -is [decimal] -or $v -is [bool] -or $v -is [datetime]) {
        return $v
    }
    if ($v -is [array]) {
        return @($v | ForEach-Object { Convert-Value2ToJsonable $_ })
    }
    # PS wraps COM 2D safearray as __ComObject — flatten via Value2 recurse
    try {
        $t = $v.GetType()
        if ($t.IsArray) {
            $rank = $v.Rank
            if ($rank -eq 2) {
                $rows = $v.GetLength(0)
                $cols = $v.GetLength(1)
                $out = New-Object 'System.Collections.Generic.List[object]'
                for ($r = 0; $r -lt $rows; $r++) {
                    $row = New-Object 'System.Collections.Generic.List[object]'
                    for ($c = 0; $c -lt $cols; $c++) {
                        $cell = $v.GetValue($r, $c)
                        $row.Add((Convert-Value2ToJsonable $cell))
                    }
                    $out.Add($row.ToArray())
                }
                return $out.ToArray()
            }
        }
    }
    catch { }
    return [string]$v
}

$result = @{
    mode     = $Mode
    sourcePath = $resolved
    pdfPath  = $pdfPath
    structured = @{}
    note     = 'Use read_file on pdfPath for LiteParse layout text. For Excel, trust structured.value2 over PDF text.'
}

switch ($Mode) {
    'Excel' {
        $excel = $null
        $wb = $null
        try {
            $excel = New-Object -ComObject Excel.Application
            $excel.Visible = $false
            $excel.DisplayAlerts = $false
            $excel.ScreenUpdating = $false
            $wb = $excel.Workbooks.Open($resolved, $false, $true)
            if ($SheetName) {
                $ws = $wb.Worksheets.Item($SheetName)
            }
            else {
                $ws = $wb.Worksheets.Item(1)
            }
            if ($RangeAddress) {
                $rng = $ws.Range($RangeAddress)
            }
            else {
                $rng = $ws.UsedRange
            }
            $raw = $rng.Value2
            $result.structured = @{
                sheet        = $ws.Name
                rangeAddress = $rng.Address($false, $false)
                value2       = (Convert-Value2ToJsonable $raw)
            }
            # xlTypePDF = 0; OpenAfterPublish = false
            $ws.ExportAsFixedFormat(0, $pdfPath, 0, $false, $false, [Type]::Missing, [Type]::Missing, $false)
        }
        finally {
            if ($null -ne $wb) {
                try { $wb.Close($false) | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
            }
            if ($null -ne $excel) {
                try { $excel.ScreenUpdating = $true } catch { }
                try { $excel.Quit() | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
            }
            [GC]::Collect()
            [GC]::WaitForPendingFinalizers()
        }
    }
    'Word' {
        $word = $null
        $doc = $null
        try {
            $word = New-Object -ComObject Word.Application
            $word.Visible = $false
            $word.DisplayAlerts = 0
            $doc = $word.Documents.Open($resolved, $false, $true)
            $text = $doc.Content.Text
            $result.structured = @{
                plainTextPreview = if ($text.Length -gt 8000) { $text.Substring(0, 8000) + '…' } else { $text }
            }
            # wdExportFormatPDF = 17
            $doc.ExportAsFixedFormat($pdfPath, 17, $false)
        }
        finally {
            if ($null -ne $doc) {
                try { $doc.Close($false) | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)
            }
            if ($null -ne $word) {
                try { $word.Quit() | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
            }
            [GC]::Collect()
            [GC]::WaitForPendingFinalizers()
        }
    }
    'Ppt' {
        $ppt = $null
        $pres = $null
        try {
            $ppt = New-Object -ComObject PowerPoint.Application
            $ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse
            # Open(FileName, ReadOnly, Untitled, WithWindow)
            $pres = $ppt.Presentations.Open(
                $resolved,
                [Microsoft.Office.Core.MsoTriState]::msoTrue,
                [Microsoft.Office.Core.MsoTriState]::msoFalse,
                [Microsoft.Office.Core.MsoTriState]::msoFalse)
            # FileFormat 32 = ppSaveAsPDF
            $pres.SaveAs($pdfPath, 32, [Microsoft.Office.Core.MsoTriState]::msoFalse)
            $slideCount = $pres.Slides.Count
            $result.structured = @{
                slideCount = $slideCount
                note       = 'For slide text, consider additional COM to read Shapes; this sample only exports PDF + count.'
            }
        }
        finally {
            if ($null -ne $pres) {
                try { $pres.Close() | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres)
            }
            if ($null -ne $ppt) {
                try { $ppt.Quit() | Out-Null } catch { }
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt)
            }
            [GC]::Collect()
            [GC]::WaitForPendingFinalizers()
        }
    }
}

$result | ConvertTo-Json -Compress -Depth 8
