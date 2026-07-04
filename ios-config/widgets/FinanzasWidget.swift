//  FinanzasWidget.swift
//  CardiganWidgets — the Home-screen KPI grid as a widget: cobrado del
//  mes, por cobrar, sesiones de hoy, plus a Lock-screen "por cobrar"
//  glance. Amounts follow the "mostrar montos" AppIntent toggle ("•••"
//  when hidden) and are privacySensitive so a locked device redacts them.

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
                switch family {
                case .accessoryInline: FinanzasInlineView(snapshot: snapshot, entry: entry)
                case .accessoryRectangular: FinanzasRectangularView(snapshot: snapshot, entry: entry)
                case .systemMedium: FinanzasMediumView(snapshot: snapshot, entry: entry)
                default: FinanzasSmallView(snapshot: snapshot, entry: entry)
                }
            } else {
                NotConfiguredView()
            }
        }
        .cardiganContainer(family)
        .widgetURL(CardiganTheme.financesURL)
    }
}

// ── Home: small (cobrado hero) ──

struct FinanzasSmallView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("COBRADO · \(snapshot.kpis.monthLabel.uppercased())").eyebrow().minimumScaleFactor(0.8)
            Text(amountText(snapshot.kpis.collectedMonth, visible: entry.showAmounts))
                .font(CFont.num(27))
                .tabular()
                .foregroundStyle(CardiganTheme.green)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .privacySensitive()
                .widgetAccentable()
            Spacer(minLength: 2)
            HStack(spacing: 5) {
                Text("Por cobrar")
                    .font(CFont.body(11))
                    .foregroundStyle(CardiganTheme.charcoalMd)
                Text(amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts))
                    .font(CFont.num(13))
                    .tabular()
                    .foregroundStyle(snapshot.kpis.pendingTotal > 0 ? CardiganTheme.red : CardiganTheme.charcoalMd)
                    .privacySensitive()
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            CountPill(text: sessionsPill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var sessionsPill: String {
        let c = snapshot.kpis.sessionsToday
        return c == 1 ? "1 sesión hoy" : "\(c) sesiones hoy"
    }
}

// ── Home: medium (KPI grid) ──

struct FinanzasMediumView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Finanzas", context: snapshot.kpis.monthLabel)
            HStack(alignment: .top, spacing: 12) {
                KPITile(
                    label: "Cobrado (mes)",
                    value: amountText(snapshot.kpis.collectedMonth, visible: entry.showAmounts),
                    valueTint: CardiganTheme.green,
                    accentable: true
                )
                KPITile(
                    label: "Por cobrar",
                    value: amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts),
                    valueTint: snapshot.kpis.pendingTotal > 0 ? CardiganTheme.red : CardiganTheme.charcoalMd,
                    sub: pendientesSub
                )
                KPITile(
                    label: "Hoy",
                    value: "\(snapshot.kpis.sessionsToday)",
                    valueTint: CardiganTheme.tealDark,
                    sub: snapshot.kpis.sessionsToday == 1 ? "sesión" : "sesiones",
                    sensitive: false
                )
            }
            Spacer(minLength: 0)
            StaleCaption(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var pendientesSub: String {
        let n = snapshot.kpis.owingPatients
        if n == 0 { return "Al corriente" }
        return n == 1 ? "1 pendiente" : "\(n) pendientes"
    }
}

// ── Lock screen ──

struct FinanzasRectangularView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("POR COBRAR").font(.system(size: 11, weight: .semibold)).widgetAccentable()
            Text(amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts))
                .font(.system(.headline, design: .rounded))
                .monospacedDigit()
                .privacySensitive()
            Text(pendientesSub).font(.caption2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var pendientesSub: String {
        let n = snapshot.kpis.owingPatients
        if n == 0 { return "Al corriente · Cobrado \(amountText(snapshot.kpis.collectedMonth, visible: entry.showAmounts))" }
        return n == 1 ? "1 paciente pendiente" : "\(n) pacientes pendientes"
    }
}

struct FinanzasInlineView: View {
    let snapshot: WidgetSnapshot
    let entry: FinanzasEntry

    var body: some View {
        Text("Por cobrar \(amountText(snapshot.kpis.pendingTotal, visible: entry.showAmounts))")
            .privacySensitive()
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
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Previews

#Preview("Finanzas medium", as: .systemMedium) {
    FinanzasWidget()
} timeline: {
    FinanzasEntry(date: Date(), snapshot: .demo, showAmounts: true)
}

#Preview("Finanzas small", as: .systemSmall) {
    FinanzasWidget()
} timeline: {
    FinanzasEntry(date: Date(), snapshot: .demo, showAmounts: true)
}
