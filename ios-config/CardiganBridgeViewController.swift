//  CardiganBridgeViewController.swift
//  Cardigan — CAPBridgeViewController subclass that mirrors the widget
//  data from the web app into the App Group WITHOUT relying on a custom
//  Capacitor plugin's method dispatch.
//
//  Why this exists (the whole widgets saga in one paragraph): a loose
//  app-target Capacitor plugin (WidgetBridgePlugin) was used to write the
//  snapshot/token into the App Group. In RELEASE (TestFlight) builds every
//  bridge call to it hung forever — verified on-device that the native
//  method bodies never executed even though the plugin was registered
//  (present in Capacitor.PluginHeaders). Capacitor's handleJSCall silently
//  returns (no reject) when it can't dispatch a call, so the JS promise
//  hangs. After many builds isolating it, the robust fix is to stop using
//  Capacitor method dispatch for this at all and use only primitives that
//  demonstrably work in a release build:
//    • the web app writes the snapshot/token to localStorage (reliable),
//    • this VC reads localStorage via WKWebView.evaluateJavaScript (the
//      same mechanism Capacitor itself uses to resolve every plugin call),
//    • and writes them into UserDefaults(suiteName: appGroup) natively.
//  The lifecycle-observer selectors below are referenced via #selector at
//  compile time, so — unlike the plugin's string-based CAPPluginMethod
//  selectors — they cannot be dead-stripped by the release optimizer.
//
//  Wired by scripts/apply-ios-config.sh (points Main.storyboard's root VC
//  at this class) and scripts/add-widget-target.rb (compiles it into the
//  App target).

import Capacitor
import UIKit
import WidgetKit

class CardiganBridgeViewController: CAPBridgeViewController {
    // Must match ios-config/App.entitlements, the widget entitlements, and
    // SharedModels.swift::AppGroupStore.suiteName.
    private static let suiteName = "group.mx.cardigan.app"
    // App Group keys the widget extension reads (SharedModels.swift).
    private static let snapshotKey = "widget.snapshot.v1"
    private static let tokenKey = "widget.token"
    // localStorage keys the web app writes to (src/lib/widgetBridge.ts).
    private static let lsSnapshot = "cardigan.widget.snapshot.v1"
    private static let lsToken = "cardigan.widget.token"

    override func viewDidLoad() {
        super.viewDidLoad()
        let nc = NotificationCenter.default
        // didBecomeActive: pick up the latest snapshot each foreground.
        nc.addObserver(self, selector: #selector(syncWidgetData),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
        // didEnterBackground: the moment right before the user looks at the
        // home screen — flush the freshest snapshot into the App Group.
        nc.addObserver(self, selector: #selector(syncWidgetData),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    // Read the web app's localStorage widget payload and mirror it into the
    // shared App Group container, then ask WidgetKit to repaint. Everything
    // here runs on the main thread (evaluateJavaScript requires it); the
    // reload is pushed off-thread because WidgetKit's XPC can block.
    @objc private func syncWidgetData() {
        guard let webView = self.webView else { return }
        let js = "JSON.stringify({"
            + "s:(localStorage.getItem('\(Self.lsSnapshot)')||''),"
            + "t:(localStorage.getItem('\(Self.lsToken)')||'')"
            + "})"
        webView.evaluateJavaScript(js) { result, _ in
            guard let json = result as? String,
                  let data = json.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let store = UserDefaults(suiteName: Self.suiteName) else { return }
            var changed = false
            if let s = obj["s"] as? String, !s.isEmpty,
               store.string(forKey: Self.snapshotKey) != s {
                store.set(s, forKey: Self.snapshotKey); changed = true
            }
            if let t = obj["t"] as? String, !t.isEmpty,
               store.string(forKey: Self.tokenKey) != t {
                store.set(t, forKey: Self.tokenKey); changed = true
            }
            if changed {
                DispatchQueue.global(qos: .utility).async {
                    WidgetCenter.shared.reloadAllTimelines()
                }
            }
        }
    }
}
