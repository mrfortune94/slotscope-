# SlotScope Android APK

This module wraps the SlotScope dashboard inside an Android WebView so you can sideload a mobile-friendly APK for live telemetry viewing.

## Project layout
- `app/src/main/assets/dashboard/` contains the dashboard HTML/CSS/JS copied from the Chrome extension.
- `MainActivity` loads the dashboard from assets with JavaScript and DOM storage enabled.
- Adaptive launcher icons mirror the SlotScope brand colors.

## Building locally
1. From the repository root, restore the binary assets (Gradle wrapper JAR and browser icons) from their base64 sources:
   ```bash
   ./scripts/restore-binaries.sh
   ```
   The Gradle wrapper will also auto-rehydrate its JAR from `gradle-wrapper.jar.b64` if you forget this step.
2. Install Java 17. On Ubuntu you can run `sudo apt-get install openjdk-17-jdk`.
3. Install the Android SDK and required platform/build-tools. A helper script in this repo will
   fetch command line tools and install API 34 components under `$HOME/android-sdk`:
   ```bash
   ANDROID_SDK_ROOT=$HOME/android-sdk ./scripts/setup-android-sdk.sh
   ```
   The script accepts licenses automatically. Re-run it any time you need to update packages.
4. From this folder run:
   ```bash
   ANDROID_SDK_ROOT=$HOME/android-sdk ./gradlew assembleDebug
   ```
5. The generated APK will be available at `app/build/outputs/apk/debug/app-debug.apk`.

You can also open the `android-app` folder directly in Android Studio to build and sign release variants.

## Pushing to GitHub
Git providers block large binary uploads (for example, the generated APK). To avoid the red “binaries not supported” error when
using the web uploader:
- Keep `app/build/` outputs out of version control (`.gitignore` already excludes them and `*.apk`/`*.aab`).
- Commit and push from the command line (`git add`, `git commit`, `git push`) instead of dragging build artifacts into the GitHub
  web UI.

If you need to share the APK, rely on the GitHub Actions artifact produced by the workflow instead of committing the file.

## Building in CI
A reusable GitHub Actions workflow (`.github/workflows/android-build.yml`) builds the debug APK on every push and pull request that touches the Android module. The workflow:
- Installs JDK 17 and the Android SDK platform/build-tools for API 34.
- Runs `./gradlew --no-daemon assembleDebug` inside the `android-app` folder.
- Publishes `app/build/outputs/apk/debug/app-debug.apk` as an artifact named `slotscope-android-debug-apk`.

You can download the artifact from the workflow run summary in GitHub Actions.
