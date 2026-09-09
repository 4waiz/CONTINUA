<#
.SYNOPSIS
  Synthesise one narration line to a WAV file using the Windows speech API.

.DESCRIPTION
  Local synthesis, on this machine, with a voice that ships with Windows. No
  audio is uploaded anywhere, no external service is called, no paid API is
  used, and no real person's voice is imitated or cloned. See docs/AI_USE.md.

  Called by scripts/build-narration.mjs once per cue in video/timeline.json.

.EXAMPLE
  powershell -File scripts/speak.ps1 -Text "..." -Out video/audio/N1.wav -Rate 0
#>
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Rate = 0,
  [string]$Voice = 'Microsoft David Desktop'
)

Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $available = $synth.GetInstalledVoices() |
    Where-Object { $_.Enabled } |
    ForEach-Object { $_.VoiceInfo.Name }

  if ($available -contains $Voice) {
    $synth.SelectVoice($Voice)
  } else {
    Write-Warning "voice '$Voice' not installed; using the system default"
  }

  # -10..10. Negative is slower. The narration is dense with numbers, so it is
  # read below the default pace unless a cue needs to fit a tighter window.
  $synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  $synth.Volume = 100

  $directory = Split-Path -Parent $Out
  if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  $synth.SetOutputToWaveFile($Out)
  $synth.Speak($Text)
} finally {
  $synth.Dispose()
}

Write-Output "wrote $Out"
