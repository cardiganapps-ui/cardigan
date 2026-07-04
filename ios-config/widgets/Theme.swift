//  Theme.swift
//  CardiganWidgets — design tokens mirrored 1:1 from src/styles/base.css
//  (light) and src/styles/dark.css (dark) so the widgets read as the same
//  product as the app in BOTH appearances. Every brand accent is an
//  adaptive light/dark pair (the app's palette flips in dark; fixed hex
//  looked off-brand). Typography ships the real Nunito / Nunito Sans faces
//  (ios-config/widgets/fonts/, registered via Info.plist UIAppFonts) so
//  numbers and headers match the app's `--font-d` display type exactly.

import SwiftUI
import UIKit

// MARK: - Color plumbing

private func uiHex(_ hex: UInt32, _ alpha: Double = 1) -> UIColor {
    UIColor(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        alpha: alpha
    )
}

extension Color {
    init(hex: UInt32) { self.init(uiColor: uiHex(hex)) }

    /// Light/dark adaptive color from two hex literals — the widget analog
    /// of a CSS custom property that has a `dark.css` override.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? uiHex(dark) : uiHex(light) })
    }

    init(lightU: UIColor, darkU: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? darkU : lightU })
    }
}

// MARK: - Tokens (base.css :root → dark.css overrides)

enum CardiganTheme {
    // Teal family — primary / interactive / active.
    static let teal      = Color(light: 0x5B9BAF, dark: 0x4A9BB0)   // --teal
    static let tealDark  = Color(light: 0x4A8799, dark: 0x5AADBE)   // --teal-dark
    static let tealLight = Color(light: 0x7AB5C7, dark: 0x6DB8CC)   // --teal-light
    static let tealPale  = Color(lightU: uiHex(0xEAF4F7), darkU: uiHex(0x5B9BAF, 0.15)) // --teal-pale
    static let tealMist  = Color(lightU: uiHex(0xF2F9FB), darkU: uiHex(0x5B9BAF, 0.08)) // --teal-mist

    // Cream — accent band inside cards / empty-state circle (never a page bg).
    static let cream     = Color(light: 0xF5F0EB, dark: 0x2A2A2A)   // --cream
    static let creamDark = Color(light: 0xEDE7DF, dark: 0x333333)   // --cream-dark

    // Charcoal text scale.
    static let charcoal   = Color(light: 0x2E2E2E, dark: 0xEAEAEA)  // --charcoal (body)
    static let charcoalMd = Color(light: 0x555555, dark: 0xBFBFBF)  // --charcoal-md (secondary)
    static let charcoalLt = Color(light: 0x777777, dark: 0x999999)  // --charcoal-lt (tertiary)
    static let charcoalXl = Color(light: 0x9E9E9E, dark: 0x888888)  // --charcoal-xl (muted / eyebrows)

    // Structure.
    static let border   = Color(light: 0xE2DBD3, dark: 0x3A3A3A)    // --border
    static let borderLt = Color(light: 0xEDE8E2, dark: 0x2E2E2E)    // --border-lt
    static let surface  = Color(light: 0xFFFFFF, dark: 0x1A1A1A)    // --white (page + card)

    // Status accents + their tinted-panel companions.
    static let green  = Color(light: 0x3DAB74, dark: 0x4EC98A)      // success / paid / completed
    static let red    = Color(light: 0xD96B6B, dark: 0xE57777)      // unpaid / destructive / owed
    static let amber  = Color(light: 0xD4A040, dark: 0xE0B050)      // pending / charged
    static let purple = Color(light: 0x8B7EC8, dark: 0xA08FD8)      // tutor sessions
    static let blue   = Color(light: 0x5B8FD4, dark: 0x82A6E0)      // virtual modality
    static let rose   = Color(light: 0xC77E9C, dark: 0xD896B0)      // interview / potential

    static let greenBg  = Color(lightU: uiHex(0xEBF8F2), darkU: uiHex(0x3DAB74, 0.12))
    static let redBg    = Color(lightU: uiHex(0xFDF1F1), darkU: uiHex(0xD96B6B, 0.12))
    static let amberBg  = Color(lightU: uiHex(0xFDF6E8), darkU: uiHex(0xD4A040, 0.12))
    static let tealBg   = Color(lightU: uiHex(0xEAF4F7), darkU: uiHex(0x5B9BAF, 0.15))

    // Legacy aliases (kept so incremental call sites read cleanly).
    static let background = surface
    static let text = charcoal
    static let textSecondary = charcoalMd

    /// Deep-link bases — must stay valid inputs for
    /// src/lib/nativeDeepLinks.ts + useLaunchParams (?screen= / ?fab=).
    static let agendaURL = URL(string: "https://cardigan.mx/?screen=agenda")!
    static let financesURL = URL(string: "https://cardigan.mx/?screen=finances")!
    static let newSessionURL = URL(string: "https://cardigan.mx/?fab=session")!
    static let newPaymentURL = URL(string: "https://cardigan.mx/?fab=payment")!
}

// MARK: - Metrics

enum CardiganMetrics {
    static let radiusSm: CGFloat = 8    // --radius-sm
    static let radius: CGFloat = 12     // --radius
    static let radiusLg: CGFloat = 16   // --radius-lg
    static let railWidth: CGFloat = 3   // session status rail
    static let tintFill: Double = 0.14  // standard accent-fill opacity (pills/tiles)
}

// MARK: - Typography (real Nunito, bundled)

/// Cardigan's type system for the widgets. Numbers/headers use Nunito
/// (`--font-d`); body copy uses Nunito Sans (`--font`). Font.custom with
/// `relativeTo:` opts home-screen sizes into Dynamic Type. The face names
/// are the instanced PostScript names shipped under fonts/ — if a face
/// ever fails to load, `.custom` falls back to the system font, so text is
/// never invisible.
enum CFont {
    // Display — Nunito. `num` = the ExtraBold 800 used for every KPI value.
    static func num(_ size: CGFloat, relativeTo style: Font.TextStyle = .title3) -> Font {
        .custom("Nunito-ExtraBold", size: size, relativeTo: style)
    }
    static func displayBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .headline) -> Font {
        .custom("Nunito-Bold", size: size, relativeTo: style)
    }
    // Body — Nunito Sans.
    static func body(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("NunitoSans-Regular", size: size, relativeTo: style)
    }
    static func bodyMedium(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("NunitoSans-SemiBold", size: size, relativeTo: style)
    }
    static func bodyBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("NunitoSans-Bold", size: size, relativeTo: style)
    }
}

extension View {
    /// Uppercase eyebrow label (10px, 700, tracked, muted) — mirrors the
    /// app's `.kpi-label`. Applied to an already-uppercased Text.
    func eyebrow() -> some View {
        self.font(CFont.bodyBold(10))
            .tracking(0.7)
            .foregroundStyle(CardiganTheme.charcoalXl)
            .lineLimit(1)
    }

    /// Tabular money/number rendering (the tabular-nums rule).
    func tabular() -> some View { self.monospacedDigit() }
}

// MARK: - Formatting

/// "$12,400" — same visual shape as the app's `formatMXN`
/// ("$" + es-MX grouping, no decimals). Always paired with `.tabular()`.
func formatMXN(_ amount: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    formatter.locale = Locale(identifier: "es_MX")
    let grouped = formatter.string(from: NSNumber(value: amount.rounded())) ?? "0"
    return "$\(grouped)"
}

/// SF Symbol per session modality (sessions.modality check constraint:
/// presencial / virtual / telefonica / a-domicilio). Chosen to read like
/// the app's thin-line icons — rendered at regular weight, monochrome.
func modalitySymbol(_ modality: String) -> String {
    switch modality {
    case "virtual": return "video"
    case "telefonica": return "phone"
    case "a-domicilio": return "house"
    default: return "person"
    }
}

func modalityLabel(_ modality: String) -> String {
    switch modality {
    case "virtual": return "Virtual"
    case "telefonica": return "Telefónica"
    case "a-domicilio": return "A domicilio"
    default: return "Presencial"
    }
}
