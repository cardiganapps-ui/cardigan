/**
 * @vitest-environment happy-dom
 *
 * Smoke + behavior coverage for the onboarding carousel. The old
 * spotlight tour had no tests and drifted from the screens it pointed
 * at; the carousel measures nothing, so these lock in the contract that
 * matters: it renders every slide, the dot pager + buttons reflect
 * position, and Skip/Empezar fire the right callbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../i18n/index";
import { TutorialCarousel } from "../Tutorial/TutorialCarousel";
import { TUTORIAL_SLIDES } from "../Tutorial/tutorialSlides";

beforeEach(() => {
  // happy-dom doesn't implement Element.scrollTo — stub it so button
  // navigation doesn't throw.
  Element.prototype.scrollTo = vi.fn();
  // Run the onScroll rAF callback synchronously so scroll-driven state
  // updates land within act().
  vi.stubGlobal("requestAnimationFrame", (cb) => { cb(); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

// Each test renders into document.body; clean up so screen-wide queries
// don't match leftover carousels from prior renders.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCarousel(props = {}) {
  let res;
  act(() => {
    res = render(
      <I18nProvider>
        <TutorialCarousel onSkip={() => {}} onFinish={() => {}} {...props} />
      </I18nProvider>,
    );
  });
  return res;
}

describe("TutorialCarousel", () => {
  it("renders a dialog with one slide per definition and a matching dot pager", () => {
    const { container } = renderCarousel();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelectorAll(".tut-carousel-slide").length).toBe(TUTORIAL_SLIDES.length);
    expect(container.querySelectorAll(".tut-carousel-dot").length).toBe(TUTORIAL_SLIDES.length);
  });

  it("starts on the first slide: no Back button, primary reads 'Siguiente'", () => {
    const { container, getByText } = renderCarousel();
    expect(getByText("Siguiente")).toBeTruthy();
    // Back ('Atrás') is not rendered on slide 0.
    expect(container.textContent).not.toContain("Atrás");
    expect(container.querySelector(".tut-carousel-dot--active")).toBe(
      container.querySelectorAll(".tut-carousel-dot")[0],
    );
  });

  it("Skip fires onSkip", () => {
    const onSkip = vi.fn();
    const { getByLabelText } = renderCarousel({ onSkip });
    fireEvent.click(getByLabelText("Saltar el recorrido"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("the last slide's primary button reads 'Empezar' and fires onFinish", () => {
    const onFinish = vi.fn();
    const { container, getByText } = renderCarousel({ onFinish });
    const track = container.querySelector(".tut-carousel-track");
    // Simulate the track scrolled to the final slide.
    Object.defineProperty(track, "clientWidth", { value: 300, configurable: true });
    track.scrollLeft = 300 * (TUTORIAL_SLIDES.length - 1);
    act(() => { fireEvent.scroll(track); });
    const primary = getByText("Empezar");
    expect(primary).toBeTruthy();
    fireEvent.click(primary);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
