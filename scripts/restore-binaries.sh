#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

restore() {
  local src="$1"
  local dest="$2"
  local dest_dir
  dest_dir=$(dirname "$dest")
  mkdir -p "$dest_dir"
  base64 --decode "$src" > "$dest"
}

restore "$repo_root/android-app/gradle/wrapper/gradle-wrapper.jar.b64" "$repo_root/android-app/gradle/wrapper/gradle-wrapper.jar"
restore "$repo_root/icons/icon-16.b64" "$repo_root/icons/16.png"
restore "$repo_root/icons/icon-32.b64" "$repo_root/icons/32.png"
restore "$repo_root/icons/icon-48.b64" "$repo_root/icons/48.png"
restore "$repo_root/icons/icon-128.b64" "$repo_root/icons/128.png"
