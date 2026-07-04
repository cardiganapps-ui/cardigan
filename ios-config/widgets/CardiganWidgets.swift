//  CardiganWidgets.swift
//  CardiganWidgets — bundle entry point. Sources live in
//  ios-config/widgets/ and are copied into ios/App/CardiganWidgets/
//  by scripts/apply-ios-config.sh; the extension target is created by
//  scripts/add-widget-target.rb on every CI build (the ios/ project is
//  never committed).

import SwiftUI
import WidgetKit

@main
struct CardiganWidgetBundle: WidgetBundle {
    var body: some Widget {
        AgendaWidget()
        ProximaWidget()
        FinanzasWidget()
        SemanaWidget()
        AccionesWidget()
    }
}
