#!/usr/bin/env bash
# Cookie-Monster client helper — bash / curl
# Source this file or copy the function into your script.

cm_store() {
    local user
    user=$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')
    echo "/mnt/c/Users/${user}/.session-cookies"
}

cm_cookie_header() {
    local host="$1"
    local store
    store=$(cm_store)
    grep -v '^#' "${store}/${host}.env" \
        | awk -F= '{print $1"="substr($0,index($0,"=")+1)}' \
        | paste -sd'; '
}

# Example usage:
#   HOST="acme.service-now.com"
#   curl -H "Cookie: $(cm_cookie_header "$HOST")" "https://$HOST/api/now/table/..."
