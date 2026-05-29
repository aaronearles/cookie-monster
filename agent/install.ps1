#Requires -Version 5.1
<#
.SYNOPSIS
    One-time setup for Cookie-Monster native messaging agent.

.DESCRIPTION
    - Copies agent files to %USERPROFILE%\.cookie-monster\agent\
    - Rewrites agent.bat with the full path to python.exe
    - Writes native host manifests with the correct agent.bat path
    - Registers manifests with Chrome and Firefox Developer Edition
    - Creates %USERPROFILE%\.session-cookies\ and excludes it from OneDrive

.NOTES
    Run once per machine. Re-run to update after pulling a new version.
    Requires the Chrome extension to be loaded first so the extension ID is pinned.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Constants ----------------------------------------------------------------

$HostName      = 'com.cookiemonster.agent'
$AgentDir      = "$env:USERPROFILE\.cookie-monster\agent"
$StoreDir      = "$env:USERPROFILE\.session-cookies"
$OverrideDir   = "$env:USERPROFILE\.cookie-monster"

# Chrome extension ID - stable because manifest-chrome.json contains a pinned key.
# Update this value if the key is ever regenerated.
$ChromeExtId   = 'fphbpongnohaamccgpafdbamkibbjnek'

# Firefox gecko.id - fixed in manifest-firefox.json, never changes.
$FirefoxGeckoId = 'cookie-monster@cookiemonster.com'

# --- Locate Python ------------------------------------------------------------
# Prefer 'py' launcher (resolves the real install, not the Microsoft Store stub).

$PythonExe = $null
$pyCmd = Get-Command py -ErrorAction SilentlyContinue
if ($pyCmd) {
    $PythonExe = & py -3 -c "import sys; print(sys.executable)" 2>$null
}
if (-not $PythonExe) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) { $PythonExe = $pythonCmd.Source }
}
if (-not $PythonExe) {
    Write-Error "Python not found. Install Python from python.org and try again."
    exit 1
}
Write-Host "Using Python: $PythonExe"

# --- Copy agent files ---------------------------------------------------------

$SourceDir = Split-Path $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
Copy-Item "$SourceDir\agent.py"  $AgentDir -Force
Copy-Item "$SourceDir\agent.bat" $AgentDir -Force

# Copy bundled sites.json so agent can read it without knowing the extension path
$ExtSites = Join-Path (Split-Path $SourceDir) "extension\sites.json"
if (Test-Path $ExtSites) {
    Copy-Item $ExtSites $AgentDir -Force
}

# Rewrite agent.bat with the full Python path
$batPath = "$AgentDir\agent.bat"
(Get-Content $batPath) -replace 'python ', "`"$PythonExe`" " | Set-Content $batPath

$AgentBat = "$AgentDir\agent.bat"
Write-Host "Agent installed to: $AgentBat"

# --- Write native host manifests ----------------------------------------------

$manifestBase = @{
    name        = $HostName
    description = 'Cookie-Monster local agent'
    path        = $AgentBat
    type        = 'stdio'
}

$chromeManifest  = $manifestBase + @{ allowed_origins = @("chrome-extension://$ChromeExtId/") }
$firefoxManifest = $manifestBase + @{ allowed_extensions = @($FirefoxGeckoId) }

$chromeManifestPath  = "$AgentDir\manifest-chrome.json"
$firefoxManifestPath = "$AgentDir\manifest-firefox.json"

$chromeManifest  | ConvertTo-Json | Set-Content $chromeManifestPath  -Encoding UTF8
$firefoxManifest | ConvertTo-Json | Set-Content $firefoxManifestPath -Encoding UTF8

# --- Register with Chrome -----------------------------------------------------

$chromeRegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Path $chromeRegPath -Force | Out-Null
Set-ItemProperty -Path $chromeRegPath -Name '(Default)' -Value $chromeManifestPath
Write-Host "Chrome: registered at $chromeRegPath"

# --- Register with Firefox ----------------------------------------------------
# On Windows, Firefox looks up NMH manifests via the registry (same as Chrome).
# The filesystem copy under %APPDATA%\Mozilla is the Mac/Linux mechanism only.

$firefoxRegPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"
New-Item -Path $firefoxRegPath -Force | Out-Null
Set-ItemProperty -Path $firefoxRegPath -Name '(Default)' -Value $firefoxManifestPath
Write-Host "Firefox: registered at $firefoxRegPath"

# --- Create cookie store ------------------------------------------------------

New-Item -ItemType Directory -Force -Path $StoreDir   | Out-Null
New-Item -ItemType Directory -Force -Path $OverrideDir | Out-Null
Write-Host "Store:   $StoreDir"

# Exclude store from OneDrive sync (attrib +P = pinned locally, not cloud-synced)
try {
    attrib +P $StoreDir
    Write-Host "OneDrive exclusion set on $StoreDir"
} catch {
    Write-Warning "Could not set OneDrive exclusion - exclude $StoreDir manually if needed."
}

# --- Done ---------------------------------------------------------------------

Write-Host ""
Write-Host "Cookie-Monster agent installed."
Write-Host "Next steps:"
Write-Host "  1. Load extension/ unpacked in Chrome (chrome://extensions -> Load unpacked)"
Write-Host "  2. Verify the Chrome extension ID matches: $ChromeExtId"
Write-Host "     (If it doesn't, update ChromeExtId in this script and re-run)"
Write-Host "  3. Visit a site, click Cookie-Monster, click 'Send to Agent'"
Write-Host "  4. Check $StoreDir for the cookie file"
