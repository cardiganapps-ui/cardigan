//  AgendaWidget.swift
//  CardiganWidgets — the flagship widget: next session + today's agenda,
//  across every family (home small/medium/large + lock circular/
//  rectangular/inline). Built from the shared design vocabulary in
//  Components.swift so it reads as the same product as the app. Patient
//  identity follows the AppIntent option (initials by default) and names
//  are privacySensitive so a locked device redacts them.

import SwiftUI
import WidgetKit

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
        .cardiganContainer(family)
        .widgetURL(CardiganTheme.agendaURL)
    }
}

// ── Home screen: small ──

struct AgendaSmallView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let next = snapshot.featuredNext(at: entry.date) {
                NextSessionHero(
                    session: next.entry, dayLabel: next.dayLabel, isToday: next.isToday,
                    display: entry.display, compact: true
                )
                Spacer(minLength: 2)
                if next.isToday {
                    let more = snapshot.upcomingToday(at: entry.date).count - 1
                    Text(more > 0 ? "\(more) sesión\(more == 1 ? "" : "es") más hoy" : "Última de hoy")
                        .font(CFont.body(11))
                        .foregroundStyle(CardiganTheme.charcoalMd)
                        .lineLimit(1)
                }
            } else {
                Spacer()
                WidgetEmptyState(title: "Sin sesiones", subtitle: "Agenda libre")
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// ── Home screen: medium ──

struct AgendaMediumView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            SectionHeader(title: "Hoy", context: snapshot.todayLabel, pill: countPill)
            if snapshot.sessionsToday.isEmpty {
                Spacer()
                WidgetEmptyState()
                Spacer()
            } else {
                let featured = snapshot.featuredNext(at: entry.date)
                let rows = orderedRows(featuredID: featured?.isToday == true ? featured?.entry.id : nil)
                VStack(spacing: 8) {
                    ForEach(rows.prefix(3)) { session in
                        SessionRow(
                            session: session, display: entry.display,
                            emphasized: session.id == featured?.entry.id && featured?.isToday == true
                        )
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var countPill: String {
        let c = snapshot.todayActiveCount
        return c == 1 ? "1 sesión" : "\(c) sesiones"
    }

    /// The featured (next upcoming) row bubbles to the top; the rest keep
    /// chronological order.
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
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Hoy", context: snapshot.todayLabel, pill: countPill)
            if snapshot.sessionsToday.isEmpty {
                Spacer()
                WidgetEmptyState(
                    subtitle: snapshot.featuredNext(at: entry.date).map { "Siguiente: \($0.dayLabel) · \($0.entry.time)" },
                    large: true
                )
                Spacer()
            } else {
                let featured = snapshot.featuredNext(at: entry.date)
                VStack(spacing: 9) {
                    ForEach(snapshot.sessionsToday.prefix(maxRows)) { session in
                        SessionRow(
                            session: session, display: entry.display,
                            emphasized: session.id == featured?.entry.id && featured?.isToday == true
                        )
                    }
                }
                if snapshot.sessionsToday.count > maxRows {
                    Text("+\(snapshot.sessionsToday.count - maxRows) más")
                        .font(CFont.bodyMedium(11))
                        .foregroundStyle(CardiganTheme.charcoalMd)
                        .padding(.leading, 13)
                }
                Spacer(minLength: 0)
            }
            HStack {
                StaleCaption(snapshot: snapshot)
                Spacer()
                if let date = snapshot.generatedAtDate, !snapshot.isStale {
                    Text("Actualizado \(date.formatted(date: .omitted, time: .shortened))")
                        .font(CFont.body(10))
                        .foregroundStyle(CardiganTheme.charcoalXl)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var countPill: String {
        let c = snapshot.todayActiveCount
        return c == 1 ? "1 sesión" : "\(c) sesiones"
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
            if let next = snapshot.featuredNext(at: entry.date) {
                Text(next.isToday ? "SIGUIENTE SESIÓN" : "PRÓXIMA · \(next.dayLabel.uppercased())")
                    .font(.system(size: 11, weight: .semibold))
                    .widgetAccentable()
                HStack(spacing: 4) {
                    Text(next.entry.time).monospacedDigit()
                    Text("·")
                    Text(entry.display.displayName(for: next.entry))
                        .lineLimit(1)
                        .privacySensitive()
                }
                .font(.system(.headline, design: .rounded))
                Text(next.isToday ? modalityLabel(next.entry.modality) : "\(next.dayLabel) · \(next.entry.time)")
                    .font(.caption2)
            } else {
                Text("AGENDA").font(.system(size: 11, weight: .semibold)).widgetAccentable()
                Text("Sin sesiones próximas").font(.system(.headline, design: .rounded))
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
            if next.isToday {
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

// MARK: - Previews

#Preview("Agenda medium", as: .systemMedium) {
    AgendaWidget()
} timeline: {
    AgendaEntry(date: Date(), snapshot: .demo, display: .iniciales)
}

#Preview("Agenda small", as: .systemSmall) {
    AgendaWidget()
} timeline: {
    AgendaEntry(date: Date(), snapshot: .demo, display: .nombreCompleto)
}

#Preview("Agenda large", as: .systemLarge) {
    AgendaWidget()
} timeline: {
    AgendaEntry(date: Date(), snapshot: .demo, display: .iniciales)
}
