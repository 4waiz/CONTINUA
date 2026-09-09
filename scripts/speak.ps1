<#
.SYNOPSIS
  Synthesise one narration line to a WAV file, locally, with prosody.

.DESCRIPTION
  Local synthesis on this machine with a voice that ships with Windows. No audio
  or text leaves the host, no external service is called, no paid API is used,
  and no real person's voice is imitated or cloned. See docs/AI_USE.md.

  Two things make the difference between this sounding like a read and sounding
  like a screen reader:

  1. **The OneCore voices, not the old SAPI5 "Desktop" ones.** They are reached
     through WinRT (Windows.Media.SpeechSynthesis), which also exposes Microsoft
     Mark — a voice System.Speech cannot see at all. If WinRT is unavailable the
     script falls back to System.Speech and says so on stdout, so the caller can
     record which engine actually produced the audio.

  2. **SSML, not a bare string.** A pause after every sentence and a shorter one
     after every comma, plus a percentage speaking rate rather than SAPI's
     integer -10..10 steps. Reading a script full of decimals at the fastest
     integer rate, with no pauses, is what made the first cut unlistenable.

.EXAMPLE
  powershell -File scripts/speak.ps1 -Text "..." -Out video/audio/N1.wav -RatePercent -8
#>
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$Out,
  # Percentage against the voice's natural pace. Negative is slower.
  [int]$RatePercent = 0,
  [string]$Voice = 'Microsoft Mark',
  [int]$SentenceBreakMs = 200,
  [int]$ClauseBreakMs = 90
)

$ErrorActionPreference = 'Stop'

$directory = Split-Path -Parent $Out
if ($directory -and -not (Test-Path $directory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

function Build-Ssml {
  param([string]$Body, [int]$Rate, [int]$SentenceMs, [int]$ClauseMs)

  $escaped = [System.Security.SecurityElement]::Escape($Body)

  # A pause after each sentence, a shorter one after each comma, colon or dash.
  # The regex works on the escaped text, so it must not touch the entities it
  # introduced -- hence matching the punctuation followed by whitespace only.
  $escaped = [regex]::Replace($escaped, '([.!?])\s+', "`$1<break time=`"${SentenceMs}ms`"/> ")
  $escaped = [regex]::Replace($escaped, '([,:;])\s+',  "`$1<break time=`"${ClauseMs}ms`"/> ")

  $sign = if ($Rate -ge 0) { '+' } else { '' }
  return @"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
<prosody rate="$sign$Rate%">$escaped</prosody>
</speak>
"@
}

$ssml = Build-Ssml -Body $Text -Rate $RatePercent -SentenceMs $SentenceBreakMs -ClauseMs $ClauseBreakMs

# --- preferred path: WinRT / OneCore -----------------------------------------

function Invoke-WinRtSynthesis {
  param([string]$Ssml, [string]$VoiceName, [string]$Target)

  [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
  Add-Type -AssemblyName System.Runtime.WindowsRuntime

  # PowerShell 5.1 cannot `await` a WinRT IAsyncOperation directly; AsTask is
  # the documented bridge and has to be reached by reflection.
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
  if (-not $asTask) { throw 'AsTask bridge not found' }

  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  try {
    $chosen = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
      Where-Object { $_.DisplayName -eq $VoiceName } | Select-Object -First 1
    if (-not $chosen) {
      $chosen = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
        Where-Object { $_.DisplayName -like "*$VoiceName*" } | Select-Object -First 1
    }
    if (-not $chosen) { throw "voice '$VoiceName' is not installed" }
    $synth.Voice = $chosen

    $operation = $synth.SynthesizeSsmlToStreamAsync($Ssml)
    $task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($operation))
    $stream = $task.GetAwaiter().GetResult()

    $input = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream.GetInputStreamAt(0))
    try {
      $file = [System.IO.File]::Create($Target)
      try { $input.CopyTo($file) } finally { $file.Dispose() }
    } finally { $input.Dispose() }

    return $chosen.DisplayName
  } finally {
    $synth.Dispose()
  }
}

# --- fallback: System.Speech / SAPI5 -----------------------------------------

function Invoke-SapiSynthesis {
  param([string]$Ssml, [string]$VoiceName, [string]$Target)

  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $available = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
    # SAPI exposes the "Desktop" variants; prefer one matching the requested name.
    $pick = $available | Where-Object { $_ -like "*$VoiceName*" } | Select-Object -First 1
    if (-not $pick) { $pick = $available | Select-Object -First 1 }
    if ($pick) { $synth.SelectVoice($pick) }
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($Target)
    $synth.SpeakSsml($Ssml)
    return $pick
  } finally {
    $synth.Dispose()
  }
}

try {
  $used = Invoke-WinRtSynthesis -Ssml $ssml -VoiceName $Voice -Target $Out
  Write-Output "engine=winrt voice=$used"
} catch {
  Write-Warning "WinRT synthesis unavailable ($($_.Exception.Message)); falling back to System.Speech"
  $used = Invoke-SapiSynthesis -Ssml $ssml -VoiceName $Voice -Target $Out
  Write-Output "engine=sapi voice=$used"
}
