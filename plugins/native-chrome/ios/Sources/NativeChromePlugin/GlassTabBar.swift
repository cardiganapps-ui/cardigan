import SwiftUI
import UIKit

/* ── Native Liquid Glass tab bar ──
   The REAL Apple material (iOS 26 `glassEffect`), rendered by SwiftUI
   over the WKWebView. The web app cannot produce this — WebKit doesn't
   support SVG displacement filters in backdrop-filter, so the webview
   pill is CSS-approximated glass; this view replaces it on iOS 26+
   with the system material (refraction, specular response, dynamic
   light/dark adaptation all come from the OS).

   Geometry mirrors the web pill: full-width minus 14pt side margins,
   floating 8pt above the safe area. Heights are in POINTS — the web
   side compensates for its `zoom: 0.80` when reserving scroll space
   (see src/lib/nativeChrome.ts). */

struct GlassTab: Identifiable, Equatable {
    let id: String
    let title: String
    let symbol: String
}

enum GlassTabBarMetrics {
    /// Pill height in points (web pill is 66 CSS px ≈ 52.8pt under the
    /// webview's 0.80 zoom; 56pt gives the native bar the same
    /// presence with the system material's padding rhythm).
    static let height: CGFloat = 56
    /// Gap between the pill and the safe-area top edge, in points.
    static let bottomOffset: CGFloat = 8
}

final class GlassTabModel: ObservableObject {
    @Published var tabs: [GlassTab] = []
    @Published var activeIndex: Int = 0
    @Published var visible: Bool = true
    var onSelect: ((Int, String) -> Void)?
}

@available(iOS 26.0, *)
struct GlassTabBar: View {
    @ObservedObject var model: GlassTabModel
    /// Follows the host controller's overrideUserInterfaceStyle, which
    /// the plugin syncs to the APP theme (Cardigan has an in-app theme
    /// override — the system scheme alone can be wrong).
    @Environment(\.colorScheme) private var colorScheme

    /// Cardigan teal (--teal #5B9BAF). The active tint only colors the
    /// glyph/label — the pill body stays clear system glass so content
    /// refracts through it, matching the web treatment.
    private let teal = Color(red: 0x5B / 255.0, green: 0x9B / 255.0, blue: 0xAF / 255.0)

    /// Clear glass in dark mode renders nearly invisible: bright content
    /// ghosts straight through and fights the glyphs (device feedback:
    /// "needs a bit more contrast"). A dark tint dims the backdrop just
    /// enough for the icons to pop while keeping the liquid read; light
    /// mode stays fully clear.
    private var barGlass: Glass {
        colorScheme == .dark
            ? Glass.clear.tint(Color.black.opacity(0.42)).interactive()
            : Glass.clear.interactive()
    }

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 0) {
                ForEach(Array(model.tabs.enumerated()), id: \.element.id) { idx, tab in
                    Button {
                        guard idx != model.activeIndex else { return }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        model.onSelect?(idx, tab.id)
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: tab.symbol)
                                .font(.system(size: 19, weight: .medium))
                            Text(tab.title)
                                .font(.system(size: 10.5, weight: .semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(Rectangle())
                        .foregroundStyle(idx == model.activeIndex ? teal : Color.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(idx == model.activeIndex ? [.isSelected] : [])
                }
            }
            .padding(.horizontal, 6)
            // .clear (not .regular): regular glass carries a strong
            // material backing that renders near-opaque milky white in
            // light mode — the "pure opaque bottom bar" complaint.
            // Clear glass is the Instagram-style variant: content
            // visibly refracts through the pill. Dark mode adds a dark
            // tint for glyph contrast — see barGlass above.
            .glassEffect(barGlass, in: Capsule())
        }
        .padding(.horizontal, 14)
        .opacity(model.visible ? 1 : 0)
        .allowsHitTesting(model.visible)
        .animation(.spring(duration: 0.3), value: model.visible)
        .animation(.spring(duration: 0.35), value: model.activeIndex)
    }
}
