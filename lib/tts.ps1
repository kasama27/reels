# เสียงพากย์ไทยในเครื่อง: Windows OneCore voice (เช่น Microsoft Pattara) → ไฟล์ WAV ต่อบรรทัด
# ใช้: tts.ps1 -Probe                         (exit 0 = มีเสียงไทย)
#      tts.ps1 -InFile lines.txt -OutDir dir  (บรรทัดที่ i → dir\i.wav)
param([string]$InFile, [string]$OutDir, [double]$Rate = 1.0, [switch]$Probe)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]

$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'th*' } | Select-Object -First 1
if ($Probe) { if ($voice) { 'ok'; exit 0 } else { exit 3 } }
if (-not $voice) { Write-Error 'no Thai voice installed'; exit 3 }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(60000)) { throw 'TTS timeout' }
  $t.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synth.Voice = $voice
$synth.Options.SpeakingRate = $Rate

$lines = [System.IO.File]::ReadAllLines($InFile, [System.Text.Encoding]::UTF8)
for ($i = 0; $i -lt $lines.Length; $i++) {
  $stream = Await ($synth.SynthesizeTextToStreamAsync($lines[$i])) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object System.IO.BinaryReader ([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream))
  [System.IO.File]::WriteAllBytes((Join-Path $OutDir "$i.wav"), $reader.ReadBytes([int]$stream.Size))
}
