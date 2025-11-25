#!/usr/bin/env bash
set -euo pipefail

CMDLINE_VERSION="11076708"
CMDLINE_ZIP="commandlinetools-linux-${CMDLINE_VERSION}_latest.zip"
CMDLINE_URL="https://dl.google.com/android/repository/${CMDLINE_ZIP}"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/android-sdk}}"

mkdir -p "$SDK_ROOT/cmdline-tools"

if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then
  echo "Downloading Android command line tools ${CMDLINE_VERSION}..."
  temp_dir=$(mktemp -d)
  pushd "$temp_dir" >/dev/null
  curl -fsSLO "$CMDLINE_URL"
  unzip -q "$CMDLINE_ZIP"
  mkdir -p "$SDK_ROOT/cmdline-tools/latest"
  mv cmdline-tools/* "$SDK_ROOT/cmdline-tools/latest/"
  popd >/dev/null
  rm -rf "$temp_dir"
fi

SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"

echo "Accepting Android SDK licenses..."
yes | "$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses >/dev/null || true
echo "Installing platform-tools, platforms;android-34, and build-tools;34.0.0..."
"$SDKMANAGER" --sdk_root="$SDK_ROOT" \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;34.0.0"
