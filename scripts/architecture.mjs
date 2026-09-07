#!/usr/bin/env node
// architecture.mjs — draws docs/system-map.md from this repo's own files.
//
// Copied from the guide's templates/scripts/. No placeholders.
//
// WHY THIS EXISTS. A hand-drawn architecture diagram is wrong the first time
// someone renames a workflow and does not redraw it, and nothing catches that.
// This reads the files that ARE the architecture and renders them, so the
// picture cannot disagree with the repo: if it does, this script is broken and
// the `architecture-current` CI job fails.
//
// COMMITTED FILES ONLY — never .claude/scope.json.
//   scope.json is gitignored (Part 2, step 5's scaffold prompt), so CI cannot read
//   it. A generator that read it would draw one graph locally and a different one
//   in CI. Everything scope would tell us is already in a committed file:
//     environments   -> do deploy-staging.yml / gate-main.yml exist?
//     build dir      -> wrangler.jsonc
//     PR target      -> the branches: trigger in deploy-preview.yml
//   And the guide's own rule for a scope/repo disagreement is "the files are
//   the fact" (CLAUDE.md, app-mismatched).
//
// Output is deterministic: every list is sorted before rendering, so a rerun on
// an unchanged repo produces a byte-identical file.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "docs", "system-map.md");
const NOTES = join(ROOT, ".claude", "architecture-notes.json");

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const lsdir = (p) => { try { return readdirSync(p).sort(); } catch { return []; } };
const has = (p) => existsSync(join(ROOT, p));

// Mermaid node ids must be plain; labels must not carry raw quotes or newlines.
const id = (s) => "n_" + s.replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
const lbl = (s) => String(s).replace(/"/g, "'").replace(/\s+/g, " ").trim();

// External services, recognised by the credential names a workflow reads.
// A name is evidence; a guess is not. Anything unrecognised that still looks
// like a credential is reported under its own prefix rather than dropped.
const SERVICES = [
  [/^GEMINI_/, "Google Gemini"], [/^ANTHROPIC_/, "Anthropic"], [/^OPENAI_/, "OpenAI"],
  [/^TELEGRAM_/, "Telegram"], [/^STRIPE_/, "Stripe"], [/^SLACK_/, "Slack"],
  [/^RESEND_|^SENDGRID_|^POSTMARK_/, "Email provider"], [/^TWILIO_/, "Twilio"],
  [/^CLOUDFLARE_|^CF_/, "Cloudflare API"], [/^SUPABASE_/, "Supabase"],
];
const serviceFor = (name) => {
  for (const [re, label] of SERVICES) if (re.test(name)) return label;
  if (/_(API_KEY|TOKEN|SECRET|KEY)$/.test(name)) return name.replace(/_(API_KEY|TOKEN|SECRET|KEY)$/, "").replace(/_/g, " ");
  return null;
};

const provenance = [];   // [node, fact, source file]
const note = (n, f, src) => provenance.push([n, f, src]);

// ---------------------------------------------------------------------------
// wrangler.jsonc — JSONC, so strip comments before parsing. Line comments only
// outside strings; block comments anywhere. Trailing commas are legal in JSONC.
// ---------------------------------------------------------------------------
function readWrangler() {
  const raw = read(join(ROOT, "wrangler.jsonc")) ?? read(join(ROOT, "wrangler.json"));
  if (!raw) return null;
  let out = "", inStr = false, inLine = false, inBlock = false, prev = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], nx = raw[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === "/" && prev === "*") inBlock = false; prev = c; continue; }
    if (inStr) { out += c; if (c === '"' && prev !== "\\") inStr = false; prev = prev === "\\" && c === "\\" ? "" : c; continue; }
    if (c === '"') { inStr = true; out += c; prev = c; continue; }
    if (c === "/" && nx === "/") { inLine = true; i++; continue; }
    if (c === "/" && nx === "*") { inBlock = true; i++; prev = ""; continue; }
    out += c; prev = c;
  }
  out = out.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(out); } catch { return { __unparsed: true }; }
}

// ---------------------------------------------------------------------------
// Workflows. No YAML dependency: extract only the keys this needs, by
// indentation. Anything not understood is reported, never guessed.
// ---------------------------------------------------------------------------
function readWorkflows() {
  const dir = join(ROOT, ".github", "workflows");
  return lsdir(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => {
      const src = `.github/workflows/${f}`;
      const text = read(join(dir, f)) ?? "";
      const lines = text.split("\n");
      const jobs = [];
      const triggers = new Set();
      const branches = new Set();
      const crons = [];
      let sect = null, jobsIndent = null;

      for (const line of lines) {
        if (/^\s*#/.test(line) || !line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        const top = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line);
        if (indent === 0 && top) { sect = top[1]; if (sect === "jobs") jobsIndent = null; continue; }

        if (sect === "jobs") {
          const m = /^(\s+)([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
          if (m) {
            const ind = m[1].length;
            if (jobsIndent === null) jobsIndent = ind;
            if (ind === jobsIndent) jobs.push(m[2]);
          }
          continue;
        }
        if (sect === "on") {
          // Only a key at indent 2 is a trigger. `branches:`, `paths:` and
          // `inputs:` sit deeper and are NOT triggers — the first version of
          // this reported "on: branches, paths, push" for a plain push hook.
          const t = /^\s+([a-z_]+):/.exec(line);
          if (t && indent === 2) triggers.add(t[1]);
          const b = /branches:\s*\[([^\]]*)\]/.exec(line);
          if (b) b[1].split(",").forEach((x) => x.trim() && branches.add(x.trim().replace(/['"]/g, "")));
          const b2 = /^\s+-\s*['"]?([A-Za-z0-9_./*-]+)['"]?\s*$/.exec(line);
          if (b2 && /branches/.test(lines[lines.indexOf(line) - 1] ?? "")) branches.add(b2[1]);
          const c = /cron:\s*['"]([^'"]+)['"]/.exec(line);
          if (c) crons.push(c[1]);
        }
      }
      // `on: [push]` / `on: push` inline forms
      const inlineOn = /^on:\s*(\[.*\]|[a-z_]+)\s*$/m.exec(text);
      if (inlineOn) String(inlineOn[1]).replace(/[[\]]/g, "").split(",").forEach((x) => x.trim() && triggers.add(x.trim()));

      // What a workflow TOUCHES is read from its body, never guessed from its
      // name. kwook-demo has a wrangler.jsonc and five workflows, none of which
      // mention Cloudflare — guessing by filename drew a deploy edge that does
      // not exist.
      const deploysHost = /wrangler|cloudflare\/wrangler-action|pages\s+deploy/i.test(text);
      const touchesDb = /supabase\/setup-cli|supabase\s+db\s+push|supabase\s+migration/i.test(text);
      const refs = [...new Set([...text.matchAll(/(?:secrets|vars)\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))].sort();
      return {
        file: f, src, jobs: [...new Set(jobs)].sort(), triggers: [...triggers].sort(),
        branches: [...branches].sort(), crons: crons.sort(), deploysHost, touchesDb, refs,
      };
    });
}

// ---------------------------------------------------------------------------
// Migrations. Tables, foreign keys, RLS. Reports RLS as on/off only — a policy's
// actual logic is not something a regex can honestly claim to have read.
// ---------------------------------------------------------------------------
function readSchema() {
  const dir = join(ROOT, "supabase", "migrations");
  const files = lsdir(dir).filter((f) => f.endsWith(".sql"));
  const tables = new Map();   // name -> { rls, policies, src }
  const fks = [];
  const buckets = new Set();

  const bare = (t) => t.replace(/^public\./i, "").replace(/["`]/g, "").trim();

  for (const f of files) {
    const sql = (read(join(dir, f)) ?? "").replace(/--[^\n]*/g, "");
    const src = `supabase/migrations/${f}`;

    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)\s*\(/gi)) {
      const t = bare(m[1]);
      if (!tables.has(t)) tables.set(t, { rls: false, policies: 0, src });
      // Foreign keys declared inside this CREATE TABLE body.
      const body = sql.slice(m.index, sql.indexOf(";", m.index));
      for (const r of body.matchAll(/references\s+([A-Za-z0-9_."]+)/gi)) {
        const to = bare(r[1]); if (to !== t) fks.push([t, to, src]);
      }
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([A-Za-z0-9_."]+)[\s\S]{0,80}?enable\s+row\s+level\s+security/gi)) {
      const t = bare(m[1]); if (!tables.has(t)) tables.set(t, { rls: false, policies: 0, src });
      tables.get(t).rls = true;
    }
    for (const m of sql.matchAll(/create\s+policy[\s\S]{0,200}?\son\s+([A-Za-z0-9_."]+)/gi)) {
      const t = bare(m[1]); if (tables.get(t)) tables.get(t).policies++;
    }
    // ALTER TABLE x ADD CONSTRAINT ... REFERENCES y
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([A-Za-z0-9_."]+)[\s\S]{0,300}?references\s+([A-Za-z0-9_."]+)/gi)) {
      const from = bare(m[1]), to = bare(m[2]); if (from !== to) fks.push([from, to, src]);
    }
    for (const m of sql.matchAll(/storage\.buckets[\s\S]{0,200}?values\s*\(\s*'([^']+)'/gi)) buckets.add(m[1]);
  }
  const seen = new Set();
  const uniqFks = fks.filter(([a, b]) => { const k = a + ">" + b; if (seen.has(k) || !tables.has(a) || !tables.has(b)) return false; seen.add(k); return true; });
  return { tables, fks: uniqFks.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1])), buckets: [...buckets].sort(), count: files.length };
}

// ---------------------------------------------------------------------------
// Annotations: the only hand-written input. A note whose node no longer exists
// means the architecture moved and the note did not — that is an error, not a
// warning, because a stale note is the one thing here that can lie.
// ---------------------------------------------------------------------------
function readNotes(validIds) {
  const raw = read(NOTES);
  if (!raw) return { notes: {}, orphans: [] };
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch { return { notes: {}, orphans: ["(file is not valid JSON)"] }; }
  const notes = parsed.nodes ?? {};
  const orphans = Object.keys(notes).filter((k) => !validIds.has(k)).sort();
  return { notes, orphans };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const w = readWrangler();
const wf = readWorkflows();
const db = readSchema();

const pkgRaw = read(join(ROOT, "package.json"));
const pkg = pkgRaw ? (() => { try { return JSON.parse(pkgRaw); } catch { return {}; } })() : {};
const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).sort();

const hostName = w?.name ?? "(unnamed)";
const isPages = !!w?.pages_build_output_dir;
const buildDir = w?.pages_build_output_dir ?? w?.assets?.directory ?? null;
const entry = w?.main ?? null;
const crons = w?.triggers?.crons ?? [];
const bindingKinds = [
  ["kv_namespaces", "KV"], ["r2_buckets", "R2"], ["d1_databases", "D1"],
  ["queues", "Queues"], ["durable_objects", "Durable Object"], ["hyperdrive", "Hyperdrive"],
  ["vectorize", "Vectorize"], ["ai", "Workers AI"], ["analytics_engine_datasets", "Analytics Engine"],
];

const hasStaging = wf.some((f) => /deploy-staging\.ya?ml/.test(f.file));
const hasGateMain = wf.some((f) => /gate-main\.ya?ml/.test(f.file));
const environments = hasStaging && hasGateMain ? "staging + main" : "main only";
const allBranches = [...new Set(wf.flatMap((f) => f.branches))].sort();

const validIds = new Set();
const L = [];
const P = (s = "") => L.push(s);

P("# Architecture");
P();
P("> **Generated file — do not hand-edit.** `scripts/architecture.mjs` draws this");
P("> from the repo's own committed files. To change the picture, change the files");
P("> it reads; the next CI run redraws it. The `architecture-current` job fails if");
P("> this file and the repo disagree.");
P();
P(`Derived from **${wf.length}** workflow file(s), **${db.count}** migration(s), and \`wrangler.jsonc\`.`);
P("Nothing here is read from `.claude/scope.json` — that file is gitignored, so CI");
P("cannot see it. Where scope and the repo would disagree, the files are the fact.");
P();

// --- Deploy path -----------------------------------------------------------
P("## Deploy path");
P();
P(`Environments detected: **${environments}**` + (allBranches.length ? ` \u00b7 branches referenced by workflows: ${allBranches.map((b) => "`" + b + "`").join(", ")}` : ""));
P();
const deployers = wf.filter((f) => f.deploysHost);
const dbWriters = wf.filter((f) => f.touchesDb);
if (!deployers.length) {
  P(`> \u26a0 **No workflow in this repo deploys \`${lbl(hostName)}\`.** Nothing here references`);
  P("> wrangler or the Cloudflare API, so the deploy is happening outside GitHub Actions");
  P("> (a platform Git integration, or by hand). The guide's model is that Actions runs");
  P("> every deploy \u2014 see `docs/02-set-it-up.md` step 8. No edge is drawn for a deploy");
  P("> path that does not exist in these files.");
  P();
}
P("```mermaid");
P("graph LR");
const emitted = new Set();
const node = (n, label) => { if (emitted.has(n)) return n; emitted.add(n); validIds.add(n); P(`  ${n}["${lbl(label)}"]`); return n; };
const edge = (a, b, l) => P(`  ${a} -->${l ? `|${lbl(l)}|` : ""} ${b}`);

const prTarget = (wf.find((f) => /deploy-preview/.test(f.file))?.branches ?? [])[0]
  ?? (hasStaging ? "staging" : allBranches.includes("main") ? "main" : "main");
node(id("dev"), "Claude Code\u2003claude/\u2026 branch");
node(id("pr"), `Pull request \u2192 ${prTarget}`);
edge(id("dev"), id("pr"));

for (const f of wf) {
  const n = node(id("wf_" + f.file), `${f.file}\u2003(${f.triggers.join(", ") || "no trigger parsed"})\u2003${f.jobs.join(" \u00b7 ") || "no jobs parsed"}`);
  note(f.file, `jobs: ${f.jobs.join(" \u00b7 ") || "none"}; on: ${f.triggers.join(", ") || "unparsed"}${f.deploysHost ? "; deploys host" : ""}${f.touchesDb ? "; applies migrations" : ""}`, f.src);
  if (f.triggers.includes("pull_request")) edge(id("pr"), n);
  if (f.triggers.includes("push")) { const b = f.branches[0] ?? "main"; edge(node(id("branch_" + b), `branch: ${b}`), n, "push"); }
  if (f.triggers.includes("schedule")) edge(node(id("cron_" + f.file), `cron ${f.crons.join(" | ") || "(schedule)"}`), n);
  if (f.triggers.includes("workflow_dispatch") && f.triggers.length === 1) edge(node(id("manual"), "Manual / dispatch"), n);
}
node(id("host"), `${hostName}\u2003Cloudflare ${isPages ? "Pages" : "Workers"}`);
for (const f of deployers) edge(id("wf_" + f.file), id("host"), "deploy");
if (dbWriters.length) { node(id("supabase"), "Supabase\u2003Postgres"); for (const f of dbWriters) edge(id("wf_" + f.file), id("supabase"), "migrate"); }
P("```");
P();

// --- Runtime ---------------------------------------------------------------
P("## Runtime");
P();
P("```mermaid");
P("graph LR");
emitted.clear();
node(id("browser"), "Browser");
node(id("host"), `${hostName}\u2003Cloudflare ${isPages ? "Pages" : "Workers"}${buildDir ? `\u2003serves ${buildDir}` : ""}`);
edge(id("browser"), id("host"));
note(hostName, `Cloudflare ${isPages ? "Pages" : "Workers"}${buildDir ? `, build dir ${buildDir}` : ""}${entry ? `, entry ${entry}` : ""}`, "wrangler.jsonc");
if (entry) edge(id("host"), node(id("entry"), entry));
for (const [key, label] of bindingKinds) {
  const v = w?.[key]; if (!v) continue;
  (Array.isArray(v) ? v : [v]).forEach((b, i) => {
    const nm = b?.binding ?? b?.name ?? `${label}${i || ""}`;
    edge(id("host"), node(id("bind_" + label + "_" + nm), `${label}: ${nm}`));
    note(`${label} ${nm}`, "binding", "wrangler.jsonc");
  });
}
if (crons.length) edge(node(id("wcron"), `Cron trigger ${crons.join(" | ")}`), id("host"));
if (has("src/lib/supabaseClient.ts") || deps.includes("@supabase/supabase-js")) {
  edge(id("host"), node(id("supabase"), "Supabase\u2003Postgres + Auth + Storage"), "read");
  note("Supabase", "@supabase/supabase-js present", has("src/lib/supabaseClient.ts") ? "src/lib/supabaseClient.ts" : "package.json");
}
// Background jobs are part of the runtime too: a scheduled workflow that reads
// a credential is a live integration, not CI.
for (const f of wf) {
  const svcs = [...new Set(f.refs.map(serviceFor).filter(Boolean))].sort();
  if (!svcs.length) continue;
  const j = node(id("job_" + f.file), `${f.file}\u2003(GitHub Actions)`);
  for (const svc of svcs) {
    // Supabase already has a node from the client detection above; a second
    // "svc_Supabase" would draw the same system twice.
    const target = svc === "Supabase" ? node(id("supabase"), "Supabase\u2003Postgres + Auth + Storage") : node(id("svc_" + svc), svc);
    edge(j, target, "writes");
    note(svc, `credential read by ${f.file}`, f.src);
  }
}
P("```");
P();

// --- Data ------------------------------------------------------------------
P("## Data");
P();
if (db.tables.size === 0) {
  P("_No `CREATE TABLE` found in `supabase/migrations/`._");
} else {
  const noRls = [...db.tables].filter(([, v]) => !v.rls).map(([k]) => k).sort();
  P(`**${db.tables.size}** table(s) across **${db.count}** migration(s). RLS is reported on/off only — a regex cannot honestly claim to have read a policy's logic.`);
  P();
  if (noRls.length) P(`⚠ **No \`ENABLE ROW LEVEL SECURITY\` found for:** ${noRls.map((t) => "`" + t + "`").join(", ")}`);
  P();
  P("```mermaid");
  P("graph TD");
  for (const [t, v] of [...db.tables].sort((a, b) => a[0].localeCompare(b[0]))) {
    const n = id("tbl_" + t); validIds.add(n);
    P(`  ${n}["${lbl(t)}<br/><small>${v.rls ? "RLS on" : "RLS NOT enabled"}${v.policies ? ` · ${v.policies} policy` : ""}</small>"]`);
    note(t, `table; ${v.rls ? "RLS on" : "RLS not enabled"}`, v.src);
  }
  for (const [from, to] of db.fks) P(`  ${id("tbl_" + from)} -->|fk| ${id("tbl_" + to)}`);
  P("```");
  if (db.buckets.length) { P(); P(`Storage buckets: ${db.buckets.map((b) => "`" + b + "`").join(", ")}`); }
}
P();

// --- Notes -----------------------------------------------------------------
const { notes, orphans } = readNotes(validIds);
if (Object.keys(notes).length) {
  P("## Notes");
  P();
  P("The only hand-written input, from `.claude/architecture-notes.json`. One sentence each;");
  P("anything longer belongs in the decision log.");
  P();
  for (const k of Object.keys(notes).sort()) P(`- \`${k}\` — ${lbl(notes[k])}`);
  P();
}

// --- Provenance ------------------------------------------------------------
P("## Where each fact came from");
P();
P("| Node | Fact | Source |");
P("|---|---|---|");
for (const [n, f, s] of provenance.sort((a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2]))) P(`| ${lbl(n)} | ${lbl(f)} | \`${s}\` |`);
P();

const output = L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

// --- Modes -----------------------------------------------------------------
const check = process.argv.includes("--check");
if (orphans.length) {
  console.error("architecture: notes reference nodes that no longer exist:");
  orphans.forEach((o) => console.error("  - " + o));
  console.error("Fix .claude/architecture-notes.json — a note for a node that is gone is the one thing here that can lie.");
  process.exit(1);
}
if (check) {
  const current = read(OUT);
  if (current === output) { console.log("architecture: docs/system-map.md is current."); process.exit(0); }
  console.error("architecture: docs/system-map.md is stale.");
  console.error("Run `node scripts/architecture.mjs` and commit the result.");
  if (current === null) console.error("(the file does not exist yet)");
  process.exit(1);
}
writeFileSync(OUT, output);
console.log(`architecture: wrote ${relative(ROOT, OUT)} (${output.split("\n").length} lines, ${provenance.length} facts).`);
