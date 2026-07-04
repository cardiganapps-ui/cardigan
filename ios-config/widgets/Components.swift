//  Components.swift
//  CardiganWidgets — the shared design vocabulary, built once from the
//  app's components (`.row-item`, `.kpi-card`, `.empty-state`, status
//  rails) and reused by every widget so the family reads as one system.
//
//  Rendering modes: brand/number elements are marked `.widgetAccentable()`
//  so on a tinted Home Screen (iOS 18) and on the Lock Screen they join the
//  accent group and stay legible, while secondary copy falls to the muted
//  group. In fullColor mode the modifier is a no-op and the real tokens
//  show through.

import SwiftUI
import WidgetKit

// MARK: - Container background

extension View {
    /// The app's white/#1A1A1A surface for Home-screen families; the
    /// system's translucent backdrop for Lock-screen accessory families
    /// (so they sit correctly under the Lock Screen vibrancy).
    @ViewBuilder
    func cardiganContainer(_ family: WidgetFamily) -> some View {
        switch family {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline:
            self.containerBackground(for: .widget) { AccessoryWidgetBackground() }
        default:
            self.containerBackground(for: .widget) { CardiganTheme.surface }
        }
    }
}

// MARK: - Status semantics

/// Left status rail / accent color for a session, matching the app:
/// tutor=purple, scheduled=teal, completed=green, cancelled=charcoal-xl
/// (muted, NOT red), charged=amber.
func statusRailColor(_ status: String, isTutor: Bool = false) -> Color {
    if isTutor { return CardiganTheme.purple }
    switch status {
    case SessionStatus.completed: return CardiganTheme.green
    case SessionStatus.cancelled: return CardiganTheme.charcoalXl
    case SessionStatus.charged: return CardiganTheme.amber
    default: return CardiganTheme.teal
    }
}

/// Modality glyph tint — virtual reads blue (app's `--blue`), everything
/// else inherits secondary so the row stays calm.
func modalityTint(_ modality: String) -> Color {
    modality == "virtual" ? CardiganTheme.blue : CardiganTheme.charcoalLt
}

// MARK: - Avatar

/// Small initials chip echoing the app's `.row-avatar` — tinted by the
/// session's status/tutor color. Falls back to a person glyph when the
/// therapist chose "Sin nombre".
struct SessionAvatar: View {
    let session: SessionEntry
    let display: PatientDisplayOption
    var size: CGFloat = 30

    var body: some View {
        let tint = statusRailColor(session.status, isTutor: session.isTutor == true)
        ZStack {
            Circle().fill(tint.opacity(0.16))
            if display == .anonimo {
                Image(systemName: session.isGroup == true ? "person.2" : "person")
                    .font(.system(size: size * 0.42, weight: .medium))
                    .foregroundStyle(tint)
            } else {
                Text(initials)
                    .font(CFont.num(size * 0.42))
                    .foregroundStyle(tint)
                    .privacySensitive()
            }
        }
        .frame(width: size, height: size)
    }

    private var initials: String {
        let s = session.initials.trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? "·" : String(s.prefix(2)).uppercased()
    }
}

// MARK: - Session row (dense agenda list)

struct SessionRow: View {
    let session: SessionEntry
    let display: PatientDisplayOption
    var emphasized = false

    private var isTutor: Bool { session.isTutor == true }
    private var muted: Bool {
        session.status == SessionStatus.cancelled
            || session.status == SessionStatus.charged
            || session.status == SessionStatus.completed
    }

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(statusRailColor(session.status, isTutor: isTutor))
                .frame(width: CardiganMetrics.railWidth, height: emphasized ? 30 : 22)
                .widgetAccentable()

            Text(session.time)
                .font(CFont.displayBold(emphasized ? 15 : 13))
                .tabular()
                .foregroundStyle(muted ? CardiganTheme.charcoalLt : CardiganTheme.charcoal)
                .frame(width: 44, alignment: .leading)

            Text(display.displayName(for: session))
                .font(emphasized ? CFont.bodyBold(15) : CFont.bodyMedium(13))
                .strikethrough(session.status == SessionStatus.cancelled, color: CardiganTheme.charcoalXl)
                .foregroundStyle(muted ? CardiganTheme.charcoalLt : CardiganTheme.charcoal)
                .lineLimit(1)
                .privacySensitive()

            Spacer(minLength: 4)

            Image(systemName: modalitySymbol(session.modality))
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(muted ? CardiganTheme.charcoalXl : modalityTint(session.modality))
        }
    }
}

// MARK: - Next-session hero (focused glance)

/// The featured next session as a hero block: big tabular time, name, and
/// a modality/day caption. Used by the Agenda small view and the dedicated
/// "Próxima sesión" widget.
struct NextSessionHero: View {
    let session: SessionEntry
    let dayLabel: String
    let isToday: Bool
    let display: PatientDisplayOption
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            Text(isToday ? "PRÓXIMA · HOY" : "PRÓXIMA · \(dayLabel.uppercased())")
                .eyebrow()
                .widgetAccentable()

            Text(session.time)
                .font(CFont.num(compact ? 30 : 34))
                .tabular()
                .foregroundStyle(CardiganTheme.charcoal)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .widgetAccentable()

            HStack(spacing: 6) {
                Image(systemName: modalitySymbol(session.modality))
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(modalityTint(session.modality))
                Text(display.displayName(for: session))
                    .font(CFont.bodyBold(15))
                    .foregroundStyle(CardiganTheme.charcoal)
                    .lineLimit(1)
                    .privacySensitive()
            }
        }
    }
}

// MARK: - KPI tile (mirrors .kpi-card)

struct KPITile: View {
    let label: String
    let value: String
    var valueTint: Color = CardiganTheme.charcoal
    var sub: String? = nil
    var sensitive: Bool = true
    var accentable: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).eyebrow().minimumScaleFactor(0.8)
            valueText
                .font(CFont.num(20))
                .tabular()
                .foregroundStyle(valueTint)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
                .modifier(AccentIf(on: accentable))
            if let sub {
                Text(sub)
                    .font(CFont.body(10))
                    .foregroundStyle(CardiganTheme.charcoalXl)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var valueText: some View {
        if sensitive { Text(value).privacySensitive() } else { Text(value) }
    }
}

private struct AccentIf: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View { on ? AnyView(content.widgetAccentable()) : AnyView(content) }
}

// MARK: - Count pill + section header

struct CountPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(CFont.bodyBold(11))
            .foregroundStyle(CardiganTheme.tealDark)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(CardiganTheme.tealBg))
            .widgetAccentable()
    }
}

/// "Hoy · Miércoles 2-Jul                    3 sesiones"
struct SectionHeader: View {
    let title: String
    let context: String
    var pill: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            Text(title)
                .font(CFont.num(15))
                .foregroundStyle(CardiganTheme.charcoal)
            Text("· \(context)")
                .font(CFont.bodyMedium(12))
                .foregroundStyle(CardiganTheme.charcoalMd)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let pill { CountPill(text: pill) }
        }
    }
}

// MARK: - Empty / stale

/// "No sessions" state (has data, nothing scheduled) for system families —
/// mirrors the app's `.empty-state` (cream circle + glyph + title).
struct WidgetEmptyState: View {
    var glyph: String = "checkmark.circle"
    var title: String = "Sin sesiones hoy"
    var subtitle: String? = nil
    var tint: Color = CardiganTheme.green
    var large = false

    var body: some View {
        VStack(spacing: large ? 8 : 6) {
            ZStack {
                Circle().fill(CardiganTheme.creamDark).frame(width: large ? 48 : 40, height: large ? 48 : 40)
                Image(systemName: glyph)
                    .font(.system(size: large ? 20 : 17, weight: .regular))
                    .foregroundStyle(tint)
            }
            Text(title)
                .font(CFont.displayBold(large ? 15 : 13))
                .foregroundStyle(CardiganTheme.charcoal)
                .multilineTextAlignment(.center)
            if let subtitle {
                Text(subtitle)
                    .font(CFont.body(11))
                    .foregroundStyle(CardiganTheme.charcoalMd)
                    .multilineTextAlignment(.center)
                    .tabular()
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// Fresh-install / logged-out / version-mismatch state, family-aware.
/// Doubles as the App-Review grace path: always renders something coherent.
struct NotConfiguredView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("Abre Cardigan")
        case .accessoryCircular:
            VStack(spacing: 2) {
                Image(systemName: "heart.text.square")
                    .font(.system(size: 18, weight: .semibold))
                    .widgetAccentable()
                Text("Abrir").font(.caption2)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text("CARDIGAN").font(.caption2.weight(.bold)).widgetAccentable()
                Text("Abre la app para activar los widgets").font(.caption2)
            }
        default:
            VStack(spacing: 8) {
                ZStack {
                    Circle().fill(CardiganTheme.tealBg).frame(width: 46, height: 46)
                    Image(systemName: "heart.text.square")
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(CardiganTheme.teal)
                        .widgetAccentable()
                }
                Text("Abre Cardigan para configurar")
                    .font(CFont.bodyMedium(12))
                    .foregroundStyle(CardiganTheme.charcoalMd)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

/// "Actualizado hace X" caption for stale snapshots (> 36 h).
struct StaleCaption: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        if snapshot.isStale, let date = snapshot.generatedAtDate {
            Text("Actualizado \(date.formatted(.relative(presentation: .named)))")
                .font(CFont.body(10))
                .foregroundStyle(CardiganTheme.charcoalXl)
        }
    }
}
