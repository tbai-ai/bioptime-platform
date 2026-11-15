/* Metro for the Bioptime app: Expo's default configuration, plus one rule for the client app's phone builds.
   The client app's Android and iOS bundles (`expo export:embed`, which the Gradle and Xcode release builds run, in every
   build without EXPO_PUBLIC_STAFF_APP=1) leave every staff screen out: the coach screens (src/app/coach/…), the
   administrative portal (src/app/admin/…), the coach and administrator workspaces (the (coach) and (admin) tab groups)
   and the staff sign-ins (the chooser and the coach and administrator sign-ins under (auth)), and with them the staff
   kit only those screens import (components/workspace*, components/coach*, components/admin*, lib/coach, lib/admin)
   and their staff copy and admin endpoint names. Expo Router finds its routes through Metro's file map, so a file left
   out here is no route at all; an old link to one of those addresses reaches the not-found screen, which in the client
   app sends it to the client sign-in or Home, as the staff gate did (src/app/+not-found.tsx). The layouts declare those
   screens only where they are bundled (components/staffGate STAFF_ROUTES_BUNDLED). The gate (components/staffGate)
   stays as defence in depth. The web keeps every file (its dev server renders each address on the server from the
   folder itself), and so does the staff build (EXPO_PUBLIC_STAFF_APP=1). */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const nativeBundle = process.argv.includes('export:embed');
if (nativeBundle && process.env.EXPO_PUBLIC_STAFF_APP !== '1') {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const app = path.join(__dirname, 'src', 'app');
  const staffDirs = ['admin', 'coach', '(admin)', '(coach)'].map((d) => new RegExp('^' + escape(path.join(app, d) + path.sep) + '.*$'));
  const staffSignIns = ['choose', 'coach-sign-in', 'admin-sign-in'].map((f) => new RegExp('^' + escape(path.join(app, '(auth)', f)) + '\\.[jt]sx?$'));
  const before = config.resolver.blockList;
  config.resolver.blockList = [...(Array.isArray(before) ? before : before ? [before] : []), ...staffDirs, ...staffSignIns];
}

module.exports = config;
