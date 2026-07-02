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

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(tint.opacity(0.14))
                    .frame(width: 44, height: 44)
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tint)
            }
            Text(label)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(CardiganTheme.text)
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
        .containerBackground(for: .widget) { CardiganTheme.background }
    }
}

struct AccionesSmallView: View {
    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(CardiganTheme.teal.opacity(0.14))
                    .frame(width: 52, height: 52)
                Image(systemName: "calendar.badge.plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(CardiganTheme.tealDark)
            }
            Text("Nueva sesión")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(CardiganTheme.text)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(CardiganTheme.newSessionURL)
    }
}

struct AccionesMediumView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Acciones rápidas")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundStyle(CardiganTheme.text)
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
