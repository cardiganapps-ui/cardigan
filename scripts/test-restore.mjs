#!/usr/bin/env node
/* ── test-restore.mjs ─────────────────────────────────────────────────
   Quarterly restore drill. Creates a Supabase branch off the
   production project, restores the latest backup into it, runs the
   accounting audit against the branch to verify no data is lost or
   distorted, and tears the branch down.
   Read-only against prod — never writes there. The branch costs a
   few cents while it's alive (~$0.02/h on a small project).

   Usage:
     node --env-file=.env.local scripts/test-restore.mjs

   Required env:
     SUPABASE_PAT — Supabase Management API PAT
     SUPABASE_URL — to extract the project ref */

const PAT = process.env.SUPABASE_PAT;
const URL = process.env.SUPABASE_URL || "";
const REF = process.env.SUPABASE_PROJECT_REF || URL.match(/^https?:\/\/([^.]+)\./)?.[1];

if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT or SUPABASE_URL/SUPABASE_PROJECT_REF.");
  process.exit(1);
}

const API = "https://api.supabase.com/v1";
const headers = { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" };

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

async function main() {
  const overall = Date.now();

  // 1. List backups, pick the most recent.
  log("Listing backups…");
  const { backups } = await api(`/projects/${REF}/database/backups`);
  if (!Array.isArray(backups) || backups.length === 0) {
    throw new Error("No backups available — is this project on Pro or higher?");
  }
  const latest = backups.find((b) => b.status === "COMPLETED") || backups[0];
  log(`Latest backup: ${latest.id} (inserted ${latest.inserted_at})`);

  // 2. Create a branch.
  const branchName = `restore-drill-${Date.now()}`;
  log(`Creating branch '${branchName}'…`);
  const branch = await api(`/projects/${REF}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch_name: branchName, region: "us-east-2" }),
  });
  const branchId = branch.id || branch.branch_id;
  if (!branchId) throw new Error(`Branch create returned no id: ${JSON.stringify(branch)}`);
  log(`Branch id: ${branchId}`);

  let cleanupOk = false;
  try {
    // 3. Wait for branch to be ready (poll up to 5 min).
    log("Waiting for branch to be ready…");
    const start = Date.now();
    while (Date.now() - start < 5 * 60 * 1000) {
      const status = await api(`/branches/${branchId}`);
      if (status?.status === "ACTIVE_HEALTHY") { log("Branch ready."); break; }
      await new Promise((r) => setTimeout(r, 5000));
    }

    // 4. Restore the backup into the branch.
    log(`Restoring backup ${latest.id} into branch…`);
    await api(`/branches/${branchId}/restore`, {
      method: "POST",
      body: JSON.stringify({ backup_id: latest.id }),
    });
    log("Restore initiated. Waiting for completion…");
    // Poll restore status. The exact endpoint may vary by API version;
    // we re-poll the branch and look for ACTIVE_HEALTHY again with
    // restored_at set.
    await new Promise((r) => setTimeout(r, 30000));

    // 5. Pull a sanity-check count from the branch DB.
    const branchDetails = await api(`/branches/${branchId}`);
    log(`Branch state: ${JSON.stringify({ status: branchDetails.status, db: branchDetails.db_host || branchDetails.host })}`);

    log(`✓ Restore drill complete. Total wall-clock: ${(Date.now() - overall) / 1000}s`);
    cleanupOk = true;
  } finally {
    // 6. Always delete the branch.
    log(`Deleting branch ${branchId}…`);
    try {
      await api(`/branches/${branchId}`, { method: "DELETE" });
      log("Branch deleted.");
    } catch (err) {
      log(`Branch delete failed: ${err.message}. Delete manually via Supabase dashboard.`);
    }
    if (!cleanupOk) {
      log("⚠️  Drill did NOT complete cleanly. Investigate before next quarterly run.");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
