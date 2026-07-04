// JS side of the iOS widget data flow.
//
// HISTORY: this used to call a custom Capacitor plugin (WidgetBridge) to
// write the snapshot/token straight into the App Group. That plugin's
// native method dispatch was reliable in debug but hung forever in RELEASE
// (TestFlight) builds — the app-target plugin's methods never executed, so
// every bridge call's promise never settled and the widgets stayed empty.
// See ios-config/CardiganBridgeViewController.swift for the full writeup.
//
// NOW: we write the payload into localStorage instead. The native
// CardiganBridgeViewController reads these exact keys via evaluateJavaScript
// on app foreground/background and mirrors them into the App Group
// (UserDefaults suite) that the widget extension reads — using only
// primitives that work in a release build, no plugin method calls. These
// functions therefore never hang: they're synchronous localStorage writes
// wrapped in the original async signatures so widgetSync.ts is unchanged.

import { isNative, isIOS } from "./platform";

// Keys mirrored by CardiganBridgeViewController.swift — keep in sync.
const LS_SNAPSHOT = "cardigan.widget.snapshot.v1";
const LS_TOKEN = "cardigan.widget.token";

/** True only on iOS native where the native mirror runs. */
export function widgetBridgeAvailable(): boolean {
  return isNative() && isIOS();
}

export async function setWidgetSnapshot(json: string): Promise<boolean> {
  try {
    localStorage.setItem(LS_SNAPSHOT, json);
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetBridge.setSnapshot:", (err as Error)?.message || err);
    return false;
  }
}

export async function setWidgetToken(token: string): Promise<boolean> {
  try {
    localStorage.setItem(LS_TOKEN, token);
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetBridge.setToken:", (err as Error)?.message || err);
    return false;
  }
}

export async function widgetHasToken(): Promise<boolean> {
  try {
    return !!localStorage.getItem(LS_TOKEN);
  } catch {
    return false;
  }
}

/** Wipe snapshot + token (logout / revoke). The native side stops mirroring
    once the values are gone. */
export async function clearWidgetData(): Promise<void> {
  try {
    localStorage.removeItem(LS_SNAPSHOT);
    localStorage.removeItem(LS_TOKEN);
  } catch { /* private mode / quota — non-fatal */ }
}
