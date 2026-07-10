import Capacitor
import SwiftUI
import UIKit

/* Bridges the web app's tab state to the native GlassTabBar and taps
   back to the web (`tabSelected` events → navigate()). The web side
   (src/lib/nativeChrome.ts) owns ALL policy — which tabs exist, which
   is active, when the bar must hide because a web overlay would be
   covered by it. This class only mounts/updates the SwiftUI view.

   iOS 26+ only: on older majors `isAvailable` reports false and the
   web app keeps its CSS-glass DOM pill (zero behavior change). */

@objc(NativeChromePlugin)
public class NativeChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeChromePlugin"
    public let jsName = "NativeChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setActive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "teardown", returnType: CAPPluginReturnPromise)
    ]

    private var hostController: UIViewController?
    private let model = GlassTabModel()

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) {
            call.resolve([
                "available": true,
                "height": GlassTabBarMetrics.height,
                "bottomOffset": GlassTabBarMetrics.bottomOffset
            ])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.reject("Native chrome requires iOS 26")
            return
        }
        let tabsData = call.getArray("tabs", JSObject.self) ?? []
        let tabs: [GlassTab] = tabsData.compactMap { obj in
            guard let id = obj["id"] as? String,
                  let title = obj["title"] as? String,
                  let symbol = obj["symbol"] as? String else { return nil }
            return GlassTab(id: id, title: title, symbol: symbol)
        }
        let activeIndex = call.getInt("activeIndex") ?? 0
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.model.tabs = tabs
            self.model.activeIndex = max(0, min(activeIndex, tabs.count - 1))
            self.model.onSelect = { [weak self] idx, id in
                self?.notifyListeners("tabSelected", data: ["index": idx, "id": id])
            }
            self.mountIfNeeded()
            call.resolve()
        }
    }

    @objc func setActive(_ call: CAPPluginCall) {
        let index = call.getInt("index") ?? 0
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            // -1 = no tab matches the current screen (Settings, Archivo):
            // keep the bar mounted but clear the highlight by pointing at
            // an out-of-range index — SwiftUI just renders no active tint.
            self.model.activeIndex = index
            call.resolve()
        }
    }

    @objc func setVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        DispatchQueue.main.async { [weak self] in
            self?.model.visible = visible
            call.resolve()
        }
    }

    @objc func teardown(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.hostController?.willMove(toParent: nil)
            self.hostController?.view.removeFromSuperview()
            self.hostController?.removeFromParent()
            self.hostController = nil
            call.resolve()
        }
    }

    @available(iOS 26.0, *)
    private func mountIfNeeded() {
        guard hostController == nil,
              let parent = bridge?.viewController,
              let container = parent.view else { return }
        let hosting = UIHostingController(rootView: GlassTabBar(model: model))
        hosting.view.backgroundColor = .clear
        parent.addChild(hosting)
        container.addSubview(hosting.view)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            hosting.view.bottomAnchor.constraint(
                equalTo: container.safeAreaLayoutGuide.bottomAnchor,
                constant: -GlassTabBarMetrics.bottomOffset
            ),
            hosting.view.heightAnchor.constraint(equalToConstant: GlassTabBarMetrics.height)
        ])
        hosting.didMove(toParent: parent)
        hostController = hosting
    }
}
