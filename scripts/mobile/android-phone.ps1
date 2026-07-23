param(
  [string]$Serial = $env:ANDROID_SERIAL,
  [string]$ApiUrl = "http://127.0.0.1:3001",
  [string]$WebAppUrl = "http://127.0.0.1:3001",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if ($repoRoot -match "\s" -or $repoRoot.Length -gt 12) {
  throw "Android native builds require a short, space-free clone. Clone this repository to C:\v and run the command there."
}

$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch "^v24\.") {
  $fnmCommand = Get-Command fnm -ErrorAction SilentlyContinue
  if (-not $fnmCommand) {
    throw "Node 24 is required; current version is $nodeVersion, and fnm was not found."
  }

  $fnmEnvironment = & $fnmCommand.Source env --shell powershell
  Invoke-Expression ($fnmEnvironment -join [Environment]::NewLine)
  & $fnmCommand.Source use 24.14.0
  if ($LASTEXITCODE -ne 0) { throw "fnm could not activate Node 24.14.0." }
  $nodeVersion = (& node --version).Trim()
}
if ($nodeVersion -notmatch "^v24\.") {
  throw "Node 24 is required; current version is $nodeVersion."
}

$javaHome = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path (Join-Path $javaHome "bin\java.exe"))) {
  throw "Android Studio JBR was not found at $javaHome."
}
$env:JAVA_HOME = $javaHome

$physicalSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $physicalSdk)) {
  throw "Android SDK was not found at $physicalSdk."
}

$sdkDrive = "A:"
$existingMapping = (& subst) | Where-Object { $_ -match "^A:\\" }
if ($existingMapping -and $existingMapping -notlike "*$physicalSdk*") {
  throw "Drive A: is already mapped elsewhere. Remove that mapping or update this script."
}
if (-not $existingMapping) {
  & subst $sdkDrive $physicalSdk
  if ($LASTEXITCODE -ne 0) { throw "Could not map the Android SDK to A:." }
}

$env:ANDROID_HOME = "$sdkDrive\"
$env:ANDROID_SDK_ROOT = "$sdkDrive\"
$env:EXPO_PUBLIC_API_URL = $ApiUrl
$env:EXPO_PUBLIC_WEB_APP_URL = $WebAppUrl
$env:NODE_ENV = "development"
$adb = "$sdkDrive\platform-tools\adb.exe"

$devices = @(& $adb devices | Select-String "\tdevice$" | ForEach-Object { ($_ -split "\s+")[0] })
if (-not $Serial) {
  if ($devices.Count -ne 1) {
    throw "Connect exactly one authorized Android device or set ANDROID_SERIAL."
  }
  $Serial = $devices[0]
}
if ($devices -notcontains $Serial) {
  throw "Android device '$Serial' is not connected and authorized."
}
$env:ANDROID_SERIAL = $Serial

try {
  Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5 | Out-Null
} catch {
  throw "The API is not healthy at http://localhost:3001/api/health. Start it before running this command."
}
try {
  Invoke-WebRequest -Uri "$WebAppUrl/login" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  throw "The authenticated web app is not reachable at $WebAppUrl. Start it before running this command."
}

Push-Location $repoRoot
try {
  & corepack pnpm --filter '@vercent/mobile' exec expo prebuild --clean --platform android --no-install
  if ($LASTEXITCODE -ne 0) { throw "Expo prebuild failed." }
  if (-not (Test-Path "apps\mobile\android\gradlew.bat")) {
    throw "Expo prebuild did not create the Android Gradle wrapper."
  }

  if (-not $SkipBuild) {
    Push-Location "apps\mobile\android"
    try {
      & .\gradlew.bat app:assembleDebug -PreactNativeArchitectures=arm64-v8a
      if ($LASTEXITCODE -ne 0) { throw "Android build failed." }
    } finally {
      Pop-Location
    }
  }

  $apk = Join-Path $repoRoot "apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
  if (-not (Test-Path $apk)) { throw "Debug APK was not found at $apk." }

  $jar = Join-Path $env:JAVA_HOME "bin\jar.exe"
  $apkEntries = @(& $jar tf $apk)
  foreach ($library in @("libcrypto.so", "libssl.so", "libexpo-sqlite.so")) {
    if ($apkEntries -notcontains "lib/arm64-v8a/$library") {
      throw "The APK is missing the SQLCipher runtime library $library."
    }
  }

  & $adb -s $Serial reverse tcp:3001 tcp:3001
  & $adb -s $Serial reverse tcp:3000 tcp:3000
  & $adb -s $Serial reverse tcp:8081 tcp:8081
  & $adb -s $Serial install -r $apk
  if ($LASTEXITCODE -ne 0) { throw "APK installation failed." }

  # A listener left by an older clone can serve a valid but stale JavaScript
  # bundle. Always replace it with Metro rooted in this exact source tree and
  # reset Metro's transform cache before launching the phone app.
  $metroListeners = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue)
  foreach ($processId in @($metroListeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    if ($processId) {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    }
  }

  $logDir = Join-Path $repoRoot "tmp\mobile-run"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Remove-Item (Join-Path $logDir "metro.out.log"), (Join-Path $logDir "metro.err.log") -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath "corepack.cmd" -ArgumentList @("pnpm", "--filter", "@vercent/mobile", "exec", "expo", "start", "--dev-client", "--clear", "--port", "8081") -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "metro.out.log") -RedirectStandardError (Join-Path $logDir "metro.err.log")

  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    $metroRunning = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
  } until ($metroRunning -or (Get-Date) -gt $deadline)
  if (-not $metroRunning) { throw "Fresh Metro did not start within 60 seconds; inspect tmp\mobile-run." }

  & $adb -s $Serial shell am force-stop com.vercentlabs.erp
  & $adb -s $Serial shell am start -n com.vercentlabs.erp/.MainActivity
  if ($LASTEXITCODE -ne 0) { throw "The application could not be launched." }

  Write-Host "Android app installed and launched on $Serial."
  Write-Host "APK: $apk"
  Write-Host "API: $ApiUrl (ADB reverse tcp:3001)"
  Write-Host "Web workspace: $WebAppUrl (ADB reverse tcp:3001)"
  Write-Host "Metro: ADB reverse tcp:8081"
} finally {
  Pop-Location
}
