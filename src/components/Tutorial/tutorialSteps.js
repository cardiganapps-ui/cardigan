// Step definitions for the onboarding tour.
// Each step either targets an element via a CSS selector, or is a centered
// "card" step (no selector) shown in the middle of the screen.
//
// Flow (10 steps, ~60–90 s total):
//   1. welcome           — friendly intro
//   2. kpis              — Home, day-at-a-glance KPIs
//   3. fab               — Home, primary "create" shortcut
//   4. drawer            — Home, hamburger discovery
//   5. finances          — Finances tab strip (Pagos / Gastos / Resumen / Proy.)
//   6. gastos-detail     — feature card: expense tracking, OCR, recurrentes
//   7. resumen-detail    — feature card: P&L + CSV export
//   8. cardi             — drawer + nav-cardi spotlight, AI helper
//   9. portal-detail     — feature card: patient portal sharing + reschedule
//   10. done             — wrap, optional iOS install hint
//
// Steps with `openDrawer: true` cause the Tutorial orchestrator to
// programmatically open the side drawer before spotlighting the target.
// The drawer item is highlighted inside the open drawer panel so the user
// sees exactly which button takes them to each screen.
//
// Shape:
//   id           — stable identifier
//   screen       — which screen must be active; the orchestrator navigates there before showing
//   selector     — CSS selector for the spotlight target (null for centered steps)
//   placement    — preferred tooltip placement: "top" | "bottom" | "center"
//   titleKey     — i18n key for the step title
//   bodyKey      — i18n key for the step body
//   icon         — optional icon name rendered as a hero badge above the
//                  title on centered "feature" cards. Maps to a name the
//                  TutorialTooltip resolves into a real <Icon> component.
//   padding      — extra pixels around the target rect for the spotlight cutout
//   openDrawer   — if true, the orchestrator opens the drawer before this step

export const TUTORIAL_STEPS = [
  {
    id: "welcome",
    screen: "home",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.welcomeTitle",
    bodyKey: "tutorial.steps.welcomeBody",
    // No hero icon here — the welcome modal already showed the logo
    // badge two seconds ago, so a second logo on step 1 reads as a
    // stutter. Keep it text-only and let the dot-progress signal that
    // we're on step 1 of N.
    padding: 0,
  },
  {
    id: "kpis",
    screen: "home",
    selector: '[data-tour="kpis"]',
    placement: "bottom",
    titleKey: "tutorial.steps.kpisTitle",
    bodyKey: "tutorial.steps.kpisBody",
    padding: 8,
  },
  {
    id: "fab",
    screen: "home",
    selector: '[data-tour="fab"]',
    placement: "top",
    titleKey: "tutorial.steps.fabTitle",
    bodyKey: "tutorial.steps.fabBody",
    padding: 10,
  },
  {
    id: "drawer",
    screen: "home",
    selector: '[data-tour="hamburger"]',
    placement: "bottom",
    titleKey: "tutorial.steps.drawerTitle",
    bodyKey: "tutorial.steps.drawerBody",
    padding: 6,
  },
  // ── Finances → Gastos / Resumen ──
  // Skip the "highlight the drawer item" stop for Finances and jump
  // straight to the Finances tab strip — the body copy below tells the
  // user "abrimos Finanzas para enseñarte algo" so the navigation
  // doesn't feel arbitrary. Saves two steps vs. the old per-screen
  // pattern without losing the screen-level orientation.
  {
    id: "finances",
    screen: "finances",
    selector: '[data-tour="finances-tabs"]',
    placement: "bottom",
    titleKey: "tutorial.steps.financesTitle",
    bodyKey: "tutorial.steps.financesBody",
    padding: 8,
  },
  {
    id: "gastos-detail",
    screen: "finances",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.gastosTitle",
    bodyKey: "tutorial.steps.gastosBody",
    icon: "trendingDown",
    padding: 0,
  },
  {
    id: "resumen-detail",
    screen: "finances",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.resumenTitle",
    bodyKey: "tutorial.steps.resumenBody",
    icon: "barChart",
    padding: 0,
  },
  // ── Cardi (AI helper) ──
  // Drawer step with a brief explanation. We don't navigate to the
  // Cardi screen — opening the sheet would conflict with tutorial
  // overlay z-index and burn the moment.
  {
    id: "cardi",
    screen: "home",
    openDrawer: true,
    selector: '[data-tour="nav-cardi"]',
    placement: "bottom",
    titleKey: "tutorial.steps.cardiTitle",
    bodyKey: "tutorial.steps.cardiBody",
    padding: 4,
  },
  {
    id: "portal-detail",
    screen: "home",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.portalTitle",
    bodyKey: "tutorial.steps.portalBody",
    icon: "link",
    padding: 0,
  },
  {
    id: "done",
    screen: "home",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.doneTitle",
    bodyKey: "tutorial.steps.doneBody",
    icon: "check",
    showInstall: true,
    padding: 0,
  },
];

// The "fab" step targets the FAB itself, so we must leave it visible for that step.
export const STEP_IDS_REQUIRING_FAB = new Set(["fab"]);

// Steps that open the drawer — the Tutorial must not "pause" for these.
export const STEP_IDS_WITH_DRAWER = new Set(
  TUTORIAL_STEPS.filter(s => s.openDrawer).map(s => s.id)
);
