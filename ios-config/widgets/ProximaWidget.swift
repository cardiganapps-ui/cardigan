//  ProximaWidget.swift
//  CardiganWidgets — a focused single-session glance (systemSmall +
//  Lock-screen rectangular): just the next appointment, big and calm.
//  The Copilot-Money-style "one metric, beautifully" companion to the
//  denser Agenda widget. Shares Agenda's data + privacy configuration.

import SwiftUI
import WidgetKit

struct ProximaWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AgendaEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                if family == .accessoryRectangular {
                    AgendaRectangularView(snapshot: snapshot, entry: entry)
                } else {
                    ProximaSmallView(snapshot: snapshot, entry: entry)
                }
            } else {
                NotConfiguredView()
            }
        }
        .cardiganContainer(family)
        .widgetURL(CardiganTheme.agendaURL)
    }
}

struct ProximaSmallView: View {
    let snapshot: WidgetSnapshot
    let entry: AgendaEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let next = snapshot.featuredNext(at: entry.date) {
                Text(next.isToday ? "PRÓXIMA · HOY" : "PRÓXIMA · \(next.dayLabel.uppercased())")
                    .eyebrow()
                    .widgetAccentable()
                Text(next.entry.time)
                    .font(CFont.num(38))
                    .tabular()
                    .foregroundStyle(CardiganTheme.charcoal)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .widgetAccentable()
                Spacer(minLength: 2)
                HStack(spacing: 8) {
                    SessionAvatar(session: next.entry, display: entry.display, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.display.displayName(for: next.entry))
                            .font(CFont.bodyBold(14))
                            .foregroundStyle(CardiganTheme.charcoal)
                            .lineLimit(1)
                            .privacySensitive()
                        Text(modalityLabel(next.entry.modality))
                            .font(CFont.body(11))
                            .foregroundStyle(CardiganTheme.charcoalMd)
                            .lineLimit(1)
                    }
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

struct ProximaWidget: Widget {
    let kind = "CardiganProxima"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: AgendaConfigIntent.self, provider: AgendaProvider()) { entry in
            ProximaWidgetView(entry: entry)
        }
        .configurationDisplayName("Próxima sesión")
        .description("Solo tu siguiente cita, en grande.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

#Preview("Próxima", as: .systemSmall) {
    ProximaWidget()
} timeline: {
    AgendaEntry(date: Date(), snapshot: .demo, display: .nombreCompleto)
}
