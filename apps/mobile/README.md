# Bioptime member app

Expo SDK 58 · React Native 0.88 · TypeScript · Expo Router. One codebase for Android and iOS. It talks only to the
Bioptime API (`apps/api`); every rule lives on the server.

```
src/app/                      routes (Expo Router): one file per screen, _layout.tsx per navigator
  index.tsx                   entry: the Bioptime splash sting on a cold start (src/fx/brand), then sign-in or the tabs
  (auth)/                     sign-in, register (with an optional referral code), verify (email code), forgot (password
                              reset), phone (sign in with a phone code, while phone_sign_in is on)
  onboarding.tsx              profile → goals → programme → how it works → consents (activates the account)
  (tabs)/                     nine tabs under a floating glass pill, as a finger-following pager (src/fx/nav): Home,
                              Train, Bio, Life, Fuel, Coach, Tests, Store, Profile (a tab shows once its screen file
                              exists); plan and me stay as redirects for old links
  messages.tsx                the thread with the coach
  book-appointment.tsx        consultation slots from the coach's availability
  book-test.tsx               test, address, home-collection slot (vendor or stand-in)
  booking/[id].tsx            a booking with its timeline, cancel
  report/[id].tsx             a released report: laboratory values, coach notes, limits, document link
  packages.tsx                catalogue, checkout, the simulated payment step while payments are simulated, orders
  notifications.tsx           in-app notifications and channel preferences
  progress-entry.tsx          self-reported values
  settings/                   profile (and confirming the phone number), consents (privacy and sharing), data requests,
                              server address
src/lib/                      api.ts (bearer token in SecureStore, X-Bioptime-Client header), auth.tsx, config.ts
                              (API base resolution), cache.ts (last-good copies for offline), useLoad.ts, format.ts
src/fx/                       the client kit: the earlier app's look on `fx` tokens (src/theme.ts) with the premium motion
                              layer (fx/motion) and the brand sting (fx/brand); /__fx shows every component and the
                              motion kit (dev builds; /__fx?chrome=stack shows the stack header a screen without chrome
                              of its own gets)
src/components/ui.tsx         the staff kit (coach and admin screens of the staff build) on the brand tokens
```

## Run

```bash
npm install
npx expo start        # a = Android emulator, i = iOS simulator
```

API address: `EXPO_PUBLIC_API_BASE` in `.env` (see `.env.example`), else `http://10.0.2.2:3000` on the Android
emulator and `http://localhost:3000` on the iOS simulator. Testers can change it in **Me › Server**; the value is kept
in the secure store, not in the bundle.

Prepared member account: `priya.nair@demo.bioptime.test` / `Demo-Member-2026!` (API in demo mode). Registration works too; in demo
mode the email-confirmation code is returned to the app because no email is sent.

## What this build does not do

- Push delivery: no push credentials are configured, so the Push switch is not shown and the notifications screen says so; in-app notifications work.
  Coach updates reach an open app by polling the unread notifications every 30 s and by refreshing a screen when it
  regains focus (src/fx/data).
- Text messages: SMS goes to the server's outbox, which delivers nothing, and the screens say so. In demo mode the
  prepared members can still sign in with a phone code ("Fill in the preview code"); confirming a number on the profile
  needs a real SMS provider, which does not exist yet.
- Imagery: every still photo in the client app is a real licensed photograph, graded once and bundled as WebP under
  `assets/photos/` with its credit in `assets/photos/CREDITS.json` (the media package adds them; until then each place
  shows a quiet dark gradient). Screens name a placement (`src/fx/media/slots.ts`), never a file. The 18 exercise
  clips and their posters are bundled under `assets/exercises/` (release 1.0.0), byte for byte the files the API serves
  (map in `src/fx/media/bundledMedia.ts`): Android and iOS play them from the bundle, a clip the server has changed (a
  new hashed name) or added streams from the server, and the web build streams. They are clips from the owner's
  earlier app (generated; rights confirmed by the owner on 30 Oct 2026; to be replaced with filmed clips), so they are
  never re-encoded or replaced here: new clips come with new files on the server and in the bundle together.
- Fonts: Bebas Neue, Montserrat and JetBrains Mono (SIL Open Font License, texts in `assets/fonts/OFL-*.txt`), embedded
  by the `expo-font` config plugin and loaded with `useFonts` on the web.

## Build

- Android, without EAS. `android/` is the Android app's source of truth, kept by hand: **never run `expo prebuild` for
  Android** (nor an EAS build, which runs prebuild when `android/` is not in the sources it uploads). `app.json` holds
  only part of it (package, version, icons, splash image, permissions, fonts, plugins); these exist only in `android/`:
  the native splash drawn per density (160 dp in `drawable-w700dp-*`), the themed icon layer, the overlay permission
  kept to the debug manifest, the cleartext switch, the release signing, the bundle's inputs (below) and the dark
  dialog theme (`app/src/main/res/values/styles.xml`). A prebuild would drop them, and tester APKs would then lose plain
  HTTP and reach no `http://` test server. Keep `android/` with the app's sources (never ignored or left out of a copy
  or a commit), and change a native setting in `android/` and `app.json` together.
  - Tester APK (debug-signed, plain HTTP allowed):
    `cd android && EXPO_PUBLIC_API_BASE=http://127.0.0.1:3990 EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1 ./gradlew
    :app:createBundleReleaseJsAndAssets --rerun assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.
    Gradle prints `Bioptime release: a TESTER build signed with the debug key`.
  - Plain HTTP (`usesCleartextTraffic`) is decided per build in `android/app/build.gradle` from the same
    `EXPO_PUBLIC_*` values the bundle gets (the environment, then `.env.production.local`, `.env.local`,
    `.env.production`, `.env`): on when `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1` (testers may type a LAN `http://` address
    under Me › Server) or when `EXPO_PUBLIC_API_BASE` is empty or `http://`; off otherwise. `-Pbioptime.cleartext=false`
    decides outright. Debug builds always allow it, for the development server.
  - The JavaScript bundle is made again whenever those `EXPO_PUBLIC_*` values, `app.json` or a file under `assets/`
    change (`build.gradle` declares them as inputs of `createBundleReleaseJsAndAssets`; React Native's task watches only
    the `.js`/`.ts` sources), so a store build never packages a tester build's bundle. The commands below still force a
    new bundle with `:app:createBundleReleaseJsAndAssets --rerun`.
  - Store build (Play): the owner's upload keystore, which never goes in this repository. Put
    `BIOPTIME_UPLOAD_STORE_FILE=/absolute/path/outside/the/repo/upload.jks`, `BIOPTIME_UPLOAD_STORE_PASSWORD`,
    `BIOPTIME_UPLOAD_KEY_ALIAS` and `BIOPTIME_UPLOAD_KEY_PASSWORD` in `~/.gradle/gradle.properties` (or export them as
    environment variables), then, with the HTTPS API address and no server override (`.env` sets it to 1, so clear it):
    `cd android && EXPO_PUBLIC_API_BASE=https://<the API> EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE= EXPO_PUBLIC_LINK_RELAY_TOPIC=
    ./gradlew :app:createBundleReleaseJsAndAssets --rerun bundleRelease` →
    `app/build/outputs/bundle/release/app-release.aab`, signed with the upload key, with plain HTTP off and a bundle made
    for this address. Gradle stops when the keystore lies inside the repository (a relative path is taken from
    `android/app`) or a value is missing, and `bundleRelease` stops without the upload key rather than making a
    debug-signed bundle Play would refuse. Raise `versionCode` in `android/app/build.gradle` and `app.json` for every
    upload.
- iOS: the `ios/` project was regenerated from `app.json` on 5 Nov 2026 (`npx expo prebuild --platform ios --clean`,
  then `pod install`): usage texts for motion and photos, the Sign in with Apple entitlement, the fonts, the black
  launch screen with the mark, portrait only, no Face ID or camera text. Regenerate it the same way after changing
  `app.json` (keep `ios/.xcode.env.local`), then `npx expo run:ios --configuration Release --no-bundler --device <simulator
  udid>` (or open `ios/Bioptime.xcworkspace` in Xcode). Bundle id `com.bioptime.app`. Built and run on the iOS Simulator
  on this Mac on 22 Oct 2026 with Xcode 27.1. Simulator builds need no certificate; a device or TestFlight build needs
  the owner's Apple Developer account and has not been made.
- CocoaPods on this Mac is installed on the system Ruby 2.6 without sudo or Homebrew, with Ruby-2.6-compatible gems
  pinned: `gem install --user-install --no-document --platform ruby ffi:1.17.2`, then `gem install --user-install
  --no-document minitest:5.24.1 i18n:1.14.8 json:2.7.2 securerandom:0.3.2 rexml:3.4.1 activesupport:6.1.7.10
  concurrent-ruby:1.3.4 zeitwerk:2.6.18 tzinfo:2.0.6`, then `gem install --user-install --no-document --minimal-deps
  cocoapods`. Export `PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH"` and `LANG=en_US.UTF-8` before `pod install` or
  `expo run:ios`.
- `sh ../../tools/ios_smoke/simulator_smoke.sh` signs in on the booted simulator through the real sign-in form (an
  XCUITest that targets the installed app) and screenshots Home, Plan, Coach, Tests and Me into `.local/simulator/`.
- Native configuration for the client look (`app.json`): a black native splash with the Bioptime mark at 120 dp
  (`assets/splash/mark.png`, drawn from the mark's own vectors in `src/fx/brand/markData.ts`, as the in-app sting
  draws it; on Android the `drawable-*/splashscreen_logo.png` files are drawn per density on the 288 dp splash canvas,
  160 dp in `drawable-w700dp-*` for tablets), the launcher icon as the brand book's approved app icon (the symbol on
  navy `#0B1120`) with a monochrome layer (the white symbol) for Android 13+ themed icons, dark native dialogs
  (`fx.bg.elevated`) with their buttons in `fx.red.vivid` (4.62:1 on the dialog; brand red there would be 4.26:1, under
  WCAG AA) and the text cursor in brand red (`colorAccent`), the nine font files through `expo-font`,
  `expo-sensors` (motion permission text on iOS) and `android.permission.ACTIVITY_RECOGNITION` for counting steps,
  `expo-image-picker` with `microphonePermission: false` and `cameraPermission: false` (the app only picks photos from
  the library, through the system photo picker, which needs no permission), `android.blockedPermissions` (camera,
  microphone, overlay, external storage, biometric, install referrer: none is used; the overlay permission stays in
  the debug manifests for the development menu), and
  `expo-build-properties` → `android.buildArchs` `arm64-v8a` and `armeabi-v7a` (no x86 libraries, about 49 MB smaller).
  On Android these live in `android/` by hand, with what `app.json` cannot say (see Build); on iOS a prebuild applies
  them.
- `npx tsc --noEmit` typechecks; `npx expo-doctor` checks dependency compatibility. The project has no ESLint
  configuration: `npx expo lint` would install ESLint first.

## Rules the app keeps

- No credentials, keys or server secrets in the bundle; only the public API address.
- Health detail is shown in the app, never in notifications; reports are opened with 5-minute links.
- No screen carries a demo or sample label. Where a service is simulated, one plain "simulated" note shows on the
  payment, billing and laboratory booking and result screens.
- The app never decides eligibility, prices or statuses; it shows what the API returns and the API's error messages.
