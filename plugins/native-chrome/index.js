// Intentionally empty. The app registers the plugin itself via
// `registerPlugin("NativeChrome")` in src/lib/nativeChrome.ts — this
// package exists to carry the iOS sources into the Capacitor build
// (`cap sync` discovers it through the `capacitor` field + podspec).
module.exports = {};
