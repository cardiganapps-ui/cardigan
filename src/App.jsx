import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Nunito+Sans:wght@300;400;500;600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --teal:        #5B9BAF;
  --teal-dark:   #4A8799;
  --teal-light:  #7AB5C7;
  --teal-pale:   #EAF4F7;
  --teal-mist:   #F2F9FB;
  --cream:       #F5F0EB;
  --cream-dark:  #EDE7DF;
  --cream-deeper:#E3DBD1;
  --charcoal:    #2E2E2E;
  --charcoal-md: #555;
  --charcoal-lt: #777;
  --charcoal-xl: #9E9E9E;
  --border:      #E2DBD3;
  --border-lt:   #EDE8E2;
  --white:       #FFFFFF;
  --green:       #3DAB74;
  --green-bg:    #EBF8F2;
  --red:         #D96B6B;
  --red-bg:      #FDF1F1;
  --amber:       #D4A040;
  --amber-bg:    #FDF6E8;
  --purple:      #8B7EC8;
  --purple-bg:   #F0EEF9;
  --nav-bg:      #2C4A52;
  --radius-sm:   8px;
  --radius:      12px;
  --radius-lg:   16px;
  --radius-pill: 100px;
  --shadow-sm:   0 1px 4px rgba(46,46,46,0.07);
  --shadow:      0 2px 12px rgba(46,46,46,0.09);
  --font:        'Nunito Sans', sans-serif;
  --font-d:      'Nunito', sans-serif;
  --sat: env(safe-area-inset-top, 44px);
  --sab: env(safe-area-inset-bottom, 34px);
}

html, body {
  font-family: var(--font);
  background: var(--cream);
  color: var(--charcoal);
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  height: 100%;
  overflow: hidden;
}
#root { height: 100%; }

.shell {
  display: flex; flex-direction: column;
  height: 100dvh;
  width: 100%;
  background: var(--cream);
  position: relative; overflow: hidden;
}
.status-bar { height: var(--sat); background: var(--nav-bg); flex-shrink: 0; }

/* Smooth page transitions */
.page > .section, .page > div { animation: fadeInUp 0.25s ease-out; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* TOPBAR */
.topbar {
  background: var(--nav-bg);
  padding: 8px 16px 10px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
}
.topbar-left { display: flex; align-items: center; gap: 10px; }
.topbar-center { flex: 1; padding: 0 6px; }
.topbar-title { font-family: var(--font-d); font-size: 17px; font-weight: 800; color: var(--white); letter-spacing: -0.3px; }
.topbar-sub { display: none; }
.topbar-right { display: flex; align-items: center; gap: 10px; }

.icon-btn {
  width: 38px; height: 38px; border-radius: 50%;
  background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; cursor: pointer; color: white;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.icon-btn:active { opacity: 0.6; }

/* HAMBURGER */
.hamburger {
  width: 38px; height: 38px; border-radius: 50%;
  background: transparent; border: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px; cursor: pointer; padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.hamburger:active { opacity: 0.6; }
.hamburger-line {
  width: 18px; height: 2px; background: white; border-radius: 2px;
  transition: all 0.22s ease;
  transform-origin: center;
}
.hamburger.open .hamburger-line:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open .hamburger-line:nth-child(2) { opacity: 0; transform: scaleX(0); }
.hamburger.open .hamburger-line:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.avatar-sm {
  width: 34px; height: 34px; background: var(--teal-light); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-d); font-size: 12px; font-weight: 800; color: var(--white);
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}

/* DRAWER OVERLAY */
.drawer-overlay {
  position: fixed; inset: 0; background: rgba(20,35,40,0.5);
  z-index: 300; backdrop-filter: blur(2px);
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* DRAWER PANEL */
.drawer {
  position: fixed; top: 0; left: 0;
  width: 100%;
  height: 100dvh;
  display: flex; flex-direction: column;
  pointer-events: none;
  z-index: 301;
}
.drawer-panel {
  position: absolute; top: 0; left: 0;
  width: 78%; max-width: 300px;
  height: 100%;
  background: var(--nav-bg);
  pointer-events: all;
  display: flex; flex-direction: column;
  animation: slideIn 0.25s cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow: 4px 0 40px rgba(0,0,0,0.3);
}
@keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }

.drawer-header {
  padding: calc(var(--sat) + 20px) 24px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.drawer-logo {
  font-family: var(--font-d); font-size: 22px; font-weight: 800;
  color: white; letter-spacing: -0.4px; margin-bottom: 16px;
}
.drawer-user { display: flex; align-items: center; gap: 12px; }
.drawer-avatar {
  width: 44px; height: 44px; background: var(--teal-light); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-d); font-size: 16px; font-weight: 800; color: white;
  flex-shrink: 0;
}
.drawer-user-name { font-family: var(--font-d); font-size: 15px; font-weight: 700; color: white; }
.drawer-user-sub { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 2px; }

.drawer-nav { flex: 1; padding: 12px 0; overflow-y: auto; }
.drawer-section-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.3); padding: 12px 24px 4px;
}
.drawer-item {
  display: flex; align-items: center; gap: 14px;
  padding: 13px 24px;
  cursor: pointer; border: none; background: none; width: 100%;
  font-family: var(--font); text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s;
  position: relative;
}
.drawer-item:active { background: rgba(255,255,255,0.06); }
.drawer-item.active { background: rgba(91,155,175,0.18); }
.drawer-item.active::before {
  content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
  width: 3px; background: var(--teal-light); border-radius: 0 2px 2px 0;
}
.drawer-item-icon {
  width: 36px; height: 36px; border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; flex-shrink: 0;
  background: transparent;
}
.drawer-item.active .drawer-item-icon { background: transparent; }
.drawer-item-label { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.65); }
.drawer-item.active .drawer-item-label { color: white; font-weight: 700; }

.drawer-footer {
  padding: 16px 24px calc(var(--sab) + 16px);
  border-top: 1px solid rgba(255,255,255,0.08);
}
.drawer-plan {
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,0.06); border-radius: var(--radius);
  padding: 12px 14px;
}
.drawer-plan-icon { font-size: 18px; }
.drawer-plan-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.4); }
.drawer-plan-value { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.8); margin-top: 1px; }

/* PAGE */
.page { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; padding-bottom: 24px; }
.page::-webkit-scrollbar { display: none; }

/* FAB */
.fab {
  position: absolute; bottom: calc(var(--sab) + 20px); right: 20px;
  width: 56px; height: 56px; background: linear-gradient(135deg, var(--teal-light), var(--teal-dark)); border-radius: 50%;
  border: none; display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 300; color: white;
  box-shadow: 0 6px 24px rgba(74,135,153,0.45);
  cursor: pointer; z-index: 50;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s, box-shadow 0.15s;
}
.fab:active { transform: scale(0.92); box-shadow: 0 2px 12px rgba(74,135,153,0.35); }

/* CARDS & SECTIONS */
.section { padding: 16px 16px 0; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.section-title { font-family: var(--font-d); font-size: 15px; font-weight: 800; color: var(--charcoal); }
.see-all { font-size: 13px; font-weight: 600; color: var(--teal-dark); background: none; border: none; cursor: pointer; padding: 4px 0; -webkit-tap-highlight-color: transparent; }

.card { background: var(--white); border-radius: var(--radius-lg); border: 1px solid var(--border-lt); box-shadow: var(--shadow-sm); overflow: hidden; transition: box-shadow 0.15s; }

/* KPI ROW */
.kpi-scroll {
  display: flex; gap: 10px; overflow-x: auto; padding: 0 16px 4px;
  -webkit-overflow-scrolling: touch; scrollbar-width: none; scroll-snap-type: x mandatory;
}
.kpi-scroll::-webkit-scrollbar { display: none; }
.kpi-card {
  background: var(--white); border-radius: var(--radius-lg);
  padding: 14px 16px; min-width: 140px; flex-shrink: 0;
  box-shadow: var(--shadow-sm); scroll-snap-align: start;
  border: 1px solid var(--border-lt); position: relative; overflow: hidden;
}
.kpi-card::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--teal-light), var(--teal)); }
.kpi-label { font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--charcoal-xl); margin-bottom: 6px; }
.kpi-value { font-family: var(--font-d); font-size: 22px; font-weight: 800; color: var(--charcoal); letter-spacing: -0.4px; }
.kpi-meta { font-size: 11px; color: var(--charcoal-xl); margin-top: 4px; }

/* BADGE */
.badge { display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: var(--radius-pill); }
.badge-green  { background: var(--green-bg);  color: var(--green); }
.badge-red    { background: var(--red-bg);    color: var(--red); }
.badge-teal   { background: var(--teal-pale); color: var(--teal-dark); }
.badge-gray   { background: var(--cream-dark);color: var(--charcoal-lt); }
.badge-amber  { background: var(--amber-bg);  color: var(--amber); }
.badge-purple { background: var(--purple-bg); color: var(--purple); }

/* ROW ITEMS */
.row-item {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 16px; border-bottom: 1px solid var(--border-lt);
  cursor: pointer; min-height: 62px;
  -webkit-tap-highlight-color: transparent; transition: background 0.1s;
}
.row-item:last-child { border-bottom: none; }
.row-item:active { background: var(--teal-mist); }
.row-avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--font-d); font-size: 13px; font-weight: 800; color: var(--white); flex-shrink: 0; }
.row-icon { width: 40px; height: 40px; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
.row-content { flex: 1; min-width: 0; }
.row-title { font-size: 14px; font-weight: 600; color: var(--charcoal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
.row-sub { font-size: 12px; color: var(--charcoal-xl); }
.row-right { text-align: right; flex-shrink: 0; }
.row-amount { font-family: var(--font-d); font-size: 15px; font-weight: 700; margin-bottom: 2px; }
.row-date { font-size: 11px; color: var(--charcoal-xl); }
.row-chevron { color: var(--border); font-size: 14px; flex-shrink: 0; margin-left: 4px; }
.amount-owe   { color: var(--red); }
.amount-paid  { color: var(--green); }
.amount-clear { color: var(--charcoal-xl); }

/* SEGMENT */
.segment { display: flex; background: var(--cream-dark); border-radius: var(--radius-pill); padding: 3px; gap: 2px; }
.seg-btn {
  flex: 1; padding: 7px 8px; font-size: 12px; font-weight: 600;
  border-radius: var(--radius-pill); border: none; cursor: pointer;
  font-family: var(--font); color: var(--charcoal-lt); background: transparent;
  transition: all 0.15s; -webkit-tap-highlight-color: transparent;
  text-transform: capitalize; min-height: 34px;
}
.seg-btn.active { background: var(--white); color: var(--teal-dark); box-shadow: var(--shadow-sm); }

/* SEARCH */
.search-bar {
  display: flex; align-items: center;
  background: var(--white); border: 1.5px solid var(--border);
  border-radius: var(--radius-pill); padding: 0 14px; height: 42px; gap: 8px;
  box-shadow: var(--shadow-sm);
}
.search-bar input { border: none; outline: none; font-family: var(--font); font-size: 14px; color: var(--charcoal); background: transparent; flex: 1; -webkit-appearance: none; }
.search-bar input::placeholder { color: var(--charcoal-xl); }

/* INPUT */
.input-group { margin-bottom: 16px; }
.input-label { display: block; font-size: 12.5px; font-weight: 600; color: var(--charcoal-md); margin-bottom: 6px; }
.input {
  width: 100%; padding: 13px 16px;
  border: 1.5px solid var(--border); border-radius: var(--radius);
  font-size: 16px; font-family: var(--font); color: var(--charcoal);
  background: var(--white); outline: none; -webkit-appearance: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  height: 48px;
}
select.input { height: 48px; }
.input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(91,155,175,0.13); }
.input::placeholder { color: var(--charcoal-xl); }

/* BTN */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 0 20px; height: 48px; font-size: 15px; font-weight: 700;
  border-radius: var(--radius-pill); border: none; cursor: pointer;
  font-family: var(--font-d); -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s; white-space: nowrap;
}
.btn:active { transform: scale(0.97); }
.btn-primary { background: var(--teal); color: var(--white); box-shadow: 0 3px 12px rgba(91,155,175,0.4); width: 100%; }
.btn-secondary { background: var(--white); color: var(--charcoal-md); border: 1.5px solid var(--border); box-shadow: var(--shadow-sm); }
.btn-ghost { background: transparent; color: var(--teal-dark); height: 38px; padding: 0 10px; font-size: 13px; }
.btn-danger { background: var(--red-bg); color: var(--red); box-shadow: none; width: 100%; }

/* SESSION STATUS PILL */
.session-status {
  padding: 3px 10px; border-radius: var(--radius-pill);
  font-size: 11px; font-weight: 700; display: inline-block;
}
.status-scheduled  { background: var(--teal-pale);  color: var(--teal-dark); }
.status-completed  { background: var(--green-bg);   color: var(--green); }
.status-cancelled  { background: var(--cream-dark); color: var(--charcoal-lt); }

/* CALENDAR DAY STRIP */
.cal-strip { display: flex; gap: 6px; overflow-x: auto; padding: 0 16px 4px; scrollbar-width: none; }
.cal-strip::-webkit-scrollbar { display: none; }
.cal-day {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 10px; border-radius: var(--radius); flex-shrink: 0;
  cursor: pointer; min-width: 44px; -webkit-tap-highlight-color: transparent;
  transition: all 0.12s;
}
.cal-day.active { background: var(--teal); }
.cal-day.has-sessions { position: relative; }
.cal-day.has-sessions::after { content: ''; position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--teal); }
.cal-day.active::after { background: white; }
.cal-day-name { font-size: 10px; font-weight: 700; color: var(--charcoal-xl); text-transform: uppercase; }
.cal-day.active .cal-day-name { color: rgba(255,255,255,0.8); }
.cal-day-num { font-family: var(--font-d); font-size: 16px; font-weight: 800; color: var(--charcoal); }
.cal-day.active .cal-day-num { color: white; }

/* BALANCE BAR */
.balance-bar { height: 6px; background: var(--cream-dark); border-radius: 3px; overflow: hidden; margin-top: 6px; }
.balance-fill { height: 100%; border-radius: 3px; background: var(--green); transition: width 0.3s; }

/* AUTH */
.auth-screen { min-height: 100dvh; width: 100%; background: var(--cream); display: flex; flex-direction: column; }
.auth-header { background: var(--nav-bg); padding: calc(var(--sat) + 40px) 24px 48px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; border-radius: 0 0 28px 28px; }
.auth-wordmark { font-family: var(--font-d); font-size: 32px; font-weight: 800; color: var(--white); letter-spacing: -0.5px; }
.auth-tagline { font-size: 14.5px; color: rgba(255,255,255,0.6); line-height: 1.5; max-width: 280px; }
.auth-body { flex: 1; padding: 24px 28px calc(var(--sab) + 28px); }
.auth-toggle { display: flex; background: var(--cream-dark); border-radius: var(--radius-pill); padding: 3px; gap: 2px; margin-bottom: 28px; }
.auth-tab { flex: 1; padding: 11px; font-size: 14px; font-weight: 700; border-radius: var(--radius-pill); border: none; cursor: pointer; font-family: var(--font-d); color: var(--charcoal-lt); background: transparent; -webkit-tap-highlight-color: transparent; transition: all 0.15s; }
.auth-tab.active { background: var(--white); color: var(--charcoal); box-shadow: var(--shadow-sm); }

/* SETTINGS */
.settings-label { font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--charcoal-xl); padding: 14px 16px 7px; }
.settings-row { display: flex; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border-lt); cursor: pointer; min-height: 52px; -webkit-tap-highlight-color: transparent; gap: 12px; background: var(--white); }
.settings-row:last-child { border-bottom: none; }
.settings-row:active { background: var(--teal-mist); }
.settings-row-icon { width: 34px; height: 34px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.settings-row-title { font-size: 14px; font-weight: 600; color: var(--charcoal); }
.settings-row-sub { font-size: 12px; color: var(--charcoal-xl); margin-top: 1px; }
.settings-chevron { color: var(--border); font-size: 16px; margin-left: auto; }

/* DETAIL SHEET */
.sheet-overlay { position: fixed; inset: 0; background: rgba(20,35,40,0.45); backdrop-filter: blur(2px); z-index: 200; display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.15s ease; }
.sheet-panel {
  background: var(--white); border-radius: 20px 20px 0 0;
  width: 100%;
  padding-bottom: var(--sab);
  max-height: 88dvh; overflow-y: auto;
  animation: slideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
.sheet-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 14px auto 6px; }
.sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px 18px; }
.sheet-title { font-family: var(--font-d); font-size: 18px; font-weight: 800; color: var(--charcoal); }
.sheet-close { width: 32px; height: 32px; border-radius: 50%; background: var(--cream-dark); border: none; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; transition: background 0.12s; }
.sheet-close:active { background: var(--cream-deeper); }

/* AGENDA VIEW TOGGLE */
.view-toggle {
  display: flex; background: var(--cream-dark); border-radius: var(--radius-pill);
  padding: 3px; gap: 2px; margin: 0 16px 14px;
}
.view-btn {
  flex: 1; padding: 7px 8px; font-size: 12px; font-weight: 600;
  border-radius: var(--radius-pill); border: none; cursor: pointer;
  font-family: var(--font); color: var(--charcoal-lt); background: transparent;
  transition: all 0.15s; -webkit-tap-highlight-color: transparent; min-height: 34px;
}
.view-btn.active { background: var(--white); color: var(--teal-dark); box-shadow: var(--shadow-sm); }

/* MONTH GRID */
.month-header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px 12px; }
.month-nav-btn {
  width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--border);
  background: var(--white); display: flex; align-items: center; justify-content: center;
  font-size: 14px; cursor: pointer; color: var(--charcoal-md);
  -webkit-tap-highlight-color: transparent; box-shadow: var(--shadow-sm);
}
.month-nav-btn:active { background: var(--teal-pale); }
.month-title { font-family: var(--font-d); font-size: 16px; font-weight: 800; color: var(--charcoal); }
.month-grid { padding: 0 16px; }
.month-dow-row { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.month-dow { text-align: center; font-size: 10px; font-weight: 700; color: var(--charcoal-xl); text-transform: uppercase; padding: 4px 0; }
.month-days-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.month-cell {
  aspect-ratio: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; border-radius: var(--radius-sm); cursor: pointer;
  position: relative; -webkit-tap-highlight-color: transparent; transition: background 0.12s;
}
.month-cell:active { background: var(--teal-pale); }
.month-cell.active { background: var(--teal); }
.month-cell.today:not(.active) { background: var(--teal-pale); }
.month-cell.other-month .month-cell-num { color: var(--cream-deeper); }
.month-cell-num { font-family: var(--font-d); font-size: 13px; font-weight: 700; color: var(--charcoal); }
.month-cell.active .month-cell-num { color: white; }
.month-cell.today:not(.active) .month-cell-num { color: var(--teal-dark); }
.month-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--teal); position: absolute; bottom: 4px; }
.month-cell.active .month-dot { background: rgba(255,255,255,0.7); }

/* WEEK GRID */
.week-header-row { display: grid; grid-template-columns: 44px repeat(7, 1fr); padding: 0 16px; margin-bottom: 2px; }
.week-day-head { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; }
.week-day-name { font-size: 9px; font-weight: 700; text-transform: uppercase; color: var(--charcoal-xl); }
.week-day-num {
  font-family: var(--font-d); font-size: 14px; font-weight: 800; color: var(--charcoal);
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.week-day-num.active { background: var(--teal); color: white; }
.week-day-num.today:not(.active) { background: var(--teal-pale); color: var(--teal-dark); }
.week-body { padding: 0 16px; }
.week-time-row { display: grid; grid-template-columns: 44px repeat(7, 1fr); border-bottom: 1px solid var(--border-lt); min-height: 48px; }
.week-time-label { font-size: 10px; color: var(--charcoal-xl); font-weight: 600; padding: 6px 8px 0 0; text-align: right; line-height: 1; }
.week-cell { border-left: 1px solid var(--border-lt); position: relative; min-height: 48px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.week-cell:active { background: var(--teal-mist); }
.week-event {
  position: absolute; left: 2px; right: 2px; top: 4px;
  background: var(--teal-pale); border-left: 2px solid var(--teal);
  border-radius: 4px; padding: 2px 4px;
  font-size: 9px; font-weight: 700; color: var(--teal-dark);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer;
}
.week-event.cancelled { background: var(--cream-dark); border-left-color: var(--charcoal-xl); color: var(--charcoal-lt); }

/* FINANCES */
.fin-tab-row {
  display: flex; gap: 0; background: var(--cream-dark);
  border-radius: var(--radius-pill); padding: 3px; margin: 0 16px 16px;
}
.fin-tab {
  flex: 1; padding: 7px 6px; font-size: 11.5px; font-weight: 600;
  border-radius: var(--radius-pill); border: none; cursor: pointer;
  font-family: var(--font); color: var(--charcoal-lt); background: transparent;
  transition: all 0.15s; -webkit-tap-highlight-color: transparent; min-height: 34px;
  white-space: nowrap;
}
.fin-tab.active { background: var(--white); color: var(--teal-dark); box-shadow: var(--shadow-sm); }

/* Mini bar chart */
.bar-chart { display: flex; align-items: flex-end; gap: 5px; height: 80px; padding: 0 4px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; border-radius: 4px 4px 0 0; overflow: hidden; }
.bar-fill { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.3s; }
.bar-label { font-size: 9px; font-weight: 700; color: var(--charcoal-xl); text-transform: uppercase; }
.bar-val { font-size: 9px; font-weight: 700; color: var(--charcoal-md); }

/* Balance rows */
.bal-row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-lt); }
.bal-row:last-child { border-bottom: none; }
.bal-name { flex: 1; font-size: 14px; font-weight: 600; color: var(--charcoal); }
.bal-sub  { font-size: 11px; color: var(--charcoal-xl); margin-top: 2px; }
.bal-amt  { font-family: var(--font-d); font-size: 14px; font-weight: 800; }

/* Stat tile */
.stat-tile {
  background: var(--white); border-radius: var(--radius-lg);
  border: 1px solid var(--border-lt); box-shadow: var(--shadow-sm);
  padding: 14px 16px; position: relative; overflow: hidden;
}
.stat-tile::after { content:''; position:absolute; top:0; left:0; right:0; height:3px; background: linear-gradient(90deg, var(--teal-light), var(--teal)); }
.stat-tile-label { font-size:10px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:var(--charcoal-xl); margin-bottom:5px; }
.stat-tile-val { font-family:var(--font-d); font-size:20px; font-weight:800; color:var(--charcoal); letter-spacing:-0.3px; }
.stat-tile-sub { font-size:11px; color:var(--charcoal-xl); margin-top:3px; }

/* PATIENT LIST */
.sort-row { display: flex; align-items: center; justify-content: space-between; padding: 0 16px 10px; }
.sort-label { font-size: 12px; color: var(--charcoal-xl); font-weight: 600; }
.sort-select {
  font-family: var(--font); font-size: 12px; font-weight: 700; color: var(--teal-dark);
  background: var(--teal-pale); border: none; border-radius: var(--radius-pill);
  padding: 5px 10px; cursor: pointer; outline: none; -webkit-appearance: none;
}
.filter-chips { display: flex; gap: 6px; overflow-x: auto; padding: 0 16px 12px; scrollbar-width: none; }
.filter-chips::-webkit-scrollbar { display: none; }
.chip {
  padding: 5px 13px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 600;
  border: 1.5px solid var(--border); background: var(--white); color: var(--charcoal-lt);
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; transition: all 0.12s; font-family: var(--font);
}
.chip.active { background: var(--teal); border-color: var(--teal); color: white; }
.chip:active { opacity: 0.8; }

/* UTILS */
.flex { display: flex; } .items-center { align-items: center; } .justify-between { justify-content: space-between; }
.gap-2 { gap: 8px; } .gap-3 { gap: 12px; }
.w-full { width: 100%; }
.text-muted { color: var(--charcoal-xl); }
.mt-3 { margin-top: 12px; } .mt-4 { margin-top: 16px; }
`;

/* ── LOGO ── */
const LogoMark = ({ size = 24, color = "#7AB5C7" }) => {
  const w = size;
  const h = size * 0.82;
  return (
    <svg width={w} height={h} viewBox="0 0 100 82" fill="none">
      {/* Right loop — behind, lower opacity */}
      <path d="M50 41 C56 28, 72 14, 82 20 C94 27, 92 48, 82 58 C72 68, 56 62, 50 41Z" fill={color} opacity="0.5"/>
      {/* Left loop — front */}
      <path d="M50 41 C44 54, 28 68, 18 62 C6 55, 8 34, 18 24 C28 14, 44 20, 50 41Z" fill={color}/>
    </svg>
  );
};

/* ── DATA ── */
const clientColors = ["#5B9BAF","#7AB5C7","#4A8799","#3D6470","#84C5D4","#9E8BC4","#B08DC8"];
const DAY_ORDER = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const DAY_NAMES_SHORT = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
const FULL_DAY_NAMES = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const FULL_MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getToday() { return new Date(); }
function getTodayStr() { const d = getToday(); return `${d.getDate()} ${shortMonths[d.getMonth()]}`; }
function getTodayLabel() { const d = getToday(); return `${FULL_DAY_NAMES[(d.getDay()+6)%7]} ${d.getDate()} ${shortMonths[d.getMonth()]}`; }
function getCurrentMonthLabel() { const d = getToday(); return `${FULL_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; }

function buildCurrentWeek(baseDate = getToday()) {
  const d = new Date(baseDate);
  const dayOfWeek = (d.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(d);
  monday.setDate(d.getDate() - dayOfWeek);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push({
      name: DAY_NAMES_SHORT[i],
      num: String(day.getDate()),
      month: shortMonths[day.getMonth()],
      dateStr: `${day.getDate()} ${shortMonths[day.getMonth()]}`,
      fullDate: day,
    });
  }
  return days;
}

function computeMonthlyData(payments) {
  const byMonth = {};
  payments.forEach(p => {
    const parts = p.date.split(" ");
    if (parts.length < 2) return;
    const mon = parts[1];
    const monIdx = shortMonths.indexOf(mon);
    if (monIdx === -1) return;
    // Infer year from current date context
    const now = getToday();
    const year = monIdx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const key = `${year}-${String(monIdx).padStart(2,"0")}`;
    if (!byMonth[key]) byMonth[key] = { mes: mon, year, cobrado: 0, sesiones: 0, pendiente: 0 };
    byMonth[key].cobrado += p.amount;
    byMonth[key].sesiones += 1;
  });
  return Object.values(byMonth).sort((a, b) => {
    const aKey = a.year * 100 + shortMonths.indexOf(a.mes);
    const bKey = b.year * 100 + shortMonths.indexOf(b.mes);
    return aKey - bKey;
  });
}

/* ── NAV ── */
/* ── SVG ICONS ── */
const Icon = ({ d, size = 20, color = "currentColor", strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  home: "M3 12L12 3l9 9M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9",
  agenda: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  patients: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  finances: "M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1.08z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
};

const navItems = [
  { id:"home",     label:"Inicio",    iconKey:"home",     section:"principal" },
  { id:"agenda",   label:"Agenda",    iconKey:"agenda",   section:"principal" },
  { id:"patients", label:"Pacientes", iconKey:"patients", section:"principal" },
  { id:"finances", label:"Finanzas",  iconKey:"finances", section:"principal" },
  { id:"settings", label:"Ajustes",   iconKey:"settings", section:"cuenta"    },
];

const shortMonths = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatShortDate(date = new Date()) {
  return `${date.getDate()} ${shortMonths[date.getMonth()]}`;
}

function makeInitials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

/* ── SUPABASE DATA HOOK ── */
function useCardiganData(session) {
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [pRes, sRes, payRes] = await Promise.all([
        supabase.from("patients").select("*"),
        supabase.from("sessions").select("*, patients(name, initials, color_idx)").order("scheduled_at"),
        supabase.from("payments").select("*, patients(name, initials, color_idx)").order("created_at", { ascending: false }),
      ]);

      if (pRes.error) throw pRes.error;
      if (sRes.error) throw sRes.error;
      if (payRes.error) throw payRes.error;

      // Build patient rate lookup for billed computation
      const rateByPatient = {};
      (pRes.data || []).forEach(p => { rateByPatient[p.id] = Number(p.session_rate) || 700; });

      // Compute billed/paid/sessions per patient
      const sessionsCountByPatient = {};
      const billedByPatient = {};
      const paidByPatient = {};

      (sRes.data || []).forEach(s => {
        sessionsCountByPatient[s.patient_id] = (sessionsCountByPatient[s.patient_id] || 0) + 1;
        billedByPatient[s.patient_id] = (billedByPatient[s.patient_id] || 0) + (rateByPatient[s.patient_id] || 700);
      });

      (payRes.data || []).forEach(p => {
        paidByPatient[p.patient_id] = (paidByPatient[p.patient_id] || 0) + Number(p.amount);
      });

      const mappedPatients = (pRes.data || []).map((p, i) => ({
        id: p.id,
        name: p.name,
        parent: p.parent_guardian || "",
        initials: p.initials || makeInitials(p.name),
        rate: Number(p.session_rate) || 700,
        day: p.preferred_day || "",
        time: p.preferred_time || "",
        status: p.status || "active",
        phone: p.phone || "",
        email: p.email || "",
        billed: billedByPatient[p.id] || 0,
        paid: paidByPatient[p.id] || 0,
        sessions: sessionsCountByPatient[p.id] || 0,
        colorIdx: p.color_idx ?? (i % clientColors.length),
      }));

      const mappedSessions = (sRes.data || []).map(s => {
        const d = new Date(s.scheduled_at);
        return {
          id: s.id,
          patient_id: s.patient_id,
          patient: s.patients?.name || "",
          initials: s.patients?.initials || "",
          time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`,
          day: DAY_ORDER[(d.getDay() + 6) % 7],
          date: `${d.getDate()} ${shortMonths[d.getMonth()]}`,
          status: s.status || "scheduled",
          colorIdx: s.patients?.color_idx ?? 0,
        };
      });

      const mappedPayments = (payRes.data || []).map((p, i) => {
        const d = p.payment_date || formatShortDate(new Date(p.created_at));
        return {
          id: p.id,
          patient_id: p.patient_id,
          patient: p.patients?.name || "",
          initials: p.patients?.initials || "",
          amount: Number(p.amount),
          date: d,
          method: p.method || "Transferencia",
          colorIdx: p.patients?.color_idx ?? (i % clientColors.length),
        };
      });

      setPatients(mappedPatients);
      setUpcomingSessions(mappedSessions);
      setPayments(mappedPayments);
    } catch (err) {
      setError(err.message || "No se pudieron cargar los datos.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  async function createSession({ patientId, date, time, notes }) {
    if (!patientId || !date || !time || !session) return false;
    setMutating(true);
    setMutationError("");
    try {
      const scheduledAt = new Date(`${date}T${time}`);
      if (isNaN(scheduledAt.getTime())) throw new Error("Fecha u hora inválida");
      const { error: err } = await supabase.from("sessions").insert({
        patient_id: patientId,
        scheduled_at: scheduledAt.toISOString(),
        status: "scheduled",
        notes: notes || null,
      });
      if (err) throw err;
      await loadData();
      return true;
    } catch (err) {
      setMutationError(err.message || "No se pudo crear la sesión.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function createPatient({ name, parentGuardian, phone, email, rate, day, time }) {
    if (!name.trim() || !session) return false;
    setMutating(true);
    setMutationError("");
    try {
      const { error: err } = await supabase.from("patients").insert({
        user_id: session.user.id,
        name: name.trim(),
        initials: makeInitials(name),
        parent_guardian: parentGuardian || null,
        phone: phone || null,
        email: email || null,
        session_rate: rate || 700,
        preferred_day: day || null,
        preferred_time: time || null,
        color_idx: patients.length % clientColors.length,
        status: "active",
      });
      if (err) throw err;
      await loadData();
      return true;
    } catch (err) {
      setMutationError(err.message || "No se pudo crear el paciente.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function createPayment({ patientName, amount, method = "Transferencia", date = formatShortDate() }) {
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const targetPatient = patients.find(p => p.name === patientName);
    if (!targetPatient) return false;

    setMutationError("");
    setMutating(true);
    try {
      const { error: err } = await supabase.from("payments").insert({
        patient_id: targetPatient.id,
        amount: parsedAmount,
        method,
        payment_date: date,
      });
      if (err) throw err;
      await loadData();
      return true;
    } catch (err) {
      setMutationError(err.message || "No se pudo registrar el pago.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function updateSessionStatus(sessionId, status) {
    setMutationError("");
    setMutating(true);
    setUpcomingSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, status } : s)));
    try {
      const { error: err } = await supabase.from("sessions").update({ status }).eq("id", sessionId);
      if (err) throw err;
      return true;
    } catch (err) {
      setMutationError(err.message || "No se pudo actualizar la sesión.");
      await loadData();
      return false;
    } finally {
      setMutating(false);
    }
  }

  return {
    patients,
    upcomingSessions,
    payments,
    loading,
    error,
    mutating,
    mutationError,
    createPatient,
    createSession,
    createPayment,
    updateSessionStatus,
  };
}

/* ── DRAWER ── */
function Drawer({ screen, setScreen, onClose, session }) {
  const principal = navItems.filter(n => n.section === "principal");
  const cuenta    = navItems.filter(n => n.section === "cuenta");
  const handleNav = (id) => { setScreen(id); onClose(); };
  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Usuario";
  const userEmail = session?.user?.email || "";
  const userInitial = userName[0]?.toUpperCase() || "U";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-panel">
          <div className="drawer-header">
            <div className="drawer-logo">cardigan</div>
            <div className="drawer-user">
              <div className="drawer-avatar">{userInitial}</div>
              <div>
                <div className="drawer-user-name">{userName}</div>
                <div className="drawer-user-sub">{userEmail}</div>
              </div>
            </div>
          </div>
          <nav className="drawer-nav">
            <div className="drawer-section-label">Principal</div>
            {principal.map(item => (
              <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
                <div className="drawer-item-icon"><Icon d={ICONS[item.iconKey]} color={screen===item.id ? "var(--teal-light)" : "rgba(255,255,255,0.55)"} /></div>
                <span className="drawer-item-label">{item.label}</span>
              </button>
            ))}
            <div className="drawer-section-label" style={{ marginTop:8 }}>Cuenta</div>
            {cuenta.map(item => (
              <button key={item.id} className={`drawer-item ${screen===item.id?"active":""}`} onClick={() => handleNav(item.id)}>
                <div className="drawer-item-icon"><Icon d={ICONS[item.iconKey]} color={screen===item.id ? "var(--teal-light)" : "rgba(255,255,255,0.55)"} /></div>
                <span className="drawer-item-label">{item.label}</span>
              </button>
            ))}
            <button className="drawer-item" onClick={handleSignOut} style={{ marginTop:4 }}>
              <div className="drawer-item-icon"><Icon d={ICONS.logout} color="var(--red)" /></div>
              <span className="drawer-item-label" style={{ color:"var(--red)" }}>Cerrar sesión</span>
            </button>
          </nav>
          <div className="drawer-footer">
            <div className="drawer-plan">
              <div className="drawer-plan-icon"><Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" size={18} color="var(--teal-light)" /></div>
              <div>
                <div className="drawer-plan-label">Plan activo</div>
                <div className="drawer-plan-value">Cardigan Pro · $199/mes</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── HOME ── */
function Home({ setScreen, patients, upcomingSessions, payments, onRecordPayment, mutating }) {
  const totalBilled   = patients.reduce((s,p) => s+p.billed, 0);
  const totalPaid     = patients.reduce((s,p) => s+p.paid, 0);
  const totalOwed     = totalBilled - totalPaid;
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todayStr      = getTodayStr();
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr);
  const [selected, setSelected] = useState(null);

  // Compute current month's collected amount from payments
  const now = getToday();
  const curMonthStr = shortMonths[now.getMonth()];
  const monthCollected = payments.filter(p => p.date.includes(curMonthStr)).reduce((s, p) => s + p.amount, 0);

  const openPatient = (name) => {
    const p = patients.find(p => p.name === name);
    if (p) setSelected(p);
  };

  return (
    <div className="page">
      <div style={{ paddingTop:16, paddingBottom:4 }}>
        <div className="kpi-scroll">
          <div className="kpi-card" onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
            <div className="kpi-label">Cobrado (Mes)</div>
            <div className="kpi-value">${monthCollected.toLocaleString()}</div>
            <div className="kpi-meta">{getCurrentMonthLabel()}</div>
          </div>
          <div className="kpi-card" onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
            <div className="kpi-label">Por Cobrar</div>
            <div className="kpi-value" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
            <div className="kpi-meta">{patients.filter(p=>p.billed>p.paid).length} pacientes</div>
          </div>
          <div className="kpi-card" onClick={() => setScreen("agenda")} style={{ cursor:"pointer" }}>
            <div className="kpi-label">Sesiones Hoy</div>
            <div className="kpi-value">{todaySessions.length}</div>
            <div className="kpi-meta">{getTodayLabel()}</div>
          </div>
          <div className="kpi-card" onClick={() => setScreen("patients")} style={{ cursor:"pointer" }}>
            <div className="kpi-label">Pacientes</div>
            <div className="kpi-value">{activeCount}</div>
            <div className="kpi-meta">activos</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Hoy — {getTodayLabel()}</span>
          <button className="see-all" onClick={() => setScreen("agenda")}>Ver semana</button>
        </div>
        <div className="card">
          {todaySessions.length === 0
            ? <div style={{ padding:"24px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin sesiones hoy 🎉</div>
            : todaySessions.map(s => (
              <div className="row-item" key={s.id} onClick={() => openPatient(s.patient)}>
                <div className="row-avatar" style={{ background: clientColors[s.colorIdx] }}>{s.initials}</div>
                <div className="row-content">
                  <div className="row-title">{s.patient}</div>
                  <div className="row-sub">{s.time} · {s.day}</div>
                </div>
                <div className="row-right">
                  <span className={`session-status ${s.status==="cancelled"?"status-cancelled":"status-scheduled"}`}>
                    {s.status==="cancelled" ? "Cancelada" : "Agendada"}
                  </span>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div className="section" style={{ paddingTop:20 }}>
        <div className="section-header">
          <span className="section-title">Saldos Pendientes</span>
          <button className="see-all" onClick={() => setScreen("finances")}>Ver todos</button>
        </div>
        <div className="card">
          {patients.filter(p => p.billed > p.paid).slice(0,4).map((p,i) => {
            const owed = p.billed - p.paid;
            const pct  = p.billed > 0 ? (p.paid / p.billed) * 100 : 0;
            return (
              <div className="row-item" key={p.id} onClick={() => setSelected(p)}>
                <div className="row-avatar" style={{ background: clientColors[i % clientColors.length] }}>{p.initials}</div>
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="balance-bar"><div className="balance-fill" style={{ width:`${pct}%` }} /></div>
                  <div className="row-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} pagado de ${p.billed.toLocaleString()}</div>
                </div>
                <div className="row-right">
                  <div className="row-amount amount-owe">-${owed.toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section" style={{ paddingTop:20, paddingBottom:12 }}>
        <div className="section-header">
          <span className="section-title">Últimos Pagos</span>
          <button className="see-all">Ver todos</button>
        </div>
        <div className="card">
          {payments.slice(0,3).map(p => (
            <div className="row-item" key={p.id} onClick={() => openPatient(p.patient)}>
              <div className="row-icon" style={{ background:"var(--green-bg)" }}>💰</div>
              <div className="row-content">
                <div className="row-title">{p.patient}</div>
                <div className="row-sub">{p.date} · {p.method}</div>
              </div>
              <div className="row-right">
                <div className="row-amount amount-paid">+${p.amount.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => setSelected(null)}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{selected.name}</span>
              <button className="sheet-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
                {[
                  { label:"Vendido", value:`$${selected.billed.toLocaleString()}` },
                  { label:"Cobrado", value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                  { label:"Saldo",   value:`$${(selected.billed-selected.paid).toLocaleString()}`, color: selected.billed>selected.paid?"var(--red)":"var(--charcoal-xl)" },
                ].map((s,i) => (
                  <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:s.color||"var(--charcoal)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {[
                { label:"Tutor",            value: selected.parent },
                { label:"Sesión regular",   value:`${selected.day} a las ${selected.time}` },
                { label:"Tarifa",           value:`$${selected.rate} por sesión` },
                { label:"Sesiones totales", value:`${selected.sessions} sesiones` },
                { label:"Estado",           value: selected.status==="active"?"Activo":"Finalizado" },
              ].map((row,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
              <div style={{ marginTop:20, display:"flex", flexDirection:"column", gap:10 }}>
                <button className="btn btn-primary" style={{ height:48 }} onClick={() => onRecordPayment(selected)} disabled={mutating}>
                  {mutating ? "Guardando..." : "💰 Registrar pago"}
                </button>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Ver sesiones</button>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Editar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── SESSION SHEET ── */
function SessionSheet({ session, onClose, onMarkCompleted, onCancelSession, mutating }) {
  if (!session) return null;
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Sesión</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <div className="flex items-center gap-3" style={{ marginBottom:20 }}>
            <div className="row-avatar" style={{ background: clientColors[session.colorIdx], width:52, height:52, fontSize:16 }}>{session.initials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>{session.patient}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"Estado",    value: session.status==="cancelled" ? "Cancelada" : "Agendada", highlight: session.status!=="cancelled" },
              { label:"Tarifa",    value:"$700" },
              { label:"¿Se cobra?",value:"Sí" },
              { label:"Tipo",      value:"Individual" },
            ].map((item,i) => (
              <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{item.label}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color: item.highlight ? "var(--teal-dark)" : "var(--charcoal)" }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <button
              className="btn btn-primary"
              style={{ height:48 }}
              onClick={() => onMarkCompleted(session)}
              disabled={mutating || session.status === "completed"}
            >
              {session.status === "completed" ? "Ya completada" : (mutating ? "Guardando..." : "✓ Marcar como completada")}
            </button>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Reagendar</button>
              <button
                className="btn"
                style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }}
                onClick={() => onCancelSession(session)}
                disabled={mutating || session.status === "cancelled"}
              >
                {session.status === "cancelled" ? "Cancelada" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CALENDAR HELPERS ── */
const DOW = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
const HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00"];

function buildMonthGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ num: daysInPrev - startOffset + 1 + i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, current: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ num: i, current: false });
  return cells;
}

/* ── DAY VIEW ── */
function DayView({ selectedDay, setSelectedDay, onSelectSession, upcomingSessions, weekDays }) {
  const daySessions = upcomingSessions.filter(s => s.date === selectedDay);
  const curIdx = weekDays.findIndex(d => d.dateStr === selectedDay);
  const goDay = (delta) => { const next = weekDays[curIdx + delta]; if (next) setSelectedDay(next.dateStr); };
  const dayLabel = weekDays.find(d => d.dateStr === selectedDay);
  const sessionDates = new Set(upcomingSessions.map(s => s.date));

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 12px" }}>
        <button className="month-nav-btn" onClick={() => goDay(-1)} disabled={curIdx<=0} style={{ opacity: curIdx<=0?0.3:1 }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{dayLabel ? dayLabel.name : ""} {selectedDay}</div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>{daySessions.length===0 ? "Sin sesiones" : `${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
        </div>
        <button className="month-nav-btn" onClick={() => goDay(1)} disabled={curIdx>=weekDays.length-1} style={{ opacity: curIdx>=weekDays.length-1?0.3:1 }}>›</button>
      </div>
      <div style={{ paddingBottom:8 }}>
        <div className="cal-strip">
          {weekDays.map((d,i) => (
            <div key={i} className={`cal-day ${selectedDay===d.dateStr?"active":""} ${sessionDates.has(d.dateStr)?"has-sessions":""}`} onClick={() => setSelectedDay(d.dateStr)}>
              <span className="cal-day-name">{d.name}</span>
              <span className="cal-day-num">{d.num}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding:"4px 16px 12px" }}>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:32, textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🌿</div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>Día libre</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>No hay sesiones este día.</div>
            </div>
          : <div className="card">
              {daySessions.map(s => (
                <div className="row-item" key={s.id} onClick={() => onSelectSession(s)}>
                  <div style={{ width:44, textAlign:"center", flex:"none" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
                  </div>
                  <div className="row-avatar" style={{ background: clientColors[s.colorIdx], width:36, height:36, fontSize:11 }}>{s.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{s.patient}</div>
                    <div className="row-sub">{s.day}</div>
                  </div>
                  <span className={`session-status ${s.status==="scheduled"?"status-scheduled":s.status==="completed"?"status-completed":"status-cancelled"}`}>
                    {s.status==="scheduled"?"Agendada":s.status==="completed"?"Completada":"Cancelada"}
                  </span>
                  <span className="row-chevron">›</span>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDay, onSelectDay, setView, onSelectSession, upcomingSessions, weekDays }) {
  const hourIndex = (t) => parseInt(t.split(":")[0]) - 8;
  const todayStr = getTodayStr();

  return (
    <div>
      <div className="week-header-row">
        <div />
        {weekDays.map((d,i) => (
          <div key={i} className="week-day-head" style={{ cursor:"pointer" }} onClick={() => { onSelectDay(d.dateStr); setView("day"); }}>
            <span className="week-day-name">{d.name}</span>
            <span className={`week-day-num ${d.dateStr===selectedDay?"active":""} ${d.dateStr===todayStr&&d.dateStr!==selectedDay?"today":""}`}>{d.num}</span>
          </div>
        ))}
      </div>
      <div className="week-body">
        {HOURS.map((hour, hIdx) => (
          <div className="week-time-row" key={hour}>
            <div className="week-time-label">{hour}</div>
            {weekDays.map((d, dIdx) => {
              const sess = upcomingSessions.filter(s => s.date===d.dateStr).find(s => hourIndex(s.time)===hIdx);
              return (
                <div key={dIdx} className="week-cell" onClick={() => !sess && onSelectDay(d.dateStr)}>
                  {sess && (
                    <div className={`week-event ${sess.status==="cancelled"?"cancelled":""}`} onClick={e => { e.stopPropagation(); onSelectSession(sess); }}>
                      {sess.initials}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDay, onSelectDay, upcomingSessions }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const now = getToday();
  const base = new Date(now.getFullYear(), now.getMonth());
  base.setMonth(base.getMonth() + monthOffset);
  const displayMonth = base.getMonth();
  const displayYear  = base.getFullYear();
  const cells   = buildMonthGrid(displayYear, displayMonth);
  const displayMonthStr = shortMonths[displayMonth];

  // Filter sessions that belong to the displayed month
  const monthSessions = upcomingSessions.filter(s => {
    const parts = s.date.split(" ");
    return parts[1] === displayMonthStr;
  });
  const daySessions = monthSessions.filter(s => s.date === selectedDay);
  const sessionDays = useMemo(() => new Set(monthSessions.map(s => parseInt(s.date))), [monthSessions]);
  const selectedNum = parseInt(selectedDay);
  const isCurrentMonth = displayMonth === now.getMonth() && displayYear === now.getFullYear();

  return (
    <div>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => setMonthOffset(o => o-1)}>‹</button>
        <span className="month-title">{FULL_MONTH_NAMES[displayMonth]} {displayYear}</span>
        <button className="month-nav-btn" onClick={() => setMonthOffset(o => o+1)}>›</button>
      </div>
      <div className="month-grid">
        <div className="month-dow-row">{DOW.map(d => <div key={d} className="month-dow">{d}</div>)}</div>
        <div className="month-days-grid">
          {cells.map((cell, i) => {
            const isToday  = isCurrentMonth && cell.current && cell.num === now.getDate();
            const isActive = cell.current && cell.num === selectedNum && selectedDay.includes(displayMonthStr);
            const hasSess  = cell.current && sessionDays.has(cell.num);
            return (
              <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
                onClick={() => cell.current && onSelectDay(`${cell.num} ${displayMonthStr}`)}>
                <span className="month-cell-num">{cell.num}</span>
                {hasSess && <div className="month-dot" />}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <div className="section-title">{selectedDay}</div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)" }}>{daySessions.length===0?"Sin sesiones":`${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
        </div>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:6 }}>🌿</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>Día libre</div>
            </div>
          : <div className="card">
              {daySessions.map(s => (
                <div className="row-item" key={s.id} onClick={() => onSelectSession(s)}>
                  <div style={{ width:40, textAlign:"center", flex:"none" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
                  </div>
                  <div className="row-avatar" style={{ background: clientColors[s.colorIdx], width:34, height:34, fontSize:11 }}>{s.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{s.patient}</div>
                    <div className="row-sub">{s.day}</div>
                  </div>
                  <span className={`session-status ${s.status==="cancelled"?"status-cancelled":"status-scheduled"}`}>
                    {s.status==="cancelled"?"Cancelada":"Agendada"}
                  </span>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

/* ── AGENDA ── */
function Agenda({ upcomingSessions, onMarkSessionCompleted, onCancelSession, mutating }) {
  const [view, setView]               = useState("day");
  const [selectedDay, setSelectedDay] = useState(getTodayStr());
  const [selectedSession, setSelectedSession] = useState(null);
  const weekDays = useMemo(() => buildCurrentWeek(), []);

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div className="view-toggle">
          {[{k:"day",l:"Día"},{k:"week",l:"Semana"},{k:"month",l:"Mes"}].map(v => (
            <button key={v.k} className={`view-btn ${view===v.k?"active":""}`} onClick={() => setView(v.k)}>{v.l}</button>
          ))}
        </div>
      </div>
      {view==="day"   && <DayView   selectedDay={selectedDay} setSelectedDay={setSelectedDay} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} weekDays={weekDays} />}
      {view==="week"  && <WeekView  selectedDay={selectedDay} onSelectDay={setSelectedDay} setView={setView} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} weekDays={weekDays} />}
      {view==="month" && <MonthView selectedDay={selectedDay} onSelectDay={setSelectedDay} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      <SessionSheet
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
        onMarkCompleted={async (session) => {
          const ok = await onMarkSessionCompleted(session);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status:"completed" } : prev));
        }}
        onCancelSession={async (session) => {
          const ok = await onCancelSession(session);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status:"cancelled" } : prev));
        }}
        mutating={mutating}
      />
    </div>
  );
}

/* ── PATIENTS ── */

function Patients({ patients, onRecordPayment, onAddPatient, mutating }) {
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");
  const [sort, setSort]         = useState("name");
  const [selected, setSelected] = useState(null);

  const filters = [
    {k:"all",l:"Todos"},{k:"active",l:"Activos"},{k:"ended",l:"Finalizados"},
    {k:"owes",l:"Con saldo"},{k:"paid",l:"Al corriente"},
  ];
  const sorts = [
    {k:"name",l:"Nombre"},{k:"day",l:"Día de sesión"},
    {k:"sessions",l:"Sesiones"},{k:"rate",l:"Tarifa"},
  ];

  const applyFilter = (p) => {
    if (filter==="active") return p.status==="active";
    if (filter==="ended")  return p.status==="ended";
    if (filter==="owes")   return p.billed>p.paid;
    if (filter==="paid")   return p.billed<=p.paid;
    return true;
  };
  const applySort = (a,b) => {
    if (sort==="name")     return a.name.localeCompare(b.name);
    if (sort==="day")      return DAY_ORDER.indexOf(a.day)-DAY_ORDER.indexOf(b.day);
    if (sort==="sessions") return b.sessions-a.sessions;
    if (sort==="rate")     return b.rate-a.rate;
    return 0;
  };
  const filtered = patients.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && applyFilter(p)).sort(applySort);

  return (
    <div className="page">
      <div style={{ padding:"16px 16px 10px", display:"flex", gap:10 }}>
        <div className="search-bar" style={{ flex:1 }}>
          <span style={{ color:"var(--charcoal-xl)", fontSize:16 }}>⌕</span>
          <input placeholder="Buscar paciente…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width:"auto", minWidth:48, height:42, padding:"0 16px", fontSize:13, borderRadius:"var(--radius-pill)", boxShadow:"none" }} onClick={onAddPatient}>+ Nuevo</button>
      </div>
      <div className="filter-chips">
        {filters.map(f => <button key={f.k} className={`chip ${filter===f.k?"active":""}`} onClick={() => setFilter(f.k)}>{f.l}</button>)}
      </div>
      <div className="sort-row">
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{filtered.length} paciente{filtered.length!==1?"s":""}</span>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span className="sort-label">Ordenar:</span>
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {sorts.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
          </select>
        </div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        <div className="card">
          {filtered.length === 0
            ? <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin resultados</div>
            : filtered.map((p,i) => (
              <div className="row-item" key={p.id} onClick={() => setSelected(p)}>
                <div className="row-avatar" style={{ background: clientColors[i%clientColors.length] }}>{p.initials}</div>
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">{p.day} · {p.time}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5, flexShrink:0 }}>
                  <span className={`badge ${p.status==="active"?"badge-teal":"badge-gray"}`}>{p.status==="active"?"Activo":"Finalizado"}</span>
                  <span style={{ fontSize:11, color:"var(--charcoal-xl)", fontWeight:600 }}>{p.sessions} ses. · ${p.rate}/ses</span>
                </div>
                <span className="row-chevron">›</span>
              </div>
            ))
          }
        </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => setSelected(null)}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{selected.name}</span>
              <button className="sheet-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
                {[
                  { label:"Vendido", value:`$${selected.billed.toLocaleString()}` },
                  { label:"Cobrado", value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                  { label:"Saldo",   value:`$${(selected.billed-selected.paid).toLocaleString()}`, color: selected.billed>selected.paid?"var(--red)":"var(--charcoal-xl)" },
                ].map((s,i) => (
                  <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:s.color||"var(--charcoal)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {[
                { label:"Tutor",            value: selected.parent },
                { label:"Sesión regular",   value:`${selected.day} a las ${selected.time}` },
                { label:"Tarifa",           value:`$${selected.rate} por sesión` },
                { label:"Sesiones totales", value:`${selected.sessions} sesiones` },
                { label:"Estado",           value: selected.status==="active"?"Activo":"Finalizado" },
              ].map((row,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
              <div style={{ marginTop:20, display:"flex", flexDirection:"column", gap:10 }}>
                <button className="btn btn-primary" style={{ height:48 }} onClick={() => onRecordPayment(selected)} disabled={mutating}>
                  {mutating ? "Guardando..." : "💰 Registrar pago"}
                </button>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Ver sesiones</button>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Editar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── FINANCES ── */
function FinancesMiniChart({ data, valueKey, color }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="bar-chart">
      {data.map((d, i) => {
        const pct    = Math.round((d[valueKey] / max) * 100);
        const isLast = i === data.length - 1;
        return (
          <div className="bar-col" key={d.mes}>
            <div className="bar-val" style={{ color: isLast ? color : "var(--charcoal-xl)", fontSize: isLast ? 9 : 8 }}>
              {valueKey==="sesiones" ? d[valueKey] : `$${(d[valueKey]/1000).toFixed(1)}k`}
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ height:`${pct}%`, background: isLast ? color : "var(--cream-deeper)" }} />
            </div>
            <div className="bar-label" style={{ color: isLast ? color : undefined }}>{d.mes}</div>
          </div>
        );
      })}
    </div>
  );
}

function PagosTab({ payments, patients, onRecordPayment, mutating }) {
  const [groupByClient, setGroupByClient] = useState(false);
  const [filterMethod, setFilterMethod]   = useState("all");
  const [dateRange, setDateRange]         = useState("all"); // all | jan | feb

  // Enrich payments with a sort key (we use id as proxy for chronological order)
  const monthOrder = { "Ene":1, "Feb":2, "Mar":3, "Abr":4, "May":5, "Jun":6, "Jul":7, "Ago":8, "Sep":9, "Oct":10, "Nov":11, "Dic":12 };
  const parseDateKey = (dateStr) => {
    const [day, mon] = dateStr.split(" ");
    return (monthOrder[mon] || 0) * 100 + parseInt(day);
  };

  let filtered = [...payments];
  if (filterMethod !== "all") filtered = filtered.filter(p => p.method === filterMethod);
  if (dateRange === "jan")    filtered = filtered.filter(p => p.date.includes("Ene"));
  if (dateRange === "feb")    filtered = filtered.filter(p => p.date.includes("Feb"));
  filtered.sort((a,b) => parseDateKey(b.date)-parseDateKey(a.date));

  const totalFiltered = filtered.reduce((s,p) => s+p.amount, 0);

  // Group by client
  const grouped = {};
  filtered.forEach(p => {
    if (!grouped[p.patient]) grouped[p.patient] = [];
    grouped[p.patient].push(p);
  });

  const renderRow = (p, i) => {
    const patient = patients.find(pt => pt.name === p.patient);
    return (
      <div className="bal-row" key={p.id}>
        <div className="row-avatar" style={{ background: clientColors[(p.colorIdx||i)%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>
          {patient ? patient.initials : p.patient.slice(0,2).toUpperCase()}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          {!groupByClient && <div className="bal-name">{p.patient}</div>}
          <div className="bal-sub" style={{ display:"flex", alignItems:"center", gap:6, marginTop: groupByClient ? 0 : 2 }}>
            <span>{p.date}</span>
            <span style={{ width:3, height:3, borderRadius:"50%", background:"var(--charcoal-xl)", display:"inline-block" }} />
            <span>{p.method==="Transferencia" ? "🏦" : "💵"} {p.method}</span>
          </div>
        </div>
        <div className="bal-amt amount-paid">+${p.amount.toLocaleString()}</div>
      </div>
    );
  };

  return (
    <div style={{ padding:"0 16px" }}>
      {/* CTA */}
      <button className="btn btn-primary" style={{ marginBottom:14 }} onClick={() => onRecordPayment(null)} disabled={mutating}>
        {mutating ? "Guardando..." : "+ Registrar pago"}
      </button>

      {/* Controls */}
      <div className="card" style={{ padding:"12px 14px", marginBottom:14 }}>
        {/* Group toggle */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Agrupar por cliente</span>
          <button
            onClick={() => setGroupByClient(g => !g)}
            style={{ width:40, height:22, borderRadius:11, border:"none", cursor:"pointer", padding:2, background: groupByClient ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative" }}
          >
            <div style={{ width:18, height:18, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: groupByClient ? "translateX(18px)" : "translateX(0)", transition:"transform 0.2s" }} />
          </button>
        </div>
        {/* Method filter */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Método</span>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:2 }}>
            {[{k:"all",l:"Todos"},{k:"Transferencia",l:"🏦"},{k:"Efectivo",l:"💵"}].map(o => (
              <button key={o.k} onClick={() => setFilterMethod(o.k)}
                style={{ padding:"4px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: filterMethod===o.k ? "var(--white)" : "transparent", color: filterMethod===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: filterMethod===o.k ? "var(--shadow-sm)" : "none" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        {/* Date range */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Período</span>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:2 }}>
            {[{k:"all",l:"Todo"},{k:"jan",l:"Ene"},{k:"feb",l:"Feb"}].map(o => (
              <button key={o.k} onClick={() => setDateRange(o.k)}
                style={{ padding:"4px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: dateRange===o.k ? "var(--white)" : "transparent", color: dateRange===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: dateRange===o.k ? "var(--shadow-sm)" : "none" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{filtered.length} pago{filtered.length!==1?"s":""}</span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--green)" }}>+${totalFiltered.toLocaleString()}</span>
      </div>

      {/* List */}
      {filtered.length === 0
        ? <div className="card" style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin pagos en este período</div>
        : groupByClient
          ? Object.entries(grouped).map(([name, pList], gi) => {
              const total = pList.reduce((s,p)=>s+p.amount,0);
              return (
                <div key={name} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, paddingLeft:2 }}>
                    <span className="section-title" style={{ fontSize:13 }}>{name}</span>
                    <span style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--green)" }}>+${total.toLocaleString()}</span>
                  </div>
                  <div className="card">
                    {pList.map((p,i) => renderRow(p, gi*10+i))}
                  </div>
                </div>
              );
            })
          : <div className="card">{filtered.map((p,i) => renderRow(p,i))}</div>
      }

      {/* Pending */}
      <div style={{ marginTop:16 }}>
        <div className="section-title" style={{ marginBottom:10 }}>Pendientes de cobro</div>
        <div className="card">
          {patients.filter(p=>p.billed>p.paid).sort((a,b)=>(b.billed-b.paid)-(a.billed-a.paid)).map((p,i) => {
            const owed = p.billed-p.paid;
            return (
              <div className="bal-row" key={p.id}>
                <div className="row-avatar" style={{ background:clientColors[i%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="bal-name">{p.name}</div>
                  <div className="bal-sub">{p.day} · ${p.rate}/sesión</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div className="bal-amt amount-owe">-${owed.toLocaleString()}</div>
                  <button
                    style={{ padding:"5px 12px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-pill)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer", fontFamily:"var(--font)", whiteSpace:"nowrap" }}
                    onClick={() => onRecordPayment(p)}
                    disabled={mutating}
                  >
                    {mutating ? "..." : "Cobrar"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Finances({ patients, payments, onRecordPayment, mutating }) {
  const [tab, setTab] = useState("balances");
  const totalOwed     = patients.reduce((s,p) => s+Math.max(0,p.billed-p.paid), 0);
  const owingPatients = patients.filter(p => p.billed>p.paid);
  const monthlyData   = useMemo(() => computeMonthlyData(payments), [payments]);
  const currentMonth  = monthlyData.length > 0 ? monthlyData[monthlyData.length-1] : { mes: shortMonths[getToday().getMonth()], year: getToday().getFullYear(), cobrado: 0, sesiones: 0, pendiente: 0 };

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div className="fin-tab-row">
          {[{k:"balances",l:"Saldos"},{k:"pagos",l:"Pagos"},{k:"ingresos",l:"Ingresos"}].map(t => (
            <button key={t.k} className={`fin-tab ${tab===t.k?"active":""}`} onClick={() => setTab(t.k)}>{t.l}</button>
          ))}
        </div>
      </div>

      {/* BALANCES */}
      {tab==="balances" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:"0 16px 16px" }}>
            <div className="stat-tile">
              <div className="stat-tile-label">Por cobrar</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
              <div className="stat-tile-sub">{owingPatients.length} pacientes</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-label">Al corriente</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{patients.filter(p=>p.billed<=p.paid).length}</div>
              <div className="stat-tile-sub">pacientes</div>
            </div>
          </div>
          <div style={{ padding:"0 16px 8px" }}>
            <div className="section-title" style={{ marginBottom:10 }}>Saldo por paciente</div>
            <div className="card">
              {patients.filter(p=>p.billed>p.paid).sort((a,b)=>(b.billed-b.paid)-(a.billed-a.paid)).map((p,i) => {
                const owed = p.billed-p.paid;
                const pct  = Math.round((p.paid/p.billed)*100);
                return (
                  <div className="bal-row" key={p.id}>
                    <div className="row-avatar" style={{ background:clientColors[i%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="bal-name">{p.name}</div>
                      <div className="balance-bar" style={{ marginTop:5 }}><div className="balance-fill" style={{ width:`${pct}%`, background:"var(--teal)" }} /></div>
                      <div className="bal-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} de ${p.billed.toLocaleString()} · {pct}%</div>
                    </div>
                    <div className="bal-amt amount-owe">-${owed.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding:"16px 16px 0" }}>
            <div className="section-title" style={{ marginBottom:10 }}>Al corriente</div>
            <div className="card">
              {patients.filter(p=>p.billed<=p.paid).map((p,i) => (
                <div className="bal-row" key={p.id}>
                  <div className="row-avatar" style={{ background:clientColors[(i+4)%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                  <div style={{ flex:1 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">${p.paid.toLocaleString()} pagado</div>
                  </div>
                  <div className="bal-amt amount-paid">✓</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* INGRESOS */}
      {tab==="ingresos" && (
        <div style={{ padding:"0 16px" }}>
          <div className="card" style={{ padding:"16px 16px 12px", marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
              <div>
                <div className="stat-tile-label">Cobrado este mes</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:26, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.5px" }}>${currentMonth.cobrado.toLocaleString()}</div>
                <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>{getCurrentMonthLabel()}</div>
              </div>
              {monthlyData.length >= 2 && <span className="badge badge-green">+{Math.round(((currentMonth.cobrado-monthlyData[monthlyData.length-2].cobrado)/Math.max(1,monthlyData[monthlyData.length-2].cobrado))*100)}% vs {monthlyData[monthlyData.length-2].mes}</span>}
            </div>
            <FinancesMiniChart data={monthlyData} valueKey="cobrado" color="var(--teal)" />
          </div>
          <div className="section-title" style={{ marginBottom:10 }}>Historial mensual</div>
          <div className="card">
            {[...monthlyData].reverse().map((m) => (
              <div className="bal-row" key={m.mes}>
                <div style={{ width:36, height:36, background:"var(--teal-pale)", borderRadius:"var(--radius-sm)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"var(--teal-dark)" }}>{m.mes}</span>
                </div>
                <div style={{ flex:1 }}>
                  <div className="bal-name">{m.mes} {m.year}</div>
                  <div className="bal-sub">{m.sesiones} sesiones · ${m.pendiente.toLocaleString()} pendiente</div>
                </div>
                <div className="bal-amt" style={{ color:"var(--charcoal)" }}>${m.cobrado.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAGOS */}
      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={onRecordPayment} mutating={mutating} />}

    </div>
  );
}

/* ── SETTINGS ── */
function Settings({ session }) {
  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Usuario";
  const userEmail = session?.user?.email || "";
  const userInitial = userName[0]?.toUpperCase() || "U";

  const handleSignOut = async () => { await supabase.auth.signOut(); };

  const sections = [
    { label:"Mi práctica", rows:[
      { iconD:"M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z", bg:"var(--teal-pale)", color:"var(--teal-dark)", title:"Perfil profesional", sub:`${userName}` },
      { iconD:"M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6", bg:"var(--green-bg)", color:"var(--green)", title:"Moneda y precios",   sub:"MXN — Peso Mexicano" },
      { iconD:"M18 8A6 6 0 006 8c0 7-3 9-6 9s-6-2-6-9M13.73 21a2 2 0 01-3.46 0", bg:"var(--amber-bg)", color:"var(--amber)", title:"Recordatorios",      sub:"WhatsApp automático" },
    ]},
    { label:"Suscripción", rows:[
      { iconD:"M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z", bg:"var(--purple-bg)", color:"var(--purple)", title:"Plan actual",         sub:"Cardigan Pro · $199/mes" },
      { iconD:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8", bg:"var(--teal-pale)", color:"var(--teal-dark)", title:"Historial de pagos",  sub:"Ver facturas" },
    ]},
    { label:"Cuenta", rows:[
      { iconD:"M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4", bg:"var(--amber-bg)", color:"var(--amber)", title:"Cambiar contraseña", sub:"" },
      { iconD:ICONS.logout, bg:"var(--red-bg)", color:"var(--red)", title:"Cerrar sesión",       sub:"", danger:true, action: handleSignOut },
    ]},
  ];

  return (
    <div className="page">
      <div className="section" style={{ paddingTop:20 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <div style={{ width:52,height:52,background:"var(--teal)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-d)",fontSize:18,fontWeight:800,color:"white" }}>{userInitial}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-d)",fontSize:16,fontWeight:800,color:"var(--charcoal)" }}>{userName}</div>
              <div style={{ fontSize:12.5,color:"var(--charcoal-xl)",marginTop:2 }}>{userEmail}</div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize:13,height:34 }}>Editar</button>
          </div>
        </div>
      </div>
      {sections.map(s => (
        <div key={s.label}>
          <div className="settings-label">{s.label}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            {s.rows.map((r,i) => (
              <div className="settings-row" key={i} onClick={r.action} style={{ cursor:r.action?"pointer":undefined }}>
                <div className="settings-row-icon" style={{ background:r.bg }}><Icon d={r.iconD} size={18} color={r.color || "var(--charcoal)"} /></div>
                <div>
                  <div className="settings-row-title" style={{ color:r.danger?"var(--red)":undefined }}>{r.title}</div>
                  {r.sub && <div className="settings-row-sub">{r.sub}</div>}
                </div>
                <span className="settings-chevron">›</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ height:20 }} />
    </div>
  );
}

/* ── AUTH ── */
function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setAuthError(err.message || "Error de autenticación");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google" });
    if (error) setAuthError(error.message);
  };

  return (
    <div className="auth-screen">
      <div className="auth-header">
        <LogoMark size={48} color="white" />
        <div className="auth-wordmark">cardigan</div>
        <div className="auth-tagline">Gestiona tu práctica. Sin complicaciones.</div>
      </div>
      <form className="auth-body" onSubmit={handleSubmit}>
        <div className="auth-toggle">
          <button type="button" className={`auth-tab ${mode==="login"?"active":""}`} onClick={()=>{setMode("login");setAuthError("");}} >Entrar</button>
          <button type="button" className={`auth-tab ${mode==="signup"?"active":""}`} onClick={()=>{setMode("signup");setAuthError("");}} >Crear cuenta</button>
        </div>
        {mode==="signup" && (
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input className="input" placeholder="Daniela Kim" type="text" autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} required />
          </div>
        )}
        <div className="input-group">
          <label className="input-label">Correo electrónico</label>
          <input className="input" placeholder="tu@correo.com" type="email" autoComplete="email" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        </div>
        <div className="input-group">
          <label className="input-label">Contraseña</label>
          <input className="input" placeholder="••••••••" type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} />
        </div>
        {authError && (
          <div style={{ fontSize:13, color:"var(--red)", textAlign:"center", marginBottom:8 }}>{authError}</div>
        )}
        {mode==="login" && (
          <div style={{ textAlign:"right", marginBottom:18, marginTop:-6 }}>
            <button type="button" className="btn btn-ghost" style={{ height:36,fontSize:13,color:"var(--teal-dark)" }}>¿Olvidaste tu contraseña?</button>
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={authLoading}>
          {authLoading ? "Cargando..." : (mode==="login" ? "Entrar a Cardigan" : "Crear mi cuenta")}
        </button>
        {/* Google login disabled for now
        <div style={{ display:"flex", alignItems:"center", gap:12, margin:"16px 0" }}>
          <div style={{ flex:1, height:1, background:"var(--border)" }} />
          <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>o</span>
          <div style={{ flex:1, height:1, background:"var(--border)" }} />
        </div>
        <button type="button" className="btn btn-secondary" style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }} onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continuar con Google
        </button>
        */}
        {mode==="signup" && (
          <div style={{ textAlign:"center",fontSize:12,color:"var(--charcoal-xl)",marginTop:14,lineHeight:1.6 }}>
            Al registrarte aceptas los <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Términos</span> y la <span style={{ color:"var(--teal-dark)",fontWeight:700 }}>Política de privacidad</span>.
          </div>
        )}
      </form>
    </div>
  );
}

/* ── ADD PATIENT SHEET ── */
function AddPatientSheet({ open, onClose, onSubmit, mutating }) {
  const [name, setName] = useState("");
  const [parentGuardian, setParentGuardian] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [rate, setRate] = useState("700");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(""); setParentGuardian(""); setPhone(""); setEmail("");
    setRate("700"); setDay(""); setTime(""); setFormError("");
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setFormError("El nombre es obligatorio."); return; }
    setFormError("");
    const ok = await onSubmit({ name: name.trim(), parentGuardian, phone, email, rate: Number(rate) || 700, day, time });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflow:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nuevo paciente</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 24px" }}>
          <div className="input-group">
            <label className="input-label">Nombre completo *</label>
            <input className="input" placeholder="Nombre del paciente" value={name} onChange={e=>setName(e.target.value)} required />
          </div>
          <div className="input-group">
            <label className="input-label">Tutor / Responsable</label>
            <input className="input" placeholder="Nombre del tutor" value={parentGuardian} onChange={e=>setParentGuardian(e.target.value)} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Teléfono</label>
              <input className="input" placeholder="55 1234 5678" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Correo</label>
              <input className="input" placeholder="correo@ejemplo.com" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Tarifa por sesión</label>
            <input className="input" placeholder="700" type="number" min="0" value={rate} onChange={e=>setRate(e.target.value)} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Día de sesión</label>
              <select className="input" value={day} onChange={e=>setDay(e.target.value)}>
                <option value="">Seleccionar</option>
                {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Hora</label>
              <input className="input" placeholder="16:30" type="time" value={time} onChange={e=>setTime(e.target.value)} />
            </div>
          </div>
          {formError && <div style={{ fontSize:13, color:"var(--red)", marginBottom:10 }}>{formError}</div>}
          <button type="submit" className="btn btn-primary" style={{ height:48, marginTop:8 }} disabled={mutating}>
            {mutating ? "Guardando..." : "Agregar paciente"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── ADD SESSION SHEET ── */
function AddSessionSheet({ open, onClose, onSubmit, patients, mutating }) {
  const [patientId, setPatientId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPatientId(""); setNotes(""); setFormError("");
    // Default to today's date and a reasonable time
    const now = getToday();
    setDate(now.toISOString().split("T")[0]);
    setTime("");
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!patientId) { setFormError("Selecciona un paciente."); return; }
    if (!date) { setFormError("Selecciona una fecha."); return; }
    if (!time) { setFormError("Selecciona una hora."); return; }
    setFormError("");
    const ok = await onSubmit({ patientId, date, time, notes });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"90vh", overflow:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nueva sesión</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 24px" }}>
          <div className="input-group">
            <label className="input-label">Paciente *</label>
            <select className="input" value={patientId} onChange={e => setPatientId(e.target.value)} required>
              <option value="">Seleccionar paciente</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Fecha *</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Hora *</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} required />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">Notas</label>
            <input className="input" placeholder="Notas opcionales" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {formError && <div style={{ fontSize:13, color:"var(--red)", marginBottom:10 }}>{formError}</div>}
          <button type="submit" className="btn btn-primary" style={{ height:48, marginTop:8 }} disabled={mutating}>
            {mutating ? "Guardando..." : "Agendar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

function PaymentModal({
  open,
  onClose,
  patients,
  initialPatientName,
  initialAmount,
  onSubmit,
  mutating,
}) {
  const [patientName, setPatientName] = useState(initialPatientName || "");
  const [amount, setAmount] = useState(initialAmount || "");
  const [method, setMethod] = useState("Transferencia");
  const [date, setDate] = useState(formatShortDate());
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPatientName(initialPatientName || "");
    setAmount(initialAmount || "");
    setMethod("Transferencia");
    setDate(formatShortDate());
    setFormError("");
  }, [open, initialPatientName, initialAmount]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!patientName.trim()) {
      setFormError("Selecciona un paciente.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Ingresa un monto valido.");
      return;
    }
    setFormError("");
    const ok = await onSubmit({
      patientName: patientName.trim(),
      amount: parsedAmount,
      method,
      date,
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Registrar pago</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Paciente</label>
            <select className="input" value={patientName} onChange={(e) => setPatientName(e.target.value)}>
              <option value="">Seleccionar paciente</option>
              {patients.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Monto</label>
            <input className="input" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="700" />
          </div>
          <div className="input-group">
            <label className="input-label">Método</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="Transferencia">Transferencia</option>
              <option value="Efectivo">Efectivo</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Fecha</label>
            <input className="input" type="text" value={date} onChange={(e) => setDate(e.target.value)} placeholder="7 Abr" />
          </div>
          {formError && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Guardar pago"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── ROOT ── */
function getTopbarMeta(patients) {
  return {
    home:     { title:"Inicio" },
    agenda:   { title:"Agenda" },
    patients: { title:`Pacientes (${patients.length})` },
    finances: { title:"Finanzas" },
    settings: { title:"Ajustes" },
  };
}

export default function Cardigan() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen]       = useState("home");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  const {
    patients,
    upcomingSessions,
    payments,
    loading,
    error,
    mutating,
    mutationError,
    createPatient,
    createSession,
    createPayment,
    updateSessionStatus,
  } = useCardiganData(session);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ patientName:"", amount:"" });
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [addSessionOpen, setAddSessionOpen] = useState(false);

  const handleFab = () => {
    if (screen === "patients") setAddPatientOpen(true);
    else setAddSessionOpen(true);
  };

  const openRecordPaymentModal = (patient) => {
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(Math.max(0, patient.billed - patient.paid)) : "",
    });
    setPaymentModalOpen(true);
  };

  const handleMarkSessionCompleted = async (sess) => {
    if (!sess || sess.status === "completed") return true;
    return updateSessionStatus(sess.id, "completed");
  };

  const handleCancelSession = async (sess) => {
    if (!sess || sess.status === "cancelled") return true;
    return updateSessionStatus(sess.id, "cancelled");
  };

  const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Usuario";
  const userInitial = userName[0]?.toUpperCase() || "U";

  const screenMap = {
    home:     <Home setScreen={setScreen} patients={patients} upcomingSessions={upcomingSessions} payments={payments} onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    agenda:   <Agenda upcomingSessions={upcomingSessions} onMarkSessionCompleted={handleMarkSessionCompleted} onCancelSession={handleCancelSession} mutating={mutating} />,
    patients: <Patients patients={patients} onRecordPayment={openRecordPaymentModal} onAddPatient={() => setAddPatientOpen(true)} mutating={mutating} />,
    finances: <Finances patients={patients} payments={payments} onRecordPayment={openRecordPaymentModal} mutating={mutating} />,
    settings: <Settings session={session} />,
  };

  const topbarMeta = getTopbarMeta(patients);
  const meta = topbarMeta[screen] || topbarMeta.home;

  if (!authReady) {
    return (
      <>
        <style>{styles}</style>
        <div className="shell" style={{ alignItems:"center", justifyContent:"center" }}>
          <LogoMark size={36} />
        </div>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      {!session ? <AuthScreen /> : (
        <div className="shell">
          <div className="status-bar" />
          <div className="topbar">
            <div className="topbar-left">
              <button className={`hamburger ${drawerOpen?"open":""}`} onClick={() => setDrawerOpen(o=>!o)} aria-label="Menú">
                <div className="hamburger-line" />
                <div className="hamburger-line" />
                <div className="hamburger-line" />
              </button>
              <div className="topbar-center">
                <div className="topbar-title">{meta.title}</div>
                <div className="topbar-sub">{meta.sub}</div>
              </div>
            </div>
            <div className="topbar-right">
              <button className="icon-btn" onClick={() => setScreen("home")} aria-label="Inicio"><Icon d={ICONS.home} size={18} color="white" /></button>
              <div className="avatar-sm">{userInitial}</div>
            </div>
          </div>
          {loading && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--charcoal-xl)" }}>
              Cargando datos...
            </div>
          )}
          {!loading && error && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--amber)" }}>
              {error}
            </div>
          )}
          {!loading && mutationError && (
            <div style={{ padding:"10px 16px 0", fontSize:12, color:"var(--red)" }}>
              {mutationError}
            </div>
          )}
          {screenMap[screen]}
          <PaymentModal
            open={paymentModalOpen}
            onClose={() => setPaymentModalOpen(false)}
            patients={patients}
            initialPatientName={paymentDraft.patientName}
            initialAmount={paymentDraft.amount}
            onSubmit={createPayment}
            mutating={mutating}
          />
          <AddPatientSheet
            open={addPatientOpen}
            onClose={() => setAddPatientOpen(false)}
            onSubmit={createPatient}
            mutating={mutating}
          />
          <AddSessionSheet
            open={addSessionOpen}
            onClose={() => setAddSessionOpen(false)}
            onSubmit={createSession}
            patients={patients}
            mutating={mutating}
          />
          <button className="fab" aria-label="Agregar" onClick={handleFab}>+</button>
          {drawerOpen && <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)} session={session} />}
        </div>
      )}
    </>
  );
}
