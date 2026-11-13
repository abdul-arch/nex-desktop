<#
.SYNOPSIS
  Fenetre de test animee (1280x720, compteur et couleur changeant a 60 Hz) pour eprouver la
  capture sans enregistrer de contenu personnel. Se ferme seule apres -Seconds secondes.
#>
param([int]$Seconds = 30)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = "NEX capture test"
$form.ClientSize = New-Object System.Drawing.Size(1280, 720)
$form.StartPosition = "CenterScreen"
$label = New-Object System.Windows.Forms.Label
$label.Dock = "Fill"
$label.TextAlign = "MiddleCenter"
$label.Font = New-Object System.Drawing.Font("Segoe UI", 64, [System.Drawing.FontStyle]::Bold)
$label.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($label)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 16
$timer.Add_Tick({
  $t = $sw.Elapsed.TotalSeconds
  $label.Text = "NEX  {0:N2} s" -f $t
  $h = [int](($t * 60) % 360)
  $form.BackColor = [System.Drawing.Color]::FromArgb(255, [int](128 + 127 * [math]::Sin($t)), [int](128 + 127 * [math]::Sin($t + 2)), [int](128 + 127 * [math]::Sin($t + 4)))
  if ($t -ge $Seconds) { $form.Close() }
})
$timer.Start()
[void]$form.ShowDialog()
