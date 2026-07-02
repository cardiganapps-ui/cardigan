//  Providers.swift
//  CardiganWidgets — timeline providers. Shared flow:
//    1. SnapshotFetcher.load(): fresh App Group cache → network →
//       stale cache (never throws, never blocks past ~5 s).
//    2. One entry per remaining session boundary today (each slot's
//       +60 min end), so "next session" flips on time without a new
//       snapshot; plus a base entry at `now`.
//    3. Policy .after(+30 min) — WidgetKit's refresh budget (~40-70/day)
//       comfortably covers it, and every app open also reloads all
//       timelines via the bridge write.
//
//  A nil snapshot renders the "Abre Cardigan para configurar" state
//  (fresh install, logged out, or version-mismatch).

import WidgetKit

// MARK: - Entries

struct AgendaEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let display: PatientDisplayOption
}

struct FinanzasEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let showAmounts: Bool
}

struct SemanaEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct AccionesEntry: TimelineEntry {
    let date: Date
}

// MARK: - Shared timeline math

/// Entry dates: now + each future session-end boundary today (capped),
/// so views re-derive "next session" exactly when a slot passes.
func sessionBoundaryDates(for snapshot: WidgetSnapshot?, now: Date) -> [Date] {
    var dates: [Date] = [now]
    guard let snapshot else { return dates }
    let calendar = Calendar.current
    for entry in snapshot.sessionsToday where entry.status == SessionStatus.scheduled {
        guard let mins = WidgetSnapshot.minutes(of: entry.time) else { continue }
        let end = mins + 60
        guard end < 24 * 60 else { continue }
        var comps = calendar.dateComponents([.year, .month, .day], from: now)
        comps.hour = end / 60
        comps.minute = end % 60
        if let date = calendar.date(from: comps), date > now {
            dates.append(date)
        }
    }
    return Array(dates.sorted().prefix(8))
}

private func refreshPolicy(after now: Date) -> TimelineReloadPolicy {
    .after(now.addingTimeInterval(30 * 60))
}

// MARK: - Agenda (AppIntent-configurable)

struct AgendaProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> AgendaEntry {
        AgendaEntry(date: Date(), snapshot: .demo, display: .iniciales)
    }

    func snapshot(for configuration: AgendaConfigIntent, in context: Context) async -> AgendaEntry {
        if context.isPreview {
            return AgendaEntry(date: Date(), snapshot: .demo, display: configuration.estiloPaciente)
        }
        return AgendaEntry(date: Date(), snapshot: AppGroupStore.loadSnapshot(), display: configuration.estiloPaciente)
    }

    func timeline(for configuration: AgendaConfigIntent, in context: Context) async -> Timeline<AgendaEntry> {
        let now = Date()
        let snapshot = await SnapshotFetcher.load()
        let entries = sessionBoundaryDates(for: snapshot, now: now).map {
            AgendaEntry(date: $0, snapshot: snapshot, display: configuration.estiloPaciente)
        }
        return Timeline(entries: entries, policy: refreshPolicy(after: now))
    }
}

// MARK: - Finanzas (AppIntent-configurable)

struct FinanzasProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> FinanzasEntry {
        FinanzasEntry(date: Date(), snapshot: .demo, showAmounts: true)
    }

    func snapshot(for configuration: FinanzasConfigIntent, in context: Context) async -> FinanzasEntry {
        if context.isPreview {
            return FinanzasEntry(date: Date(), snapshot: .demo, showAmounts: configuration.mostrarMontos)
        }
        return FinanzasEntry(date: Date(), snapshot: AppGroupStore.loadSnapshot(), showAmounts: configuration.mostrarMontos)
    }

    func timeline(for configuration: FinanzasConfigIntent, in context: Context) async -> Timeline<FinanzasEntry> {
        let now = Date()
        let snapshot = await SnapshotFetcher.load()
        let entry = FinanzasEntry(date: now, snapshot: snapshot, showAmounts: configuration.mostrarMontos)
        return Timeline(entries: [entry], policy: refreshPolicy(after: now))
    }
}

// MARK: - Semana (static)

struct SemanaProvider: TimelineProvider {
    func placeholder(in context: Context) -> SemanaEntry {
        SemanaEntry(date: Date(), snapshot: .demo)
    }

    func getSnapshot(in context: Context, completion: @escaping (SemanaEntry) -> Void) {
        if context.isPreview {
            completion(SemanaEntry(date: Date(), snapshot: .demo))
            return
        }
        completion(SemanaEntry(date: Date(), snapshot: AppGroupStore.loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SemanaEntry>) -> Void) {
        Task {
            let now = Date()
            let snapshot = await SnapshotFetcher.load()
            let entry = SemanaEntry(date: now, snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(60 * 60))))
        }
    }
}

// MARK: - Acciones rápidas (static, no data)

struct AccionesProvider: TimelineProvider {
    func placeholder(in context: Context) -> AccionesEntry {
        AccionesEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (AccionesEntry) -> Void) {
        completion(AccionesEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AccionesEntry>) -> Void) {
        completion(Timeline(entries: [AccionesEntry(date: Date())], policy: .never))
    }
}
