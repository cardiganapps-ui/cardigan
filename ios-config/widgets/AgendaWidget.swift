//  AgendaWidget.swift
//  CardiganWidgets — the flagship widget: next session + today's
//  agenda. Supports every family (home small/medium/large + lock
//  circular/rectangular/inline). Patient identity follows the
//  AppIntent option (initials by default); names are privacySensitive
//  so a Face-ID-locked device redacts them.

import SwiftUI
import WidgetKit

// MARK: - Shared chrome (used by every widget in the bundle)

/// Fresh-install / logged-out / version-mismatch state. Doubles as the
/// App Review grace path: the widget always renders something coherent.
struct NotConfiguredView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryInline {
            Text("Abre Cardigan")
        } else if family == .accessoryCircular {
            VStack(spacing: 2) {
                Image(systemName: "heart.text.square")
                    .font(.system(size: 18, weight: .semibold))
                    .widgetAccentable()
                Text("Abrir").font(.caption2)
            }
        } else if family == .accessoryRectangular {
            VStack(alignment: .leading, spacing: 2) {
                Text("CARDIGAN").font(.caption2).fontWeight(.bold).widgetAccentable()
                Text("Abre la app para activar los widgets").font(.caption2)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "heart.text.square")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(CardiganTheme.teal)
                Text("Abre Cardigan para configurar")
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .foregroundStyle(CardiganTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

/// Small "Actualizado hace X" caption for stale snapshots.
struct StaleCaption: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        if snapshot.isStale, let date = snapshot.generatedAtDate {
            Text("Actualizado \(date.formatted(.relative(presentation: .named)))")
                .font(.caption2)
                .foregroundStyle(CardiganTheme.textSecondary)
        }
    }
}

func statusColor(_ status: String) -> Color {
    switch status {
    case SessionStatus.completed: return CardiganTheme.green
    case SessionStatus.cancelled: return CardiganTheme.red
    case SessionStatus.charged: return CardiganTheme.amber
    default: return CardiganTheme.teal
    }
}

// MARK: - Agenda views

struct AgendaWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AgendaEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                switch family {
                case .accessoryInline: AgendaInlineView(snapshot: snapshot, entry: entry)
                case .accessoryCircular: AgendaCircularView(snapshot: snapshot, entry: entry)
                case .accessoryRectangular: AgendaRectangularView(snapshot: snapshot, entry: entry)
                case .systemMedium: AgendaMediumView(snapshot: snapshot, entry: entry)
                case .systemLarge: AgendaLargeView(snapshot: snapshot, entry: entry)
                default: AgendaSmallView(snapshot: snapshot, entry: entry)
                }
            } else {
                NotConfiguredView()
            }
        }
        .containerBackground(for: .widget) { CardiganTheme.background }
        .widgetURL(CardiganTheme.agendaURL)
    }
}

// ── Home screen: small ──

struct AgendaSmallView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(snapshot.todayLabel.uppercased())
                .font(.system(size: 10, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(CardiganTheme.textSecondary)
                .lineLimit(1)
            Spacer(minLength: 2)
            if let next = snapshot.featuredNext(at: entry.date) {
                Text(next.dayLabel == "Hoy" ? next.entry.time : next.dayLabel)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(CardiganTheme.text)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Image(systemName: modalitySymbol(next.entry.modality))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(CardiganTheme.teal)
                    Text(entry.display.displayName(for: next.entry))
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(CardiganTheme.text)
                        .lineLimit(1)
                        .privacySensitive()
                }
                if next.dayLabel == "Hoy" {
                    let more = snapshot.upcomingToday(at: entry.date).count - 1
                    Text(more > 0 ? "\(more) más hoy" : "Última de hoy")
                        .font(.system(size: 11))
                        .foregroundStyle(CardiganTheme.textSecondary)
                } else {
                    Text("\(next.dayLabel) · \(next.entry.time)")
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(CardiganTheme.textSecondary)
                        .lineLimit(1)
                }
            } else {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(CardiganTheme.green)
                Text("Sin sesiones próximas")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(CardiganTheme.text)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// ── Home screen: medium ──

struct AgendaRowView: View {
    let session: SessionEntry
    let display: PatientDisplayOption
    let emphasized: Bool

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(statusColor(session.status))
                .frame(width: 3, height: emphasized ? 30 : 24)
            Text(session.time)
                .font(.system(size: emphasized ? 15 : 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(muted ? CardiganTheme.textSecondary : CardiganTheme.text)
                .frame(width: 46, alignment: .leading)
            Text(display.displayName(for: session))
                .font(.system(size: emphasized ? 15 : 13, weight: emphasized ? .bold : .semibold, design: .rounded))
                .strikethrough(session.status == SessionStatus.cancelled)
                .foregroundStyle(muted ? CardiganTheme.textSecondary : CardiganTheme.text)
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 4)
            Image(systemName: modalitySymbol(session.modality))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(session.modality == "virtual" ? CardiganTheme.blue : CardiganTheme.textSecondary)
        }
    }

    private var muted: Bool {
        session.status == SessionStatus.cancelled
            || session.status == SessionStatus.charged
            || session.status == SessionStatus.completed
    }
}

struct AgendaHeaderView: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        HStack(spacing: 6) {
            Text("Hoy")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundStyle(CardiganTheme.text)
            Text("· \(snapshot.todayLabel)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(CardiganTheme.textSecondary)
            Spacer()
            let count = snapshot.todayActiveCount
            Text(count == 1 ? "1 sesión" : "\(count) sesiones")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(CardiganTheme.tealDark)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(CardiganTheme.teal.opacity(0.14)))
        }
    }
}

struct AgendaMediumView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            AgendaHeaderView(snapshot: snapshot)
            if snapshot.sessionsToday.isEmpty {
                Spacer()
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .foregroundStyle(CardiganTheme.green)
                    Text("Sin sesiones hoy")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(CardiganTheme.textSecondary)
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                let featured = snapshot.featuredNext(at: entry.date)
                let rows = orderedRows(featuredID: featured?.entry.id)
                ForEach(rows.prefix(3)) { session in
                    AgendaRowView(
                        session: session,
                        display: entry.display,
                        emphasized: session.id == featured?.entry.id && featured?.dayLabel == "Hoy"
                    )
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The featured (next upcoming) row bubbles to the top; the rest
    /// keep chronological order.
    private func orderedRows(featuredID: String?) -> [SessionEntry] {
        guard let featuredID,
              let featured = snapshot.sessionsToday.first(where: { $0.id == featuredID })
        else { return snapshot.sessionsToday }
        return [featured] + snapshot.sessionsToday.filter { $0.id != featuredID }
    }
}

// ── Home screen: large ──

struct AgendaLargeView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    private let maxRows = 7

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AgendaHeaderView(snapshot: snapshot)
            if snapshot.sessionsToday.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(CardiganTheme.green)
                    Text("Sin sesiones hoy")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(CardiganTheme.text)
                    if let next = snapshot.featuredNext(at: entry.date) {
                        Text("Siguiente: \(next.dayLabel) · \(next.entry.time)")
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(CardiganTheme.textSecondary)
                    }
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                let featured = snapshot.featuredNext(at: entry.date)
                ForEach(snapshot.sessionsToday.prefix(maxRows)) { session in
                    AgendaRowView(
                        session: session,
                        display: entry.display,
                        emphasized: session.id == featured?.entry.id && featured?.dayLabel == "Hoy"
                    )
                }
                if snapshot.sessionsToday.count > maxRows {
                    Text("+\(snapshot.sessionsToday.count - maxRows) más")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(CardiganTheme.textSecondary)
                        .padding(.leading, 11)
                }
                Spacer(minLength: 0)
            }
            HStack {
                StaleCaption(snapshot: snapshot)
                Spacer()
                if let date = snapshot.generatedAtDate, !snapshot.isStale {
                    Text("Actualizado \(date.formatted(date: .omitted, time: .shortened))")
                        .font(.caption2)
                        .foregroundStyle(CardiganTheme.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// ── Lock screen ──

struct AgendaCircularView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        let progress = snapshot.todayProgress(at: entry.date)
        if progress.total > 0 {
            Gauge(value: Double(progress.done), in: 0...Double(progress.total)) {
                Text("hoy")
            } currentValueLabel: {
                Text("\(progress.done)/\(progress.total)")
                    .font(.system(.body, design: .rounded).weight(.bold))
                    .monospacedDigit()
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
        } else {
            VStack(spacing: 2) {
                Image(systemName: "calendar")
                    .font(.system(size: 18, weight: .semibold))
                    .widgetAccentable()
                Text("hoy 0").font(.caption2).monospacedDigit()
            }
        }
    }
}

struct AgendaRectangularView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("SIGUIENTE SESIÓN")
                .font(.system(size: 10, weight: .bold))
                .tracking(0.5)
                .widgetAccentable()
            if let next = snapshot.featuredNext(at: entry.date) {
                HStack(spacing: 4) {
                    Text(next.entry.time).monospacedDigit()
                    Text("·")
                    Text(entry.display.displayName(for: next.entry))
                        .lineLimit(1)
                        .privacySensitive()
                }
                .font(.system(.headline, design: .rounded))
                Text(next.dayLabel == "Hoy" ? modalityLabel(next.entry.modality) : next.dayLabel)
                    .font(.caption2)
            } else {
                Text("Sin sesiones próximas")
                    .font(.system(.headline, design: .rounded))
                Text("Agenda libre").font(.caption2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AgendaInlineView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        if let next = snapshot.featuredNext(at: entry.date) {
            if next.dayLabel == "Hoy" {
                Text("\(next.entry.time) · \(entry.display.displayName(for: next.entry))")
                    .privacySensitive()
            } else {
                Text("\(next.dayLabel) \(next.entry.time) · \(entry.display.displayName(for: next.entry))")
                    .privacySensitive()
            }
        } else {
            Text("Sin sesiones hoy")
        }
    }
}

// MARK: - Widget definition

struct AgendaWidget: Widget {
    let kind = "CardiganAgenda"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: AgendaConfigIntent.self, provider: AgendaProvider()) { entry in
            AgendaWidgetView(entry: entry)
        }
        .configurationDisplayName("Agenda")
        .description("Tu próxima sesión y la agenda del día.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}
