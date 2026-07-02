//  ConfigIntents.swift
//  CardiganWidgets — per-widget configuration (long-press → "Editar
//  widget"). Privacy-first defaults: patient identity renders as
//  initials unless the therapist opts into full names; amounts can be
//  hidden on the Finanzas widget.

import AppIntents

enum PatientDisplayOption: String, AppEnum {
    case iniciales
    case nombreCompleto
    case anonimo

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Privacidad"
    static var caseDisplayRepresentations: [PatientDisplayOption: DisplayRepresentation] = [
        .iniciales: "Solo iniciales",
        .nombreCompleto: "Nombre completo",
        .anonimo: "Sin nombre",
    ]

    func displayName(for entry: SessionEntry) -> String {
        switch self {
        case .iniciales:
            return entry.initials.isEmpty ? "Sesión" : entry.initials
        case .nombreCompleto:
            return entry.patientName.isEmpty ? "Sesión" : entry.patientName
        case .anonimo:
            return entry.isGroup == true ? "Grupo" : "Sesión"
        }
    }
}

struct AgendaConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Agenda"
    static var description = IntentDescription("Elige cómo se muestran tus citas.")

    @Parameter(title: "Mostrar", default: .iniciales)
    var estiloPaciente: PatientDisplayOption
}

struct FinanzasConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Finanzas"
    static var description = IntentDescription("Controla la visibilidad de tus montos.")

    @Parameter(title: "Mostrar montos", default: true)
    var mostrarMontos: Bool
}
