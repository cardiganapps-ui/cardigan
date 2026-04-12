// Step definitions for the onboarding tour.
// Each step either targets an element via a CSS selector, or is a centered
// "card" step (no selector) shown in the middle of the screen.
//
// Flow: home orientation first (kpis + fab), then the menu/hamburger so the
// user knows HOW to navigate, THEN the screen-specific stops (agenda,
// patients, finances). The orchestrator auto-navigates between screens while
// showing a "screen change" chip and pulsing the hamburger, so the user sees
// where the navigation comes from instead of being teleported silently.
//
// Shape:
//   id           — stable identifier
//   screen       — which screen must be active; the orchestrator navigates there before showing
//   selector     — CSS selector for the spotlight target (null for centered steps)
//   placement    — preferred tooltip placement: "top" | "bottom" | "center"
//   titleKey     — i18n key for the step title
//   bodyKey      — i18n key for the step body
//   padding      — extra pixels around the target rect for the spotlight cutout

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
  {
    id: "agenda",
    screen: "agenda",
    selector: '[data-tour="agenda-toggle"]',
    placement: "bottom",
    titleKey: "tutorial.steps.agendaTitle",
    bodyKey: "tutorial.steps.agendaBody",
    padding: 8,
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
    padding: 0,
  },
];

// The "fab" step targets the FAB itself, so we must leave it visible for that step.
export const STEP_IDS_REQUIRING_FAB = new Set(["fab"]);
