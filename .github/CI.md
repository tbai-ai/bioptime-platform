# CI workflows

Six GitHub Actions workflows live in `.github/workflows/`, and one local composite action in
`.github/actions/android-release-apk/` (the Android build that `android.yml` and `e2e-android.yml` share).

How actions are pinned (checked 15 Nov 2026):
- **GitHub's own actions** stay on their current major version: checkout v7, setup-node v7, setup-java v6,
  upload-artifact v7, download-artifact v8, cache v6.
- **Every other action** is pinned by its full commit SHA, with the version in a comment: gradle/actions v6.4.1
  (wrapper-validation and setup-gradle, `8da46b5…`) and reactivecircus/android-emulator-runner v2.38.0 (`a421e43…`).
  To update one, look up the tag's commit (`https://api.github.com/repos/<owner>/<repo>/git/ref/tags/<tag>`, then
  `/git/tags/<sha>` when the tag is annotated) and change the SHA and the comment together.
- **The local action** is called as `uses: ./.github/actions/android-release-apk`, which GitHub resolves from the
  repository checked out in the step before (actions/checkout runs first in every job that uses it).
- **Tools that are not actions** run as pinned, checksum-verified downloads: gitleaks 8.30.1, Maestro 2.12.1 and
  zizmor 1.32.0.

Node is 24 (the Mac has 24.22) and Java is Temurin 21 (the Mac's release build uses Temurin 21.0.12).

This repository is public. Anyone signed in to GitHub can read the logs and download the artifacts, so the
workflows never use a private value. **The link-relay topic is never passed**: both relay variables are set to empty
on purpose. Every workflow has only `contents: read` permission and checks out without keeping the token. No workflow
uses `pull_request_target`, and no `${{ }}` expression is written into a `run:` script (values reach scripts through
`env:`). A pull request cannot poison the caches `main` uses: GitHub scopes a cache entry to the branch or pull request
that wrote it (only `main`'s entries are shared with the others), and setup-gradle writes its cache only on `main`.

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

This workflow builds the Android tester APK. Its build steps are in the composite action
`.github/actions/android-release-apk` (shared with `e2e-android.yml`); the workflow checks out, calls the action and
uploads the APK.
- **When it runs:** on a push to `main` that changes `apps/mobile/**` (except the Maestro flows in
  `apps/mobile/.maestro/`), this workflow file or the build action, and by hand (Actions > Android APK > Run workflow).
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
- **When it runs:** on a push to `main` that changes `apps/mobile/**` (except the Maestro flows in
  `apps/mobile/.maestro/`) or this workflow file, and by hand.
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

## e2e-android.yml: Maestro flows on Android emulators

This workflow runs the client app's end-to-end flows (`apps/mobile/.maestro/`) with Maestro on a phone and a tablet
emulator, against a scratch demo API that each job starts on its own runner.
- **When it runs:** on a push to `main` that changes `apps/mobile/**` (the flows included), `apps/api/**`,
  `packages/**`, the root `package-lock.json`, this workflow, the build action or `.github/scripts/e2e-android-run.sh`,
  and by hand.
- **Build job:** the build action with `architectures: x86_64` and no `api-base`. The tester APK carries only the ARM
  ABIs of `gradle.properties`, which an x86_64 emulator does not run natively, so this APK is built for x86_64 only.
  It has no built-in server (as a tester APK without `BIOPTIME_API_BASE`), so the flows type the API's address under
  Server. Same build-time values and the same throwaway debug key as the tester APK. Uploaded as `bioptime-e2e-apk`
  for 3 days.
- **Test jobs:** `phone` (AVD profile `pixel_7`) and `tablet` (`pixel_tablet`; `pixel_c` is the older tablet profile),
  in parallel, each at most 75 minutes. Each job:
  - enables KVM (the udev rule from the emulator runner's README), sets up Java 21 and Node 24, and runs `npm ci` at
    the root;
  - starts the demo API: `npm run api:reset-demo` (deletes, migrates and seeds a fresh database under the runner's
    temp folder), then `npm run api:start` in the background, with `BIOPTIME_MODE=demo`, `OPEN_PREVIEW=1`,
    `HOST=127.0.0.1` and `PORT=3000`. `WEBSITE_DIR` and `DASHBOARD_DIR` point at folders that do not exist: the website
    and the portals are not in this repository, and `apps/api/src/http/app.ts` checks that each folder exists before
    serving it;
  - waits for `/api/health` and checks that `/api/public/config` offers the open preview for the member workspace;
  - installs Maestro 2.12.1 from the release's `maestro.zip` (the file the official install script fetches), checked
    against its SHA-256;
  - boots API level 36 (the app's targetSdk), `google_apis`, `x86_64`, with animations off, through
    reactivecircus/android-emulator-runner, which runs `.github/scripts/e2e-android-run.sh`: install the APK, then
    `maestro test apps/mobile/.maestro --format junit`, then keep the app's logcat lines.
- **Network:** the emulator reaches the runner's `127.0.0.1:3000` at `http://10.0.2.2:3000`. The app may use plain
  http there because a build with server override on keeps cleartext traffic on (`app/build.gradle`).
- **Tablet layout:** Android 16 does not apply an app's portrait lock on large screens for apps that target API 36,
  so the tablet run may show the app in landscape.
- **The flows:** each starts from a cleared app. `smoke.yaml`: when the card "Continue without signing in" does not
  appear (no server built in), Change the server address (testers) > `http://10.0.2.2:3000` > Back to sign-in; then
  Continue without signing in; Home. `tabs.yaml`: the nine tabs of the pill in order, one check and one screenshot
  each. `member-sign-in.yaml`: the seeded member signs in, opens Profile and signs out from Profile > Settings.
  `subflows/` holds the shared steps and is not run on its own. Every flow names the source file of each selector.
- **Credentials:** the member sign-in uses public demo seed values (`apps/api/src/seed/seed.ts`). That flow always sets
  the server to `http://10.0.2.2:3000` first, so they only reach the job's own scratch API. The seed summary, which
  lists the demo accounts, is not uploaded.
- **Artifacts:** `e2e-android-<phone|tablet>-<run number>`, kept for 14 days and uploaded even when a flow fails:
  `maestro/takeScreenshot/*.png` (the screenshots), the rest of `maestro/` (Maestro's command log and its own captures
  of a failing step), `junit.xml`, `api.log`, `logcat.txt` and `device.txt`. The job summary lists each flow's result.
- **Not yet run:** the flows were written from the app's sources. Maestro is not installed on the Mac and no emulator
  run has been made, so the first CI run is the first time they meet the app.
- **To update Maestro:** change `MAESTRO_VERSION` and `MAESTRO_SHA256` together. The hash is the `digest` GitHub
  lists for `maestro.zip` at `https://api.github.com/repos/mobile-dev-inc/maestro/releases/tags/cli-<version>`.

## workflow-lint.yml: zizmor

This workflow audits the workflows and the local action with zizmor's default audits.
- **When it runs:** on every push and pull request that changes `.github/**`, and by hand.
- **Install:** zizmor 1.32.0 from PyPI, into a throwaway virtual environment. pip takes only the
  `manylinux_2_28_x86_64` wheel and checks it against the SHA-256 in the workflow (`--require-hashes`). No
  third-party action is used.
- **Run:** `zizmor --format=github --config .github/zizmor.yml .`. It collects `.github/workflows/*.yml` and
  `.github/actions/*/action.yml`. Findings appear as annotations (GitHub shows at most 10 per step; the log has all of
  them), and any finding fails the job.
- **Online audits:** the job's read-only token is passed as `GH_TOKEN`. This turns on the audits that ask the GitHub API
  (impostor commits, known-vulnerable actions, version comments that do not match the pinned SHA).
- **Configuration:** `.github/zizmor.yml` keeps one deliberate exception. Since 1.20, zizmor wants every action pinned
  by SHA; the file lets `actions/*` stay on its major tags (the convention above) and requires a SHA for everything
  else.
- **Hardening (15 Nov 2026):** the existing workflows already checked out without keeping the token, had
  `contents: read` at workflow level, used no `pull_request_target` and wrote no `${{ }}` into scripts. gradle/actions
  moved from `@v6` to its v6.4.1 commit, and the Android build moved into the local action, which is called as
  `./.github/actions/android-release-apk`. zizmor itself has not been run on the Mac: its first run is in CI.
- **To update zizmor:** change `ZIZMOR_VERSION` and `ZIZMOR_SHA256` together. The hash is the sha256 of
  `zizmor-<version>-py3-none-manylinux_2_28_x86_64.whl` at `https://pypi.org/pypi/zizmor/<version>/json`.

## Before the first push

- `apps/mobile/android/` and `apps/mobile/ios/` must be committed. Both are kept by hand and never regenerated. Both
  native workflows stop with a clear error if they are missing.
- macOS custom-icon files (`Icon` + carriage return) must not be committed. They break the Android build with a
  `META-INF/Icon` duplicate, and the Android workflow stops if it finds any.
- The root `.env.example` must be committed, because an API test checks it.
- Never commit `debug.keystore`, an upload key, `apps/mobile/.env`, or the files of a local preview or
  link-sharing setup (tunnel, gate or relay settings).

## Known limit: the Android emulator tests (e2e-android.yml)

The Maestro flows run only when started by hand (Actions > E2E Android > Run workflow). On GitHub's hosted Linux
runners there is no GPU, so the emulator draws in software, and on 15 Nov 2026 the emulator process exited within
seconds of the app drawing Home in 4 of 5 runs (phone and tablet, API 36 and 35, software Vulkan and OpenGL, full and
half resolution). One tablet run passed every flow, so the flows themselves work. The app's Home is its heaviest screen
(glass, glow, photographs, motion). For a dependable run use an emulator on a machine with a GPU (for example this
project's Mac), a GPU runner, or a device cloud. The job ends within minutes when the emulator goes away (attempts.txt
in the artifact says which flows ran).

Local run (15 Nov 2026, this project's Mac, real GPU and also software graphics): all flows passed on a Pixel 7 and a
Pixel Tablet emulator, memory stayed level across 3 rounds of the 9 tabs, and the emulator never exited, so the CI
failures most likely come from the hosted runner, not the app. To run the flows locally against a scratch API (never
the Mac's live demo on :3000): `maestro --device emulator-<port> test -e SERVER_URL=http://10.0.2.2:<scratch port>
apps/mobile/.maestro/<flow>.yaml`.
