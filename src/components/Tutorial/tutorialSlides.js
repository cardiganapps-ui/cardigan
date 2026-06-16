// Slide definitions for the onboarding carousel.
//
// This replaced the old spotlight `tutorialSteps.js`. The tour no longer
// points at live UI elements (which was the source of the persistent iOS
// webview coordinate bugs); instead each slide is a self-contained card
// with a styled icon hero + title + body describing one area of the app.
//
// Shape:
//   id       — stable identifier
//   icon     — HeroIcon registry name (see TutorialCarousel HeroIcon)
//   titleKey — i18n key for the slide title
//   bodyKey  — i18n key for the slide body
//
// Copy is reused verbatim from the previous tour's `tutorial.steps.*`
// keys, which already describe each area well.

export const TUTORIAL_SLIDES = [
  { id: "welcome",  icon: "logo",     titleKey: "tutorial.steps.welcomeTitle",  bodyKey: "tutorial.steps.welcomeBody" },
  { id: "agenda",   icon: "calendar", titleKey: "tutorial.steps.agendaTitle",   bodyKey: "tutorial.steps.agendaBody" },
  { id: "patients", icon: "users",    titleKey: "tutorial.steps.patientsTitle", bodyKey: "tutorial.steps.patientsBody" },
  { id: "invite",   icon: "link",     titleKey: "tutorial.steps.inviteTitle",   bodyKey: "tutorial.steps.inviteBody" },
  { id: "finances", icon: "barChart", titleKey: "tutorial.steps.financesTitle", bodyKey: "tutorial.steps.financesBody" },
  { id: "cardi",    icon: "sparkle",  titleKey: "tutorial.steps.cardiTitle",    bodyKey: "tutorial.steps.cardiBody" },
];
