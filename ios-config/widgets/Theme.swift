//  Theme.swift
//  CardiganWidgets — design tokens mirrored from src/styles/base.css
//  so the widgets read as the same product as the app. Backgrounds and
//  body text use dynamic system colors (free dark mode); the brand
//  accents below are the same fixed values the app uses in both themes.

import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

enum CardiganTheme {
    // Brand accents — src/styles/base.css tokens.
    static let teal = Color(hex: 0x5B9BAF)        // --teal
    static let tealDark = Color(hex: 0x4A8799)    // --teal-dark
    static let red = Color(hex: 0xD96B6B)         // --red
    static let green = Color(hex: 0x3DAB74)       // --green
    static let amber = Color(hex: 0xD4A040)       // --amber
    static let purple = Color(hex: 0x8B7EC8)      // --purple (tutor)
    static let blue = Color(hex: 0x5B8FD4)        // --blue (virtual)

    // Dynamic surfaces/text — adapt to light/dark automatically.
    static let background = Color(uiColor: .systemBackground)
    static let text = Color.primary
    static let textSecondary = Color.secondary

    /// Deep-link bases — must stay valid inputs for
    /// src/lib/nativeDeepLinks.ts + useLaunchParams (?screen= / ?fab=).
    static let agendaURL = URL(string: "https://cardigan.mx/?screen=agenda")!
    static let financesURL = URL(string: "https://cardigan.mx/?screen=finances")!
    static let newSessionURL = URL(string: "https://cardigan.mx/?fab=session")!
    static let newPaymentURL = URL(string: "https://cardigan.mx/?fab=payment")!
}

/// "$12,400" — same visual shape as the app's `formatCurrency`
/// ("$" + toLocaleString, no decimals). Money always renders with
/// monospaced digits at the call sites (tabular-nums rule).
func formatMXN(_ amount: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    formatter.locale = Locale(identifier: "es_MX")
    let grouped = formatter.string(from: NSNumber(value: amount.rounded())) ?? "0"
    return "$\(grouped)"
}

/// SF Symbol per session modality (sessions.modality check constraint:
/// presencial / virtual / telefonica / a-domicilio).
func modalitySymbol(_ modality: String) -> String {
    switch modality {
    case "virtual": return "video"
    case "telefonica": return "phone"
    case "a-domicilio": return "house"
    default: return "person.2"
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
