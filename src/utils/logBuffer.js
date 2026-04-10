/* Captures console.error and console.warn into a ring buffer for bug reports. */

const MAX = 50;
const logs = [];

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

export function getLogs() {
  return [...logs];
}
