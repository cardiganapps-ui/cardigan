//  SemanaWidget.swift
//  CardiganWidgets — week occupancy at a glance: a Lun–Dom mini bar chart
//  of session counts, today highlighted in teal. Counts only — no patient
//  identity, so it's safe at full glanceability.

import SwiftUI
import WidgetKit

struct SemanaWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SemanaEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                SemanaChartView(snapshot: snapshot)
            } else {
                NotConfiguredView()
            }
        }
        .cardiganContainer(family)
        .widgetURL(CardiganTheme.agendaURL)
    }
}

struct SemanaChartView: View {
    let snapshot: WidgetSnapshot

    private let barMaxHeight: CGFloat = 44

    var body: some View {
        let total = snapshot.week.reduce(0) { $0 + $1.count }
        let peak = max(1, snapshot.week.map(\.count).max() ?? 1)

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Esta semana", context: total == 1 ? "1 sesión" : "\(total) sesiones")
            VStack(spacing: 4) {
                HStack(alignment: .bottom, spacing: 8) {
                    ForEach(snapshot.week, id: \.d) { day in
                        VStack(spacing: 4) {
                            Text(day.count > 0 ? "\(day.count)" : " ")
                                .font(CFont.num(10))
                                .tabular()
                                .foregroundStyle(day.isToday ? CardiganTheme.tealDark : CardiganTheme.charcoalLt)
                            UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3)
                                .fill(day.isToday ? CardiganTheme.teal : CardiganTheme.teal.opacity(0.26))
                                .frame(height: max(4, barMaxHeight * CGFloat(day.count) / CGFloat(peak)))
                                .widgetAccentable()
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                Rectangle()
                    .fill(CardiganTheme.borderLt)
                    .frame(height: 1)
                HStack(spacing: 8) {
                    ForEach(snapshot.week, id: \.d) { day in
                        Text(day.d)
                            .font(day.isToday ? CFont.bodyBold(9) : CFont.bodyMedium(9))
                            .foregroundStyle(day.isToday ? CardiganTheme.tealDark : CardiganTheme.charcoalMd)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct SemanaWidget: Widget {
    let kind = "CardiganSemana"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SemanaProvider()) { entry in
            SemanaWidgetView(entry: entry)
        }
        .configurationDisplayName("Semana")
        .description("Tus sesiones de la semana de un vistazo.")
        .supportedFamilies([.systemMedium])
    }
}

#Preview("Semana", as: .systemMedium) {
    SemanaWidget()
} timeline: {
    SemanaEntry(date: Date(), snapshot: .demo)
}
