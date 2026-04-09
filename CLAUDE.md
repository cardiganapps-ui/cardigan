# Cardigan

Practice management app for therapists. Built for mobile-first use (PWA).

## Tech Stack
- **Frontend:** React 19 + Vite 5, JavaScript (no TypeScript)
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Vercel (auto-deploys from `main` branch)
- **Styling:** Custom CSS with design tokens, no UI library
- **Fonts:** Nunito (display), Nunito Sans (body)
- **Language:** Spanish (all UI text)

## Live URL
https://cardigan-fawn.vercel.app

## Architecture

### File Structure
```
src/
├── utils/              # Shared utilities
│   ├── dates.js        # Date formatting, parsing, ISO conversion
│   └── sessions.js     # Session status helpers, tutor detection
├── hooks/              # Data & interaction hooks
│   ├── useCardiganData.js  # Main coordinator (refresh, enrichment, auto-extend)
│   ├── usePatients.js      # Patient CRUD
│   ├── useSessions.js      # Session CRUD, recurring, schedule changes
│   ├── usePayments.js      # Payment CRUD
│   ├── useNotes.js         # Note CRUD
│   ├── useSwipe.js         # Shared touch swipe hook
│   └── useAuth.js          # Supabase auth (signup, signin, signout)
├── components/
│   ├── sheets/             # Modal forms (extracted from QuickActions)
│   │   ├── NewPatientSheet.jsx
│   │   ├── NewSessionSheet.jsx
│   │   └── NewNoteSheet.jsx
│   ├── QuickActions.jsx    # FAB menu coordinator (~60 lines)
│   ├── SessionSheet.jsx    # Session detail overlay (from Agenda)
│   ├── NoteEditor.jsx      # iPhone Notes-style editor + NoteCard
│   ├── PaymentModal.jsx    # Payment recording form
│   ├── PullToRefresh.jsx   # Pull-to-refresh wrapper
│   ├── Drawer.jsx          # Navigation drawer with swipe open/close
│   ├── Toggle.jsx          # Shared toggle switch component
│   ├── StatusBadge.jsx     # Session status badge component
│   └── Icons.jsx           # All SVG icons as components
├── screens/
│   ├── Home.jsx            # Dashboard with KPIs, today's sessions, saldos
│   ├── Agenda.jsx          # Calendar (day/week/month views with swipe)
│   ├── Patients.jsx        # Patient list + edit sheet
│   ├── PatientExpediente.jsx # Full patient profile (resumen/sesiones/notas)
│   ├── Finances.jsx        # Saldos, pagos, ingresos tabs
│   ├── Settings.jsx        # Profile, currency, plan, password
│   ├── AuthScreen.jsx      # Login/signup/password reset
│   └── AdminPanel.jsx      # Admin-only user account viewer
├── data/
│   ├── seedData.js         # Constants (colors, nav items, day/month names)
│   └── api.js              # Re-exports from utils/dates for compatibility
├── supabaseClient.js       # Supabase client init
├── App.jsx                 # App shell, routing, state coordination
└── styles.css              # All CSS (~570 lines)
```

### Data Flow
- `useCardiganData` is the main hook. It coordinates 4 domain hooks (patients, sessions, payments, notes).
- On load, it fetches all data filtered by `user_id`, auto-extends recurring sessions, auto-completes past sessions.
- Returns `enrichedPatients` (with `amountDue` computed) and `enrichedSessions` (with auto-completed status).
- All mutations go through the domain hooks which update both Supabase and local state optimistically.

### Key Design Decisions
- **Dates stored as "D MMM" strings** (e.g., "8 Abr") in the database. Converted to/from ISO for date inputs.
- **amountDue formula:** `patient.billed - (futureSessionCount × currentRate) - patient.paid`. This preserves historical rate accuracy.
- **Tutor sessions:** Marked by `"T·"` prefix in the `initials` field. Purple styling throughout.
- **Session statuses:** `scheduled`, `completed`, `cancelled` (no charge), `charged` (cancelled but billed).
- **Auto-extend:** On each load, if an active patient's last session is within 4 weeks of today, generates 12 more weeks of sessions.
- **Auto-complete:** Sessions automatically become "completed" 1 hour after their start time.

## Database Schema (Supabase)

### Tables
- **patients:** id, user_id, name, parent, initials, rate, day, time, status, billed, paid, sessions, color_idx
- **sessions:** id, user_id, patient_id (FK cascade), patient, initials, time, day, date, status, color_idx
- **payments:** id, user_id, patient_id (FK set null), patient, initials, amount, date, method, color_idx
- **notes:** id, user_id, patient_id (FK cascade), session_id (FK set null), title, content, created_at, updated_at

### RLS Policies
- All tables: `auth.uid() = user_id` for user data isolation
- Admin read: `is_admin()` function checks JWT email = `gaxioladiego@gmail.com`
- Admin helper: `get_user_profiles()` RPC to list auth.users (admin only)

### Session Status Constraint
```sql
check (status in ('scheduled', 'completed', 'cancelled', 'charged'))
```

## Admin System
- Admin email: `gaxioladiego@gmail.com`
- Gear icon in topbar (admin only) opens AdminPanel
- "Ver como usuario" loads another user's data in read-only mode
- Dark "Modo lectura" banner with "Salir" button
- FAB hidden, writes blocked in read-only mode

## Features

### Patients
- Create with name, minor toggle (tutor field), rate, recurring schedules (multi day/time)
- Schedule/rate changes with effective date (deletes future sessions, regenerates at new rate)
- Patient expediente: full-screen profile with Resumen/Sesiones/Notas tabs
- Date-filtered financials (vendido, cobrado, saldo período/actual)
- Attendance stats with quick period buttons (1m, 3m, 6m, 1y)
- Duplicate name prevention

### Sessions
- Recurring generation with start/optional end date, auto-extend
- Cancel with charge ("charged") or without ("cancelled")
- Reschedule from Agenda session detail
- Tutor sessions for minor patients (purple styling, custom rate)
- Auto-complete 1 hour after start

### Payments
- Record with patient, amount (auto-fills amountDue), method (including custom "Otro"), date
- Dynamic month filters in Finances

### Notes
- iPhone Notes-style editor (title + body, auto-save with 800ms debounce)
- Linked to patient + optionally to specific session
- Accessible from: patient expediente, session detail in Agenda, FAB menu
- Tutor note toggle for minor patients
- Auto-links to most recent past session when creating from FAB

### UX
- Interactive swipe: drawer open/close, Agenda day/week/month navigation
- Pull-to-refresh on all screens
- PWA manifest for Add to Home Screen
- Screen persistence via URL hash
- Left-edge swipe to open drawer from any screen
- "Hoy" button in Agenda to jump to today

## Conventions
- Spanish for all UI text
- No TypeScript — plain JS/JSX
- Inline styles for component-specific styling, CSS file for shared classes
- Currency: MXN, formatted with `.toLocaleString()`
- Commit messages: conventional commits (feat/fix/refactor/style/chore)
- Don't deploy on every commit — batch changes and deploy when asked

## Development
```bash
npm install
npm run dev     # Local dev server
npm run build   # Production build
```

## Deployment
- Push to `main` branch triggers Vercel deploy
- Free tier: 100 deploys/day limit — batch changes
- To deploy manually: `git push -u origin main`
- Vercel limit resets at midnight UTC
