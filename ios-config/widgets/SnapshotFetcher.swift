//  SnapshotFetcher.swift
//  CardiganWidgets — best-effort network refresh of the snapshot from
//  /api/widget-data, so widgets stay current on days the app isn't
//  opened. The App Group cache remains the fallback for every failure
//  mode; only an explicit 401/404 (token revoked / rotated elsewhere)
//  mutates state, by clearing the stored token.

import Foundation

enum SnapshotFetcher {
    private static let endpoint = URL(string: "https://cardigan.mx/api/widget-data")!

    /// Skip the network when the cached snapshot is this fresh — the
    /// app just wrote it (reloadAllTimelines follows every bridge
    /// write) and re-fetching would burn the endpoint's rate budget
    /// (4 widget kinds × every app open).
    private static let freshEnough: TimeInterval = 10 * 60

    /// Returns the freshest snapshot available: recent cache → network
    /// → stale cache. Never throws.
    static func load() async -> WidgetSnapshot? {
        let cached = AppGroupStore.loadSnapshot()
        let hasToken = AppGroupStore.token() != nil
        // Diagnostic heartbeat: proves the widget PROCESS reached the
        // shared App Group container (the app reads this back).
        AppGroupStore.recordWidgetRun(
            state: "cache=\(cached != nil) token=\(hasToken)")
        if let cached, let age = cached.generatedAtDate.map({ Date().timeIntervalSince($0) }),
           age >= 0, age < freshEnough {
            return cached
        }
        if let fresh = await refresh() {
            return fresh
        }
        return cached
    }

    private static func refresh() async -> WidgetSnapshot? {
        guard let token = AppGroupStore.token() else { return nil }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }
            if http.statusCode == 401 || http.statusCode == 404 {
                AppGroupStore.clearToken()
                return nil
            }
            guard http.statusCode == 200 else { return nil }
            guard let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
                  snap.v == WidgetSnapshot.supportedVersion else { return nil }
            AppGroupStore.saveSnapshot(data: data)
            return snap
        } catch {
            return nil
        }
    }
}
