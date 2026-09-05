param(
    [Parameter(Mandatory = $true)][string]$Out
)
# [custom] Full virtual-desktop capture (all monitors, DPI aware) via BitBlt, plus a window
# census. Observation Discipline: full screen first, window-scoped second.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/capture-screen.ps1 -Out D:\tmp\screen.png
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$code = @"
using System; using System.Runtime.InteropServices;
public static class DpiAware { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
Add-Type -TypeDefinition $code
[DpiAware]::SetProcessDPIAware() | Out-Null

$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $Out ($($vs.Width)x$($vs.Height))"

Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | ForEach-Object {
    Write-Output ("{0,-24} pid={1,-7} '{2}'" -f $_.ProcessName, $_.Id, $_.MainWindowTitle)
}
