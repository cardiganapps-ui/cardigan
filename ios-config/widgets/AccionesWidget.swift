//  AccionesWidget.swift
//  CardiganWidgets — quick actions. Deep links reuse the same
//  ?fab= / ?screen= URLs as the Home Screen quick actions injected by
//  apply-ios-config.sh (handled by nativeDeepLinks.ts → useLaunchParams).
//  systemSmall supports a single tap target (widgetURL); systemMedium
//  gets three per-button Links.

import SwiftUI
import WidgetKit

private struct ActionTile: View {
    let symbol: String
    let label: String
    let tint: Color
    var diameter: CGFloat = 44
    var glyphSize: CGFloat = 18

    var body: some View {
        VStack(spacing: 7) {
            ZStack {
                Circle().fill(tint.opacity(CardiganMetrics.tintFill))
                Image(systemName: symbol)
                    .font(.system(size: glyphSize, weight: .regular))
                    .foregroundStyle(tint)
            }
            .frame(width: diameter, height: diameter)
            Text(label)
                .font(CFont.bodyBold(11))
                .foregroundStyle(CardiganTheme.charcoal)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }
}

struct AccionesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AccionesEntry

    var body: some View {
        Group {
            if family == .systemMedium {
                AccionesMediumView()
            } else {
                AccionesSmallView()
            }
        }
        .cardiganContainer(family)
    }
}

struct AccionesSmallView: View {
    var body: some View {
        ActionTile(
            symbol: "calendar.badge.plus", label: "Nueva sesión",
            tint: CardiganTheme.tealDark, diameter: 54, glyphSize: 24
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(CardiganTheme.newSessionURL)
    }
}

struct AccionesMediumView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Acciones rápidas")
                .font(CFont.num(15))
                .foregroundStyle(CardiganTheme.charcoal)
            HStack(spacing: 8) {
                Link(destination: CardiganTheme.newSessionURL) {
                    ActionTile(symbol: "calendar.badge.plus", label: "Nueva sesión", tint: CardiganTheme.tealDark)
                }
                Link(destination: CardiganTheme.newPaymentURL) {
                    ActionTile(symbol: "dollarsign.circle", label: "Cobrar", tint: CardiganTheme.green)
                }
                Link(destination: CardiganTheme.agendaURL) {
                    ActionTile(symbol: "list.bullet.rectangle", label: "Agenda", tint: CardiganTheme.blue)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct AccionesWidget: Widget {
    let kind = "CardiganAcciones"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AccionesProvider()) { entry in
            AccionesWidgetView(entry: entry)
        }
        .configurationDisplayName("Acciones rápidas")
        .description("Crea una sesión o registra un pago con un toque.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview("Acciones", as: .systemMedium) {
    AccionesWidget()
} timeline: {
    AccionesEntry(date: Date())
}
