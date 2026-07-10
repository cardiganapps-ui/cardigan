// swift-tools-version: 5.9
// REQUIRED for the plugin to ship at all: Capacitor 8 integrates
// plugins via Swift Package Manager (`cap add ios` generates no
// Podfile). Without this manifest the CLI warns
// "cardigan-native-chrome does not have a Package.swift" and SKIPS
// linking the sources — the class name still lands in
// packageClassList, so the JS bridge resolves the plugin and then
// every call fails "not implemented", silently falling back to the
// web pill. (The podspec alongside is only used by CocoaPods-based
// integrations and is NOT sufficient.)
import PackageDescription

let package = Package(
    name: "CardiganNativeChrome",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "CardiganNativeChrome",
            targets: ["NativeChromePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "NativeChromePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/NativeChromePlugin")
    ]
)
