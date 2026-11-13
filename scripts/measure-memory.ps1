<#
.SYNOPSIS
  Mesure la memoire et le CPU de NEX : processus nex.exe ET tous ses descendants
  (processus WebView2 : navigateur, rendu, GPU, utilitaires).

.DESCRIPTION
  Rapporte separement :
    - Private Working Set (memoire privee residente)  -> compteur "Working Set - Private"
    - Private Bytes (memoire privee engagee)          -> compteur "Private Bytes"
  La memoire partagee (DLL, sections partagees) n'est pas additionnee : seules les
  valeurs privees sont sommees, pour eviter les doubles comptes.

.PARAMETER Samples
  Nombre d'echantillons (defaut 1).
.PARAMETER IntervalSec
  Intervalle entre echantillons (defaut 5 s).
.PARAMETER Csv
  Fichier CSV de sortie optionnel (une ligne par echantillon et par processus).
.PARAMETER Label
  Libelle de l'etat mesure (ex. "dashboard-stabilise").

.EXAMPLE
  powershell -File scripts/measure-memory.ps1 -Samples 12 -IntervalSec 5 -Label dashboard -Csv docs/perf/dashboard.csv
#>
param(
  [int]$Samples = 1,
  [int]$IntervalSec = 5,
  [string]$Csv = "",
  [string]$Label = "mesure",
  [string]$ProcessName = "nex"
)

$ErrorActionPreference = "Stop"

function Get-NexTree {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $roots = $all | Where-Object { $_.Name -ieq "$ProcessName.exe" }
  if (-not $roots) { return @() }
  $ids = New-Object System.Collections.Generic.HashSet[int]
  foreach ($r in $roots) { [void]$ids.Add([int]$r.ProcessId) }
  # Parcours en largeur des descendants.
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        [void]$ids.Add([int]$p.ProcessId); $changed = $true
      }
    }
  }
  return $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$rows = @()

for ($i = 1; $i -le $Samples; $i++) {
  $tree = Get-NexTree
  if (-not $tree) { Write-Warning "Aucun processus $ProcessName.exe en cours."; exit 1 }
  $pids = $tree | ForEach-Object { [int]$_.ProcessId }
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $pids -contains [int]$_.IDProcess }

  $stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
  $sumPws = 0; $sumPb = 0; $sumCpu = 0
  foreach ($p in $perf) {
    $name = ($tree | Where-Object { $_.ProcessId -eq $p.IDProcess }).Name
    $pwsMiB = [math]::Round($p.WorkingSetPrivate / 1MB, 1)
    $pbMiB = [math]::Round($p.PrivateBytes / 1MB, 1)
    # PercentProcessorTime est exprime sur un coeur : on le ramene a la capacite totale.
    $cpu = [math]::Round($p.PercentProcessorTime / $cores, 2)
    $sumPws += $pwsMiB; $sumPb += $pbMiB; $sumCpu += $cpu
    $rows += [pscustomobject]@{
      Sample = $i; Time = $stamp; Label = $Label; Pid = $p.IDProcess; Name = $name
      PrivateWorkingSetMiB = $pwsMiB; PrivateBytesMiB = $pbMiB; CpuPctTotal = $cpu
    }
  }
  $rows += [pscustomobject]@{
    Sample = $i; Time = $stamp; Label = $Label; Pid = 0; Name = "TOTAL ($($perf.Count) processus)"
    PrivateWorkingSetMiB = [math]::Round($sumPws, 1); PrivateBytesMiB = [math]::Round($sumPb, 1); CpuPctTotal = [math]::Round($sumCpu, 2)
  }
  if ($i -lt $Samples) { Start-Sleep -Seconds $IntervalSec }
}

$rows | Where-Object { $_.Sample -eq $Samples } |
  Format-Table Name, Pid, PrivateWorkingSetMiB, PrivateBytesMiB, CpuPctTotal -AutoSize | Out-String | Write-Output

if ($Samples -gt 1) {
  $totals = $rows | Where-Object { $_.Pid -eq 0 }
  $pws = $totals | Measure-Object PrivateWorkingSetMiB -Average -Maximum -Minimum
  $cpu = $totals | Measure-Object CpuPctTotal -Average -Maximum
  Write-Output ("Sur {0} echantillons : Private WS moy {1:N1} MiB (min {2:N1}, max {3:N1}) ; CPU moy {4:N2} % (max {5:N2} %) sur {6} coeurs logiques" -f `
    $Samples, $pws.Average, $pws.Minimum, $pws.Maximum, $cpu.Average, $cpu.Maximum, $cores)
}

if ($Csv) {
  $dir = Split-Path $Csv -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $rows | Export-Csv -Path $Csv -NoTypeInformation -Encoding UTF8
  Write-Output "CSV : $Csv"
}
