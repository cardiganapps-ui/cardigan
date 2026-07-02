package mx.cardigan.app;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Uniform edge-to-edge across the whole minSdk range. Android 15+
        // (targetSdk 36) enforces this anyway; enabling it explicitly on
        // API 24–34 gives every device the same model: transparent system
        // bars, WebView drawing behind them, and Capacitor 8's built-in
        // SystemBars plugin feeding the real inset values to the web layer
        // as --safe-area-inset-* CSS vars (consumed by --sat/--sab/--sal/
        // --sar in base.css) and padding the WebView by the keyboard
        // height when the IME opens. Must run before super.onCreate() so
        // the window flags are set before Capacitor inflates the WebView.
        //
        // Known tail risk: WebViews older than Chromium 140 don't get the
        // CSS-var passthrough on pre-15 devices (SystemBars only pads the
        // view on 15+), so a badly outdated WebView could draw the topbar
        // under the status bar. WebView auto-updates via Play, so this is
        // a vanishingly small population — and no worse than the previous
        // behavior (StatusBar.setOverlaysWebView with env() insets that
        // always resolved to 0 on Android).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
