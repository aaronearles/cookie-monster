#Requires -Version 5.1
<#
.SYNOPSIS
    Package the extension as a Firefox XPI for permanent installation.

.DESCRIPTION
    Zips the extension files using manifest-firefox.json as manifest.json,
    and outputs cookie-monster.xpi in the project root.

.NOTES
    Firefox Developer Edition allows unsigned XPIs. If prompted about signing:
    about:config -> xpinstall.signatures.required -> false
    Then install via about:addons -> gear icon -> Install Add-on From File.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path $MyInvocation.MyCommand.Path
$ExtDir      = Join-Path $ProjectRoot 'extension'
$OutXpi      = Join-Path $ProjectRoot 'cookie-monster.xpi'

# Files to include from the extension directory
$include = @(
    'popup.html',
    'popup.js',
    'background.js',
    'sites.json',
    'icons\icon16.png',
    'icons\icon32.png',
    'icons\icon48.png',
    'icons\icon128.png'
)

# Build in a temp directory so we control exactly what goes in the ZIP
$tmp = Join-Path $env:TEMP "cookie-monster-xpi-$(Get-Random)"
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
    # Firefox requires the manifest to be named manifest.json
    Copy-Item (Join-Path $ExtDir 'manifest-firefox.json') (Join-Path $tmp 'manifest.json')

    foreach ($rel in $include) {
        $src = Join-Path $ExtDir $rel
        $dst = Join-Path $tmp $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
        Copy-Item $src $dst
    }

    # Remove previous build if present
    if (Test-Path $OutXpi) { Remove-Item $OutXpi }

    # Compress and rename to .xpi
    $zip = $OutXpi -replace '\.xpi$', '.zip'
    Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip
    Rename-Item $zip $OutXpi

    Write-Host "Built: $OutXpi"
    Write-Host ""
    Write-Host "To install in Firefox Developer Edition:"
    Write-Host "  about:addons -> gear icon -> Install Add-on From File -> cookie-monster.xpi"
    Write-Host ""
    Write-Host "If Firefox blocks unsigned installs:"
    Write-Host "  about:config -> xpinstall.signatures.required -> false"

} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
