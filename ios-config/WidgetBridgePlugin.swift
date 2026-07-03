//  WidgetBridgePlugin.swift
//  Cardigan — App-target half of the WidgetBridge Capacitor plugin.
//
//  Copied into ios/App/App/ by scripts/apply-ios-config.sh (the ios/
//  project is regenerated on every CI build — this file is the source
//  of truth, never edit the copy). The Ruby target script adds it to
//  the App target's sources; apply-ios-config.sh appends
//  "WidgetBridgePlugin" to packageClassList in the generated
//  capacitor.config.json so the Capacitor bridge instantiates it.
//
//  JS half: src/lib/widgetBridge.ts. Contract:
//    setSnapshot({ json })  → App Group "widget.snapshot.v1"
//    setToken({ token })    → App Group "widget.token"
//    hasToken()             → { value: Bool }
//    clear()                → removes both keys
//  Every mutation ends with WidgetCenter.reloadAllTimelines() so the
//  widgets repaint right after the app refreshes its data.

import Foundation
import Capacitor
import WidgetKit

// NOTE: the ObjC-runtime name (@objc(...)) is deliberately "WidgetBridge",
// MATCHING jsName — not the Swift class name. Capacitor's handleJSCall has
// a self-healing fallback: `plugins[pluginId] ?? NSClassFromString(pluginId)`
// where pluginId IS the jsName the JS proxy calls with ("WidgetBridge").
// Exposing the class under that exact name means that even if BOTH primary
// registration paths fail (packageClassList auto-register at bridge init,
// and registerPluginInstance in CardiganBridgeViewController.capacitorDidLoad),
// the very first method call resolves NSClassFromString("WidgetBridge"),
// instantiates + registers the plugin, and dispatches — instead of silently
// hanging forever (Capacitor returns without rejecting on plugin-not-found,
// which is exactly the "every bridge call times out" symptom we hit).
@objc(WidgetBridge)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridge"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "debugState", returnType: CAPPluginReturnPromise),
    ]

    private static let widgetRunKey = "widget.diag.lastRun"
    private static let widgetStateKey = "widget.diag.lastState"

    // Must match ios-config/App.entitlements, the widget entitlements,
    // and SharedModels.swift::AppGroupStore.suiteName.
    private static let suiteName = "group.mx.cardigan.app"
    private static let snapshotKey = "widget.snapshot.v1"
    private static let tokenKey = "widget.token"

    private var store: UserDefaults? { UserDefaults(suiteName: Self.suiteName) }

    // DIAGNOSTIC (temporary): push a marker into a JS global the instant a
    // native method body is entered — BEFORE any resolve/reject. Uses the
    // same bridge.eval → evaluateJavaScript path resolve() uses. Lets the
    // Settings diagnostic distinguish, with zero dependence on the call
    // resolving: (a) marker present + call still timed out ⇒ the method RAN
    // and native→JS works, so the hang is in callback matching; (b) marker
    // ABSENT ⇒ the method never executed, so dispatch/registration is the
    // culprit despite PluginHeaders showing the plugin. Remove once fixed.
    private func mark(_ label: String) {
        bridge?.eval(js: "window.__wbMarks=(window.__wbMarks||[]);window.__wbMarks.push('\(label) '+Date.now())")
    }

    // WidgetKit's XPC to `chronod` can BLOCK the caller for seconds (or
    // indefinitely on a freshly-installed / mis-provisioned extension).
    // Capacitor runs every plugin method on ONE shared serial queue
    // (DispatchQueue(label: "bridge")); a single blocked call there wedges
    // the queue and makes EVERY subsequent bridge call — even a trivial
    // read like debugState — hang forever. That was the real "widgets
    // active but not rendering" bug: syncWidgets' setSnapshot on foreground
    // blocked the bridge queue on reloadAllTimelines. So we ALWAYS resolve
    // the call first and fire the reload asynchronously off the bridge
    // thread — the write has already landed in the App Group; if the reload
    // is slow, WidgetKit still picks up the new snapshot on its own timeline.
    private func reloadWidgets() {
        DispatchQueue.global(qos: .utility).async {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    // ⚠️ All bridge methods MUST be `@objc public dynamic` — NOT plain
    // `@objc func`. This plugin is compiled into the App target (not a
    // framework), so it's subject to the app's whole-module optimization.
    // In the RELEASE archive the optimizer dead-strips internal @objc
    // methods that are only ever invoked dynamically (via selector), so
    // Capacitor's `plugin.responds(to: "setSnapshot:")` returns false and
    // handleJSCall silently returns WITHOUT resolving — every bridge call
    // then hangs forever (verified on-device: the method body never ran).
    // Debug/simulator builds don't strip, which is why the dry-run passed
    // but TestFlight didn't. `public dynamic` forces the method to be
    // emitted with full dynamic dispatch and preserved. Do not "simplify".
    @objc public dynamic func setSnapshot(_ call: CAPPluginCall) {
        mark("setSnapshot")
        guard let json = call.getString("json"), !json.isEmpty else {
            call.reject("json is required")
            return
        }
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.set(json, forKey: Self.snapshotKey)
        call.resolve()
        reloadWidgets()
    }

    @objc public dynamic func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.set(token, forKey: Self.tokenKey)
        call.resolve()
        reloadWidgets()
    }

    @objc public dynamic func hasToken(_ call: CAPPluginCall) {
        let value = (store?.string(forKey: Self.tokenKey)?.isEmpty == false)
        call.resolve(["value": value])
    }

    @objc public dynamic func clear(_ call: CAPPluginCall) {
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.removeObject(forKey: Self.snapshotKey)
        store.removeObject(forKey: Self.tokenKey)
        call.resolve()
        reloadWidgets()
    }

    /// Diagnostics for "widgets active but not rendering". Reports, from
    /// the APP process: whether the App Group container is reachable,
    /// how many bytes the snapshot/token occupy, and the widget
    /// process's last heartbeat (written by the extension). Reading the
    /// widget's heartbeat back here proves the container is genuinely
    /// SHARED between the two processes.
    @objc public dynamic func debugState(_ call: CAPPluginCall) {
        mark("debugState")
        let store = self.store
        let snapshot = store?.string(forKey: Self.snapshotKey)
        let token = store?.string(forKey: Self.tokenKey)
        call.resolve([
            "appGroupAvailable": store != nil,
            "suiteName": Self.suiteName,
            "snapshotBytes": snapshot?.utf8.count ?? 0,
            "hasToken": (token?.isEmpty == false),
            "widgetLastRun": store?.string(forKey: Self.widgetRunKey) ?? "",
            "widgetLastState": store?.string(forKey: Self.widgetStateKey) ?? "",
        ])
    }
}
