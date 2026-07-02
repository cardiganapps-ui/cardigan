//  FinanzasWidget.swift
//  CardiganWidgets — the Home-screen KPI grid as a widget: cobrado del
//  mes, por cobrar, sesiones de hoy. Amounts follow the "mostrar
//  montos" AppIntent toggle ("•••" when hidden — shoulder-surfing
//  guard) and are privacySensitive either way.

import SwiftUI
import WidgetKit

private func amountText(_ amount: Double, visible: Bool) -> String {
    visible ? formatMXN(amount) : "•••"
}

struct FinanzasWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FinanzasEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                if family == .systemMedium {
                    FinanzasMediumView(snapshot: snapshot, entry: entry)
                } else {
                    FinanzasSmallView(snapshot: snapshot, entry: entry)
                }
            } else {
                NotConfiguredView()
            }
        }
        .containerBackground(for: .widget) { CardiganTheme.background }
        .widgetURL(CardiganTheme.financesURL)
    }
}

struct FinanzasSmallView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("COBRADO · \(snapshot.kpis.monthLabel.uppercased())")
                .font(.system(size: 10, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(CardiganTheme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(amountText(snapshot.kpis.collectedMonth, visible: entry.showAmounts))
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(CardiganTheme.green)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 2)
            HStack(spacing: 4) {
                Text("Por cobrar")
                    .font(.system(size: 11))
                    .foregroundStyle(CardiganTheme.textSecondary)
                Text(amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts))
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(snapshot.kpis.pendingTotal > 0 ? CardiganTheme.red : CardiganTheme.textSecondary)
                    .privacySensitive()
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            let count = snapshot.kpis.sessionsToday
            Text(count == 1 ? "1 sesión hoy" : "\(count) sesiones hoy")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(CardiganTheme.tealDark)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(CardiganTheme.teal.opacity(0.14)))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct KPIColumn: View {
    let label: String
    let value: String
    let tint: Color
    let sub: String?
    var sensitive = true

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(CardiganTheme.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Group {
                if sensitive {
                    Text(value).privacySensitive()
                } else {
                    Text(value)
                }
            }
            .font(.system(size: 19, weight: .heavy, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(tint)
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            if let sub {
                Text(sub)
                    .font(.system(size: 10))
                    .foregroundStyle(CardiganTheme.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct FinanzasMediumView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text("Finanzas")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(CardiganTheme.text)
                Text("· \(snapshot.kpis.monthLabel)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(CardiganTheme.textSecondary)
                Spacer()
                StaleCaption(snapshot: snapshot)
            }
            HStack(alignment: .top, spacing: 12) {
                KPIColumn(
                    label: "Cobrado (mes)",
                    value: amountText(snapshot.kpis.collectedMonth, visible: entry.showAmounts),
                    tint: CardiganTheme.green,
                    sub: nil
                )
                KPIColumn(
                    label: "Por cobrar",
                    value: amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts),
                    tint: snapshot.kpis.pendingTotal > 0 ? CardiganTheme.red : CardiganTheme.textSecondary,
                    sub: snapshot.kpis.owingPatients > 0
                        ? (snapshot.kpis.owingPatients == 1 ? "1 pendiente" : "\(snapshot.kpis.owingPatients) pendientes")
                        : "Al corriente"
                )
                KPIColumn(
                    label: "Hoy",
                    value: "\(snapshot.kpis.sessionsToday)",
                    tint: CardiganTheme.tealDark,
                    sub: snapshot.kpis.sessionsToday == 1 ? "sesión" : "sesiones",
                    sensitive: false
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct FinanzasWidget: Widget {
    let kind = "CardiganFinanzas"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: FinanzasConfigIntent.self, provider: FinanzasProvider()) { entry in
            FinanzasWidgetView(entry: entry)
        }
        .configurationDisplayName("Finanzas")
        .description("Cobrado del mes, por cobrar y sesiones de hoy.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
