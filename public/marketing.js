/* ── marketing.js — small client behaviours for /<profession>/ pages
   Loaded from an external file (rather than inlined in each HTML
   page) so the strict CSP — `script-src 'self'` — accepts it without
   needing a per-script SHA. CSP only allows inline scripts that
   match a specific hash, so adding any new inline script means
   updating vercel.json's CSP every time; an external file at
   /marketing.js avoids that.

   Two responsibilities, both layered enhancements:

     1. `.js` class on <html>. CSS gates the reveal-on-scroll opacity:0
        initial state on `.js`, so a page where this script never
        loads (content blocker, slow connection, browser bug) renders
        all content visible by default. Set as the first thing this
        script does so the class is on <html> before the first IO
        callback fires.

     2. Sticky-nav scroll state + reveal-on-scroll. Same pattern the
        SPA landing uses — IntersectionObserver toggles a class on
        the nav when the hero leaves the viewport, and stages a
        fade-up on each .mkt-reveal as it scrolls into view. */

(function () {
  // ── 1) Mark JS as ready (sync, before first paint) ────────────
  // Script is loaded from <head> WITHOUT defer/async so this runs
  // before the body paints. The CSS reveal-initial-state is gated
  // on the `.js` class — setting it before paint means above-the-
  // fold elements render at opacity:0 from the start and the IO
  // callback (queued below) flips them to .mkt-in on the next
  // frame. No flash of "visible → hidden → fade-in".
  document.documentElement.classList.add("js");

  // ── 2) Defer DOM-dependent setup until the body parses ────────
  // querySelectorAll() at this point returns nothing — the body
  // hasn't been parsed yet. Wait for DOMContentLoaded to set up
  // the IntersectionObservers.
  function setup() {
    // 2a) Sticky-nav scroll state. When the hero scrolls out of
    //     view, the nav adopts a tighter background + shadow.
    var nav = document.getElementById("mkt-nav");
    var hero = document.getElementById("mkt-hero");
    if (nav && hero && "IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            nav.classList.toggle("mkt-nav--scrolled", !e.isIntersecting);
          });
        },
        { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
      ).observe(hero);
    }

    // 2b) Reveal-on-scroll. Each .mkt-reveal element fades up the
    //     first time it intersects the viewport. Stagger via the
    //     `--i` inline style on each element.
    var reveals = document.querySelectorAll(".mkt-reveal");
    if (!reveals.length) return;
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < reveals.length; i++) reveals[i].classList.add("mkt-in");
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("mkt-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });

    // 2c) Defensive fallback. If the IO callback hasn't fired for
    //     above-the-fold elements within ~1.2s of setup (rare
    //     mobile WebKit quirks, content blockers slowing
    //     IntersectionObserver), force-show every element that's
    //     currently in the viewport. Below-the-fold elements still
    //     animate normally on scroll.
    setTimeout(function () {
      reveals.forEach(function (el) {
        if (el.classList.contains("mkt-in")) return;
        var r = el.getBoundingClientRect();
        var inViewport = r.top < window.innerHeight && r.bottom > 0;
        if (inViewport) el.classList.add("mkt-in");
      });
    }, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
