# Play production-access questionnaire — answers

After 14 days of closed testing (12+ testers), Play Console prompts for a
production-access application. These answers are tailored to what actually
happened during Cardigan's closed test in June–July 2026 — the Testers
Community feedback report plus the changes shipped in response. Adjust
tone/first-person as needed when pasting into the form.

> Related: submission kit in `docs/play-store-submission.md`; regenerated
> store screenshots in `docs/play-store-assets/`.

**1) How did you recruit users for your closed test?**

We used a paid testing provider (Testers Community) to get structured,
device-diverse QA coverage, and we also recruited independent professionals
from our target audience — psychologists, nutritionists, tutors and
trainers in Mexico — to use the app with their real day-to-day workflows.

**2) How easy was it to recruit testers for your app?**

Easy.

**3) Describe the engagement you received from testers during your closed test**

Testers exercised the full surface of the app — scheduling, patient
records, payments, expenses and notes — across a range of devices and
Android versions. They reported no crashes or functional defects, and gave
concrete UX feedback: store screenshots that didn't showcase features, a
static onboarding walkthrough, an unnecessary vibration when signing out,
and a request for language support beyond Spanish.

**4) Provide a summary of the feedback that you received from testers. Include how you collected the feedback.**

Feedback was collected through the provider's written reports, direct
communication, and usability sessions. Main points and what we did:

- **Store screenshots didn't showcase features** → replaced with annotated
  feature-focused screenshots (headline + caption per feature) generated
  from the real app.
- **Walkthrough felt generic** → the onboarding tour now adapts its copy
  to the professional's discipline (patients/students/clients, sessions/
  lessons/consultations), with regression tests locking the behavior in.
- **Vibration on logout felt unnecessary** → removed it, and added a
  global "Vibration" toggle in Settings so all haptic feedback is
  user-controllable.
- **Language** → the app now ships full English support: it follows the
  device language automatically and adds an in-app language switcher
  (Settings → Appearance → Language), on top of the original Spanish.

**5) Who is the intended audience for your app?**

Independent professionals who manage their own practice — psychologists,
nutritionists, tutors, music teachers and personal trainers. Cardigan
gives them one mobile-first tool for scheduling, client records, payments,
expenses, notes and documents, with reminders and privacy compliance
built in.

**6) Describe how your app provides value to the users.**

Cardigan replaces the spreadsheet-plus-notebook workflow: recurring
sessions extend themselves, balances derive automatically from sessions
and payments, expenses capture from a receipt photo, session reminders go
out on time, and clinical notes support optional encryption at rest. The
professional works from one app and their numbers always add up.

**7) How many installs do you expect your app to have in your first year?**

10k – 100k.

**8) What changes did you make to your app based on what you learned during your closed test?**

Four concrete changes shipped from tester feedback: (1) annotated,
feature-focused Play Store screenshots; (2) a profession-personalized
onboarding walkthrough; (3) removal of the sign-out vibration plus a
global vibration preference in Settings; (4) full English localization
with automatic device-language detection and an in-app language switcher.

**9) How did you decide that your app is ready for production?**

The closed test surfaced zero crashes or functional defects across devices
and Android versions. We shipped every actionable piece of tester
feedback, kept our automated suite green throughout (unit + end-to-end
tests covering money math, scheduling and the note editor, plus nightly
accounting audits against production data), and the same codebase already
runs in production on the web and on iOS via the App Store.

**10) What did you do differently this time?**

We combined professional QA (device-matrix coverage) with real
target-audience users, turned their feedback into shipped changes within
the testing window — onboarding, store presentation, haptics, language
support — and validated each change with automated tests before promoting
the build.
