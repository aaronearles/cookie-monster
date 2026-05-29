# Cookie-Monster client helper — PowerShell
# Dot-source this file or copy the function into your script.

function Get-SessionCookies {
    param([string]$Hostname)
    $path = Join-Path $env:USERPROFILE ".session-cookies\$Hostname.env"
    Get-Content $path |
        Where-Object { $_ -and $_ -notmatch '^#' } |
        ForEach-Object {
            $k, $v = $_ -split '=', 2
            [PSCustomObject]@{ Name = $k; Value = $v }
        }
}

function Get-CookieHeader {
    param([string]$Hostname)
    (Get-SessionCookies $Hostname | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
}

# Example usage:
#   $headers = @{ Cookie = Get-CookieHeader "acme.service-now.com" }
#   Invoke-RestMethod -Uri "https://acme.service-now.com/api/now/table/..." -Headers $headers
