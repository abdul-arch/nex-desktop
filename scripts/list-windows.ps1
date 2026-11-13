<#
.SYNOPSIS
  Liste les fenetres de premier niveau appartenant aux processus nex.exe (diagnostic :
  fenetre principale, overlay). Affiche titre, visibilite, styles etendus utiles.
#>
param([string]$ProcessName = "nex")

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NexWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@

$pids = @(Get-Process $ProcessName -ErrorAction SilentlyContinue | ForEach-Object Id)
if (-not $pids) { Write-Output "Aucun processus $ProcessName"; exit 1 }
$rows = New-Object System.Collections.ArrayList
[NexWin]::EnumWindows({
  param($h, $p)
  $wp = 0; [void][NexWin]::GetWindowThreadProcessId($h, [ref]$wp)
  if ($pids -contains [int]$wp) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][NexWin]::GetWindowText($h, $sb, 256)
    if ($sb.Length -gt 0) {
      $ex = [NexWin]::GetWindowLong($h, -20)
      $r = New-Object NexWin+RECT; [void][NexWin]::GetWindowRect($h, [ref]$r)
      [void]$rows.Add([pscustomobject]@{
        Titre = $sb.ToString(); Visible = [NexWin]::IsWindowVisible($h)
        Taille = "$($r.R - $r.L)x$($r.B - $r.T)"
        TopMost = [bool]($ex -band 0x8); Transparent = [bool]($ex -band 0x20); NoActivate = [bool]($ex -band 0x08000000); ToolWindow = [bool]($ex -band 0x80)
      })
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
$rows | Format-Table -AutoSize | Out-String | Write-Output
