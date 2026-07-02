//  SemanaWidget.swift
//  CardiganWidgets — week occupancy at a glance: a Lun–Dom mini bar
//  chart of session counts, today highlighted in teal. Counts only —
//  no patient identity, so it's safe at full glanceability.

import SwiftUI
import WidgetKit

struct SemanaWidgetView: View {
    let entry: SemanaEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                SemanaChartView(snapshot: snapshot)
            } else {
                NotConfiguredView()
            }
        }
        .containerBackground(for: .widget) { CardiganTheme.background }
        .widgetURL(CardiganTheme.agendaURL)
    }
}

struct SemanaChartView: View {
    let snapshot: WidgetSnapshot

    private let barMaxHeight: CGFloat = 42

    var body: some View {
        let total = snapshot.week.reduce(0) { $0 + $1.count }
        let peak = max(1, snapshot.week.map(\.count).max() ?? 1)

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Esta semana")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(CardiganTheme.text)
                Text(total == 1 ? "· 1 sesión" : "· \(total) sesiones")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(CardiganTheme.textSecondary)
                Spacer()
                StaleCaption(snapshot: snapshot)
            }
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(snapshot.week, id: \.d) { day in
                    VStack(spacing: 3) {
                        Text(day.count > 0 ? "\(day.count)" : " ")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(day.isToday ? CardiganTheme.tealDark : CardiganTheme.textSecondary)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(day.isToday ? CardiganTheme.teal : CardiganTheme.teal.opacity(0.28))
                            .frame(height: max(4, barMaxHeight * CGFloat(day.count) / CGFloat(peak)))
                        Text(day.d)
                            .font(.system(size: 9, weight: day.isToday ? .bold : .semibold))
                            .foregroundStyle(day.isToday ? CardiganTheme.tealDark : CardiganTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
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
