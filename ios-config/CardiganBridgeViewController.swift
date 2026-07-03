//  CardiganBridgeViewController.swift
//  Cardigan — CAPBridgeViewController subclass that EXPLICITLY registers
//  the local WidgetBridge plugin.
//
//  Why this exists: Capacitor 8's auto-registration walks
//  `packageClassList` in capacitor.config.json and does
//  `NSClassFromString(name)`. That reliably finds plugins shipped as
//  SPM packages, but our WidgetBridgePlugin is a loose Swift class in
//  the App target and — despite being `@objc(WidgetBridgePlugin)` and
//  listed in packageClassList — was NOT being picked up at runtime, so
//  every `WidgetBridge.*` bridge call hung forever (the JS promise
//  never resolved because nothing on the native side handled it). That
//  left the App Group empty and the widgets stuck on "Abre Cardigan
//  para configurar".
//
//  Registering the instance in `capacitorDidLoad()` bypasses the
//  string-lookup path entirely and guarantees the plugin is live.
//  registerPluginInstance is idempotent (it just overrides any existing
//  registration), so this is safe even if auto-registration also works.
//
//  Wired by scripts/apply-ios-config.sh, which points Main.storyboard's
//  root view controller at this class, and by scripts/add-widget-target.rb
//  / apply-ios-config.sh which compile this file into the App target.

import Capacitor
import UIKit

class CardiganBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
