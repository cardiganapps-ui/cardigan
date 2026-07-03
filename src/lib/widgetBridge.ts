// JS side of the WidgetBridge Capacitor plugin (iOS-only local plugin,
// Swift half in ios-config/WidgetBridgePlugin.swift). It hands the iOS
// WidgetKit extension its two inputs through the shared App Group
// container (group.mx.cardigan.app):
//   - the compact data snapshot the widgets render (widget.snapshot.v1)
//   - the opaque /api/widget-data token (widget.token)
// Every write ends with WidgetCenter.reloadAllTimelines() on the Swift
// side, so widgets repaint right after the app refreshes its data.
//
// Follows the native*.ts wrapper pattern: gated on the platform check,
// dynamic import of @capacitor/core, silent no-op on web/Android. All
// methods are also resilient to the plugin class missing from the
// native build (registerPlugin succeeds; the CALL rejects) — callers
// get a false/no-op, never a throw.

import { isNative, isIOS } from "./platform";

export interface WidgetDebugState {
  appGroupAvailable: boolean;
  suiteName: string;
  snapshotBytes: number;
  hasToken: boolean;
  widgetLastRun: string;
  widgetLastState: string;
}

interface WidgetBridgePlugin {
  setSnapshot(options: { json: string }): Promise<void>;
  setToken(options: { token: string }): Promise<void>;
  hasToken(): Promise<{ value: boolean }>;
  clear(): Promise<void>;
  debugState(): Promise<WidgetDebugState>;
}

let pluginPromise: Promise<WidgetBridgePlugin | null> | null = null;

function getPlugin(): Promise<WidgetBridgePlugin | null> {
  if (!isNative() || !isIOS()) return Promise.resolve(null);
  if (!pluginPromise) {
    pluginPromise = import("@capacitor/core")
      .then(({ registerPlugin }) => registerPlugin<WidgetBridgePlugin>("WidgetBridge"))
      .catch(() => null);
  }
  return pluginPromise;
}

/** True only on iOS native where the bridge is expected to exist. */
export function widgetBridgeAvailable(): boolean {
  return isNative() && isIOS();
}

// Hard timeout on every bridge call. If the native plugin isn't
// registered, a Capacitor call to it never resolves OR rejects — it just
// hangs. Without this guard, `void syncWidgets()` on every refresh would
// leak a forever-pending promise, and the Settings diagnostic would stick
// on "Ejecutando". Reject after 4s so callers fall back cleanly.
function withTimeout<T>(p: Promise<T>, ms = 4000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("widget bridge timeout")), ms)),
  ]);
}

export async function setWidgetSnapshot(json: string): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    await withTimeout(plugin.setSnapshot({ json }));
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetBridge.setSnapshot:", (err as Error)?.message || err);
    return false;
  }
}

export async function setWidgetToken(token: string): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    await withTimeout(plugin.setToken({ token }));
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetBridge.setToken:", (err as Error)?.message || err);
    return false;
  }
}

export async function widgetHasToken(): Promise<boolean> {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const { value } = await withTimeout(plugin.hasToken());
    return !!value;
  } catch {
    return false;
  }
}

/** Read the bridge + App Group diagnostic state. Returns null when the
    bridge itself isn't callable (which is itself the diagnosis). */
export async function widgetDebugState(): Promise<WidgetDebugState | { error: string } | null> {
  const plugin = await getPlugin();
  if (!plugin) return null;
  try {
    return await withTimeout(plugin.debugState());
  } catch (err) {
    return { error: (err as Error)?.message || String(err) };
  }
}

/** Wipe snapshot + token from the App Group (logout / revoke). */
export async function clearWidgetData(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  try {
    await withTimeout(plugin.clear());
  } catch (err) {
    if (import.meta.env.DEV) console.warn("widgetBridge.clear:", (err as Error)?.message || err);
  }
}
