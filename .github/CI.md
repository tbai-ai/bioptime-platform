# CI workflows

Four GitHub Actions workflows live in `.github/workflows/`. Each action is pinned to its current major version (checked
15 Nov 2026): checkout v7, setup-node v7, setup-java v6, upload-artifact v7, cache v6, and gradle/actions v6
(wrapper-validation and setup-gradle). gitleaks is not an action: it runs as a pinned, checksum-verified release binary
(8.30.1). Node is 24 (the Mac has 24.22) and Java is Temurin 21 (the Mac's release build uses Temurin 21.0.12).

This repository is public. Anyone signed in to GitHub can read the logs and download the artifacts, so the
workflows never use a private value. **The link-relay topic is never passed**: both relay variables are set to empty
on purpose. Every workflow has only `contents: read` permission and checks out without keeping the token.

## ci.yml: typecheck, tests, dashboard build

Runs on every push, every pull request, and by hand. It uses Ubuntu 24.04 and Node 24. A newer push to the same branch
or pull request cancels the older run; on `main` every commit runs to the end.

| Step | Command |
| --- | --- |
| Install | `npm ci` at the root (api, dashboard, packages/*), then `npm ci` in `apps/mobile` (not a workspace; the API tests use its React) |
| Typecheck | `npm run typecheck` (api, dashboard, packages/domain) |
| Mobile typecheck | `npx --no-install tsc --noEmit` in `apps/mobile` (the command in its AGENTS.md; the app has no typecheck script) |
| API tests | `node --import tsx --test --test-skip-pattern="website registration sends the code from the link" "tests/**/*.test.ts"` in `apps/api` |
| Dashboard build | `npm run dashboard:build` |

Each command was run on a clean copy of the sources before it was added to CI (fresh `npm ci`, no website folder
next to the repository, also with `TZ=UTC`). All of them passed: 584 tests passed, plus 1 test that skips itself.
On 15 Nov 2026 that copy was checked file by file against the staged sources (apps/api, apps/dashboard, apps/mobile/src,
packages, root files): identical.

These checks are not in CI:
- **Lint.** No workspace has a lint script. The app's only lint script is `expo lint`, and it is deliberately not run.
- **One referral test.** It reads the public website from `../../drive`, which is outside this repository, so it is
  skipped by name. Another website test already skips itself when that folder is missing. If that test is renamed,
  the skip pattern no longer matches and CI fails until the pattern is updated.
- **packages/design-system.** It has no scripts.

## android.yml: tester APK

This workflow builds the Android tester APK.
- **When it runs:** on a push to `main` that changes `apps/mobile/**` or this workflow file, and by hand (Actions >
  Android APK > Run workflow).
- **Toolchain:** Ubuntu 24.04, Temurin 21 and Node 24. It installs NDK 27.1.12297006 and CMake 3.22.1, the same
  versions the Mac uses (the runner image ships NDK 27.3/29/30 and CMake 3.31/4.1 only). It first deletes a few large
  toolchains the job never uses (.NET, GHC, Boost, Swift, CodeQL) to leave room for the native build.
- **Build:** `npm ci` in `apps/mobile` (Gradle calls node to find react-native, Expo autolinking, hermesc and codegen),
  then `./gradlew --no-daemon assembleRelease` in `apps/mobile/android`. `gradle/actions/wrapper-validation` checks
  the repository's own `gradle-wrapper.jar` before `npm ci`. Gradle caching comes from `gradle/actions/setup-gradle`
  with the open-source `basic` provider, set up after `npm ci` so that the libraries' build files are part of its cache
  key. The step that names the APK fails if the APK has no `assets/index.android.bundle` (the Hermes bundle).
- **Build-time values:** `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1` and `EXPO_PUBLIC_STAFF_APP=0`, as in the local tester
  build. `EXPO_PUBLIC_API_BASE` comes from the optional repository variable **`BIOPTIME_API_BASE`** (Settings >
  Secrets and variables > Actions > Variables). It is compiled into the app, so it is a variable and never a secret.
  Without it, the release app has no built-in server, and testers enter one under Me > Server.
- **Signing:** `app/build.gradle` signs a release with `android/app/debug.keystore` when the Bioptime upload key is not
  configured, and that keystore is not in the repository. If the file is missing, the workflow generates a standard,
  throwaway Android debug key on the runner. The key lives only for that job (it is never cached or uploaded), so
  **every CI run produces a different signature, and none matches an APK built on the Mac.** Android refuses to
  install one over another: uninstall the app first (this clears its data). A CI APK is a tester build only.
- **Artifact:** `bioptime-android-release-<run number>`, kept for 14 days. Its SHA-256 is in the job summary. A re-run
  replaces the artifact of the earlier attempt.

## ios.yml: unsigned .ipa

This workflow builds an **UNSIGNED** iOS archive.
- **When it runs:** on a push to `main` that changes `apps/mobile/**` or this workflow file, and by hand.
- **Runner and Xcode:** the `xcode-27` runner, which runs macOS 27 on arm64 and is a public-preview image in
  actions/runner-images. The workflow selects **Xcode 27.2 (27B52)**, the same build as the Mac, through
  `DEVELOPER_DIR`. The image's default Xcode is 27.1, which the workflow falls back to (with a warning) only if 27.2
  is missing. The stable `macos-26` image (Xcode 26.6) has not been tried with this app.
- **Build:** `npm ci` in `apps/mobile`, then `pod install` in `apps/mobile/ios` (CocoaPods 1.17.0, the same as the
  Mac). `Podfile.properties.json` is used as committed: precompiled Expo modules are on, and `expo-file-system` and
  `expo-video` are built from source (`expo.autolinking.ios.buildFromSource` in `apps/mobile/package.json`). Then
  `xcodebuild archive` runs for `generic/platform=iOS` with `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`, and
  `Payload/*.app` is zipped into an `.ipa`. The packaging step fails if the app has no `main.jsbundle`. The
  `EXPO_PUBLIC_*` values are the same as in the Android build.
- **Artifact:** `bioptime-ios-unsigned-<run number>`, kept for 14 days. **The .ipa is not signed and cannot be
  installed on a device as it is.** It must be re-signed with an Apple certificate and provisioning profile first, and
  the app's Sign in with Apple entitlement needs a profile that allows it. If the archive fails, the xcodebuild log is
  uploaded for 7 days (it holds build paths and settings only; the job has no secrets in its environment).
- **Swift crash risk:** on the Mac, building every Expo module from source makes Swift 6.4.2 (Xcode 27.2) crash in
  `AsyncFunctionDefinition`. The committed setup avoids this, since only the two modules above are built from source.
  The runner uses the same Swift, so the crash will come back if precompiled modules are turned off
  (`EXPO_USE_PRECOMPILED_MODULES=false`) or more modules are moved to `buildFromSource`. If the runner falls back to
  another Xcode, its Swift may also be unable to read the precompiled modules' interfaces.
- **Not yet run:** the local device build used `xcodebuild build`, not `archive`. The first run of this workflow is the
  first `archive` of the app.

## secret-scan.yml: gitleaks

This workflow downloads the gitleaks 8.30.1 Linux release, checks its SHA-256 against the value in the workflow, and
runs `gitleaks git --redact` with `.github/gitleaks.toml`.
- **When it runs:** on every push and pull request, by hand, and weekly (Mondays 03:17 UTC).
- **What it scans:** always the **whole history** of every branch and tag (`fetch-depth: 0`). The repository is small,
  so this takes seconds, and a cancelled or failed run never leaves commits unscanned. It needs no licence key and no
  token beyond read access.
- **Configuration:** `.github/gitleaks.toml` keeps every default rule and allows exactly two false positives of the
  `generic-api-key` rule: the SPEC CHECKSUMS in `Podfile.lock`, and the made-up `<prefix>_test_<n>` keys in
  `apps/api/tests/integration/labstackOps.test.ts`. Without it the first push fails on those three lines. A root
  `.gitleaksignore` is honoured if one is added. A root `.gitleaks.toml` would NOT be used: the workflow passes
  `--config .github/gitleaks.toml`.
- **Output:** findings are printed with the secret redacted. Nothing is uploaded and no comment is posted.
- **If it fails:** the secret is already public in the history. Revoke or rotate it first; rewriting history does not
  un-publish it. Only then add the finding's fingerprint (printed in the log) to a root `.gitleaksignore`.
- **To update gitleaks:** change `GITLEAKS_VERSION` and `GITLEAKS_SHA256` together, taking the hash for
  `gitleaks_<version>_linux_x64.tar.gz` from that release's `gitleaks_<version>_checksums.txt`.

## Before the first push

- `apps/mobile/android/` and `apps/mobile/ios/` must be committed. Both are kept by hand and never regenerated. Both
  native workflows stop with a clear error if they are missing.
- macOS custom-icon files (`Icon` + carriage return) must not be committed. They break the Android build with a
  `META-INF/Icon` duplicate, and the Android workflow stops if it finds any.
- The root `.env.example` must be committed, because an API test checks it.
- Never commit `debug.keystore`, an upload key, `apps/mobile/.env`, or the files of a local preview or
  link-sharing setup (tunnel, gate or relay settings).
