/* Captures console.error and console.warn into a ring buffer for bug reports. */

const MAX = 50;
const logs = [];

const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /\+?\d[\d\s\-()]{7,}\d/g,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
];

function sanitize(message) {
  let s = message;
  for (const pattern of PII_PATTERNS) {
    s = s.replace(pattern, "[REDACTED]");
  }
  return s;
}

function push(level, args) {
  const message = args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ""}`;
    if (typeof a === "object") try { return JSON.stringify(a); } catch { return String(a); }
    return String(a);
  }).join(" ");
  logs.push({ level, message, timestamp: new Date().toISOString() });
  if (logs.length > MAX) logs.shift();
}

const origError = console.error;
const origWarn = console.warn;

console.error = (...args) => { push("error", args); origError.apply(console, args); };
console.warn = (...args) => { push("warn", args); origWarn.apply(console, args); };

// Capture uncaught errors and unhandled promise rejections so they show up
// in bug-report payloads even when the user didn't see a console message.
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    const msg = e.error ? `${e.message}\n${e.error.stack || ""}` : (e.message || "Uncaught error");
    push("error", [`[uncaught] ${msg}`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = r instanceof Error ? `${r.message}\n${r.stack || ""}` : String(r);
    push("error", [`[unhandled-rejection] ${msg}`]);
  });
}

export function getLogs() {
  return logs.map(l => ({ ...l, message: sanitize(l.message) }));
}
