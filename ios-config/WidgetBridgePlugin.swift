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

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

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
}
