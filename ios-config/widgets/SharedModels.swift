//  SharedModels.swift
//  CardiganWidgets — Codable mirror of the snapshot contract produced
//  by src/utils/widgetSnapshot.ts (v1) plus the App Group store both
//  the app (via CardiganBridgeViewController) and this extension read.
//
//  The decoder is strict about the version field: an unknown `v` is
//  treated as no-snapshot so a future breaking change renders the
//  "open the app" state instead of garbage.

import Foundation

// MARK: - Snapshot contract (v1)

struct WidgetSnapshot: Codable {
    static let supportedVersion = 1

    let v: Int
    let generatedAt: String
    let tz: String?
    let todayLabel: String
    let sessionsToday: [SessionEntry]
    let nextSession: NextSessionEntry?
    let kpis: KPIs
    let week: [WeekDay]
}

struct SessionEntry: Codable, Identifiable {
    let id: String
    let time: String
    let patientName: String
    let initials: String
    let modality: String
    let status: String
    let isGroup: Bool?
}

struct NextSessionEntry: Codable {
    let id: String
    let time: String
    let patientName: String
    let initials: String
    let modality: String
    let status: String
    let isGroup: Bool?
    let dayLabel: String
}

struct KPIs: Codable {
    let sessionsToday: Int
    let activePatients: Int
    let collectedMonth: Double
    let pendingTotal: Double
    let owingPatients: Int
    let monthLabel: String
    let currency: String
}

struct WeekDay: Codable {
    let d: String
    let count: Int
    let isToday: Bool
}

enum SessionStatus {
    static let scheduled = "scheduled"
    static let completed = "completed"
    static let cancelled = "cancelled"
    static let charged = "charged"
}

// MARK: - App Group store

enum AppGroupStore {
    // Must match CardiganBridgeViewController.swift and both entitlements files.
    static let suiteName = "group.mx.cardigan.app"
    static let snapshotKey = "widget.snapshot.v1"
    static let tokenKey = "widget.token"
    // Diagnostics: the widget process stamps these on every timeline
    // build; the app reads them back via WidgetBridge.debugState() to
    // prove the App Group container is actually shared between the two
    // processes (and to see what state the widget last rendered in).
    static let widgetRunKey = "widget.diag.lastRun"
    static let widgetStateKey = "widget.diag.lastState"

    static var defaults: UserDefaults? { UserDefaults(suiteName: suiteName) }

    /// Called from every provider's getTimeline so the app can confirm
    /// the widget process reached the shared container.
    static func recordWidgetRun(state: String) {
        defaults?.set(ISO8601DateFormatter().string(from: Date()), forKey: widgetRunKey)
        defaults?.set(state, forKey: widgetStateKey)
    }

    static func loadSnapshot() -> WidgetSnapshot? {
        guard let raw = defaults?.string(forKey: snapshotKey),
              let data = raw.data(using: .utf8),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snap.v == WidgetSnapshot.supportedVersion
        else { return nil }
        return snap
    }

    static func saveSnapshot(data: Data) {
        guard let raw = String(data: data, encoding: .utf8) else { return }
        defaults?.set(raw, forKey: snapshotKey)
    }

    static func token() -> String? {
        guard let token = defaults?.string(forKey: tokenKey), !token.isEmpty else { return nil }
        return token
    }

    /// Called when /api/widget-data answers 401/404 — the token was
    /// revoked or rotated elsewhere. Clearing it flips the widgets to
    /// the "open the app" state AND makes the app's next lazy-mint
    /// check re-provision on the next open.
    static func clearToken() {
        defaults?.removeObject(forKey: tokenKey)
    }
}

// MARK: - Render-time helpers

extension WidgetSnapshot {
    /// Parses "HH:MM" → minutes since midnight.
    static func minutes(of time: String) -> Int? {
        let parts = time.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    private static func minutesNow(at date: Date) -> Int {
        let comps = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (comps.hour ?? 0) * 60 + (comps.minute ?? 0)
    }

    /// True when `date` is the same calendar day (in the snapshot's tz)
    /// as `generatedAt`. The minute-of-day math below is only meaningful
    /// within the generated day — after midnight a stale cached snapshot
    /// would otherwise render YESTERDAY's evening sessions as today's
    /// "upcoming" (20:00 + 60 > 06:00). (bug-hunt: no calendar-day guard)
    func rendersOnGeneratedDay(at date: Date) -> Bool {
        guard let gen = generatedAtDate else { return true }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz ?? "America/Mexico_City") ?? .current
        return cal.isDate(date, inSameDayAs: gen)
    }

    /// Today's sessions that haven't finished yet (same +60 min grace
    /// as the builder). Computed against the ENTRY date so a timeline
    /// entry rendered later in the day stays accurate without a new
    /// snapshot. Returns empty once the render date rolls past the
    /// snapshot's day, so a not-yet-refreshed widget doesn't show
    /// yesterday's agenda.
    func upcomingToday(at date: Date) -> [SessionEntry] {
        guard rendersOnGeneratedDay(at: date) else { return [] }
        let now = Self.minutesNow(at: date)
        return sessionsToday.filter { entry in
            guard entry.status == SessionStatus.scheduled,
                  let mins = Self.minutes(of: entry.time) else { return false }
            return mins + 60 > now
        }
    }

    /// The "next session" to feature: the earliest still-upcoming slot
    /// today, else the snapshot's cross-day nextSession (when it points
    /// beyond today).
    func featuredNext(at date: Date) -> (entry: SessionEntry, dayLabel: String)? {
        if let today = upcomingToday(at: date).first {
            return (today, "Hoy")
        }
        if let next = nextSession, next.dayLabel != "Hoy" {
            let entry = SessionEntry(
                id: next.id, time: next.time, patientName: next.patientName,
                initials: next.initials, modality: next.modality,
                status: next.status, isGroup: next.isGroup
            )
            return (entry, next.dayLabel)
        }
        return nil
    }

    /// Today's rows that occupy the agenda (cancel-family rows render
    /// muted but still count for the "N sesiones" header, matching the
    /// in-app list).
    var todayActiveCount: Int {
        sessionsToday.filter { $0.status != SessionStatus.cancelled && $0.status != SessionStatus.charged }.count
    }

    /// Done vs total for the lock-screen gauge (cancelled excluded).
    /// Zeroed once the snapshot is a day stale so the gauge doesn't show
    /// yesterday's completion as today's.
    func todayProgress(at date: Date) -> (done: Int, total: Int) {
        guard rendersOnGeneratedDay(at: date) else { return (0, 0) }
        let total = todayActiveCount
        let remaining = upcomingToday(at: date).count
        return (max(0, total - remaining), total)
    }

    var generatedAtDate: Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: generatedAt) { return d }
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: generatedAt)
    }

    /// > 36 h old — render with a staleness caption.
    var isStale: Bool {
        guard let d = generatedAtDate else { return false }
        return Date().timeIntervalSince(d) > 36 * 3600
    }
}

// MARK: - Gallery / placeholder demo data

extension WidgetSnapshot {
    static let demo = WidgetSnapshot(
        v: 1,
        generatedAt: "2026-07-01T15:00:00.000Z",
        tz: "America/Mexico_City",
        todayLabel: "Miércoles 2-Jul",
        sessionsToday: [
            SessionEntry(id: "d1", time: "10:00", patientName: "Ana López", initials: "AL", modality: "presencial", status: SessionStatus.completed, isGroup: nil),
            SessionEntry(id: "d2", time: "13:00", patientName: "Luis Mendoza", initials: "LM", modality: "virtual", status: SessionStatus.scheduled, isGroup: nil),
            SessionEntry(id: "d3", time: "16:00", patientName: "Sofía Rivas", initials: "SR", modality: "presencial", status: SessionStatus.scheduled, isGroup: nil),
            SessionEntry(id: "d4", time: "18:00", patientName: "Carlos Peña", initials: "CP", modality: "virtual", status: SessionStatus.scheduled, isGroup: nil),
        ],
        nextSession: NextSessionEntry(id: "d2", time: "13:00", patientName: "Luis Mendoza", initials: "LM", modality: "virtual", status: SessionStatus.scheduled, isGroup: nil, dayLabel: "Hoy"),
        kpis: KPIs(sessionsToday: 4, activePatients: 18, collectedMonth: 12400, pendingTotal: 2100, owingPatients: 3, monthLabel: "Julio", currency: "MXN"),
        week: [
            WeekDay(d: "Lun", count: 3, isToday: false),
            WeekDay(d: "Mar", count: 4, isToday: false),
            WeekDay(d: "Mié", count: 4, isToday: true),
            WeekDay(d: "Jue", count: 5, isToday: false),
            WeekDay(d: "Vie", count: 2, isToday: false),
            WeekDay(d: "Sáb", count: 1, isToday: false),
            WeekDay(d: "Dom", count: 0, isToday: false),
        ]
    )
}
