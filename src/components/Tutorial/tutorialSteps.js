// Step definitions for the onboarding tour.
//
// Design: walk a brand-new user through the *general areas* of the app
// in the order they'd encounter them on day one, then drill into a
// specific sophisticated feature (Gastos) before introducing the
// AI helper. No detail-step gets its own beat unless the surface is
// genuinely new or distinctive — Resumen and patient-portal sharing
// are folded into their parent area's body copy because they're
// adjacent to (not separate from) the surface they belong to.
//
// Flow (10 steps, ~60 s):
//   1. welcome      — "Tu nuevo espacio"
//   2. kpis         — Home: day-at-a-glance KPIs
//   3. fab          — Home: primary "create" shortcut
//   4. drawer       — Home: hamburger discovery + name the areas
//   5. agenda       — Agenda screen orientation
//   6. patients     — Patients screen + brief mention of portal share
//   7. finances     — Finances screen + brief mention of Resumen / CSV
//   8. gastos       — feature card on finances: receipt OCR + recurrentes
//   9. cardi        — drawer + nav-cardi spotlight: AI helper
//   10. done        — wrap, optional iOS install hint
//
// Steps with `openDrawer: true` cause the Tutorial orchestrator to
// programmatically open the side drawer before spotlighting the target.
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
  // ── Walk through the main areas in left-to-right order ──
  // Each step navigates to the area, frames the whole screen with the
  // spotlight, and lands a centered tooltip explaining what lives
  // there. The body copy folds in the standout sub-features (recurring
  // sessions, portal sharing, P&L export) so the user gets the full
  // mental model without an extra step per feature.
  {
    id: "agenda",
    screen: "agenda",
    selector: '[data-tour="agenda-section"]',
    placement: "center",
    titleKey: "tutorial.steps.agendaTitle",
    bodyKey: "tutorial.steps.agendaBody",
    padding: 0,
  },
  {
    id: "patients",
    screen: "patients",
    selector: '[data-tour="patients-list"]',
    placement: "center",
    titleKey: "tutorial.steps.patientsTitle",
    bodyKey: "tutorial.steps.patientsBody",
    padding: 0,
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
  // ── Specific feature drill-down: Gastos ──
  // The only "drill into a detail" step in the tour, justified by it
  // being the headline post-launch addition AND because the receipt-OCR
  // / recurring-template behaviour wouldn't be discoverable from the
  // tab label alone.
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
  // ── Cardi (AI helper) ──
  // Drawer step rather than a screen visit — opening the Cardi sheet
  // mid-tour would conflict with the tutorial overlay's z-index and
  // burn the moment. Spotlighting the menu item is enough to plant
  // "this is where I find Cardi later".
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
