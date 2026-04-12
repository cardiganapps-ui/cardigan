import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Create .env.local with both vars, then run:");
  console.error("  node --env-file=.env.local scripts/bugs.js list");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// ── Helpers ──

function ago(dateStr) {
  if (!dateStr) return "";
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en", { day: "numeric", month: "short" });
}

function truncate(str, len = 60) {
  if (!str) return "(no description)";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function isUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function fmtLogs(logs) {
  if (!logs) return "(none)";
  const arr = typeof logs === "string" ? JSON.parse(logs) : logs;
  if (!Array.isArray(arr) || arr.length === 0) return "(none)";
  return arr.map(l => {
    const ts = l.timestamp ? new Date(l.timestamp).toLocaleTimeString("en", { hour12: false }) : "";
    return `  [${l.level || "?"}] ${ts} ${l.message || ""}`;
  }).join("\n");
}

// ── Commands ──

async function list() {
  const { data, error } = await sb
    .from("bug_reports")
    .select("id, created_at, user_email, screen, description")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.error("Error:", error.message); process.exit(1); }
  if (!data || data.length === 0) { console.log("No bug reports found."); return; }

  console.log(`\n  ${data.length} bug report(s)\n`);
  for (const r of data) {
    console.log(`  ${r.id}`);
    console.log(`    ${ago(r.created_at)}  |  ${r.user_email || "anonymous"}  |  ${r.screen || "?"}`);
    console.log(`    ${truncate(r.description)}`);
    console.log();
  }
}

async function show(id) {
  if (!id || !isUUID(id)) { console.error("Usage: bugs show <uuid>"); process.exit(1); }
  const { data, error } = await sb.from("bug_reports").select("*").eq("id", id).single();
  if (error) { console.error(error.code === "PGRST116" ? `No report with id ${id}` : `Error: ${error.message}`); process.exit(1); }

  console.log(`\n  Bug Report ${data.id}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Created:     ${data.created_at ? new Date(data.created_at).toLocaleString("en") : "?"}`);
  console.log(`  Email:       ${data.user_email || "anonymous"}`);
  console.log(`  Screen:      ${data.screen || "?"}`);
  console.log(`  User Agent:  ${data.user_agent || "?"}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Description:`);
  console.log(`  ${data.description || "(none)"}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  Console Logs:`);
  console.log(fmtLogs(data.logs));
  console.log();
}

async function del(id) {
  if (!id || !isUUID(id)) { console.error("Usage: bugs delete <uuid>"); process.exit(1); }
  const { data } = await sb.from("bug_reports").select("id, description").eq("id", id).single();
  if (!data) { console.error(`No report with id ${id}`); process.exit(1); }
  const { error } = await sb.from("bug_reports").delete().eq("id", id);
  if (error) { console.error("Error:", error.message); process.exit(1); }
  console.log(`Deleted: ${truncate(data.description)}`);
}

async function clear() {
  const { count } = await sb.from("bug_reports").select("*", { count: "exact", head: true });
  if (!count) { console.log("No bug reports to delete."); return; }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => rl.question(`Delete all ${count} bug report(s)? (y/N) `, resolve));
  rl.close();

  if (answer.trim().toLowerCase() !== "y") { console.log("Cancelled."); return; }

  const { error } = await sb.from("bug_reports").delete().not("id", "is", null);
  if (error) { console.error("Error:", error.message); process.exit(1); }
  console.log(`Deleted ${count} bug report(s).`);
}

// ── Main ──

const USAGE = `
  Bug Reports CLI

  Usage: npm run bugs -- <command> [args]

  Commands:
    list              List all bug reports
    show <id>         Show full details of a report
    delete <id>       Delete a single report
    clear             Delete all reports (with confirmation)
`;

const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case "list":   await list(); break;
  case "show":   await show(arg); break;
  case "delete": await del(arg); break;
  case "clear":  await clear(); break;
  default:       console.log(USAGE);
}
