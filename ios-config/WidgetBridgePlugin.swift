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

    private func reloadWidgets() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), !json.isEmpty else {
            call.reject("json is required")
            return
        }
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.set(json, forKey: Self.snapshotKey)
        reloadWidgets()
        call.resolve()
    }

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.set(token, forKey: Self.tokenKey)
        reloadWidgets()
        call.resolve()
    }

    @objc func hasToken(_ call: CAPPluginCall) {
        let value = (store?.string(forKey: Self.tokenKey)?.isEmpty == false)
        call.resolve(["value": value])
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard let store = store else {
            call.reject("app group unavailable")
            return
        }
        store.removeObject(forKey: Self.snapshotKey)
        store.removeObject(forKey: Self.tokenKey)
        reloadWidgets()
        call.resolve()
    }

    /// Diagnostics for "widgets active but not rendering". Reports, from
    /// the APP process: whether the App Group container is reachable,
    /// how many bytes the snapshot/token occupy, and the widget
    /// process's last heartbeat (written by the extension). Reading the
    /// widget's heartbeat back here proves the container is genuinely
    /// SHARED between the two processes.
    @objc func debugState(_ call: CAPPluginCall) {
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
