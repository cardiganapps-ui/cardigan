// Step definitions for the onboarding tour.
// Each step either targets an element via a CSS selector, or is a centered
// "card" step (no selector) shown in the middle of the screen.
//
// Flow: home orientation first (kpis + fab), then the hamburger so the user
// knows HOW to navigate, then for each screen we first open the drawer and
// spotlight the nav item (so the user learns WHERE each screen lives), then
// navigate to that screen and highlight a key feature.
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
  // ── Drawer → Agenda ──
  {
    id: "nav-agenda",
    screen: "home",
    openDrawer: true,
    selector: '[data-tour="nav-agenda"]',
    placement: "bottom",
    titleKey: "tutorial.steps.navAgendaTitle",
    bodyKey: "tutorial.steps.navAgendaBody",
    padding: 4,
  },
  {
    id: "agenda",
    screen: "agenda",
    selector: '[data-tour="agenda-toggle"]',
    placement: "bottom",
    titleKey: "tutorial.steps.agendaTitle",
    bodyKey: "tutorial.steps.agendaBody",
    padding: 8,
  },
  // ── Drawer → Patients ──
  {
    id: "nav-patients",
    screen: "agenda",
    openDrawer: true,
    selector: '[data-tour="nav-patients"]',
    placement: "bottom",
    titleKey: "tutorial.steps.navPatientsTitle",
    bodyKey: "tutorial.steps.navPatientsBody",
    padding: 4,
  },
  {
    id: "patients",
    screen: "patients",
    selector: '[data-tour="patients-list"]',
    placement: "bottom",
    titleKey: "tutorial.steps.patientsTitle",
    bodyKey: "tutorial.steps.patientsBody",
    padding: 6,
  },
  // ── Drawer → Finances ──
  {
    id: "nav-finances",
    screen: "patients",
    openDrawer: true,
    selector: '[data-tour="nav-finances"]',
    placement: "bottom",
    titleKey: "tutorial.steps.navFinancesTitle",
    bodyKey: "tutorial.steps.navFinancesBody",
    padding: 4,
  },
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
    id: "done",
    screen: "home",
    selector: null,
    placement: "center",
    titleKey: "tutorial.steps.doneTitle",
    bodyKey: "tutorial.steps.doneBody",
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
