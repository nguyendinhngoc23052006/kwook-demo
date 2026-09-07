# Architecture

> **Generated file — do not hand-edit.** `scripts/architecture.mjs` draws this
> from the repo's own committed files. To change the picture, change the files
> it reads; the next CI run redraws it. The `architecture-current` job fails if
> this file and the repo disagree.

Derived from **5** workflow file(s), **16** migration(s), and `wrangler.jsonc`.
Nothing here is read from `.claude/scope.json` — that file is gitignored, so CI
cannot see it. Where scope and the repo would disagree, the files are the fact.

## Deploy path

Environments detected: **main only** · branches referenced by workflows: `main`

> ⚠ **No workflow in this repo deploys `kwook-demo`.** Nothing here references
> wrangler or the Cloudflare API, so the deploy is happening outside GitHub Actions
> (a platform Git integration, or by hand). The guide's model is that Actions runs
> every deploy — see `docs/02-set-it-up.md` step 8. No edge is drawn for a deploy
> path that does not exist in these files.

```mermaid
graph LR
  n_dev["Claude Code claude/… branch"]
  n_pr["Pull request → main"]
  n_dev --> n_pr
  n_wf_ci_yml["ci.yml (pull_request, push) architecture-current · lint · tests · typecheck"]
  n_pr --> n_wf_ci_yml
  n_branch_main["branch: main"]
  n_branch_main -->|push| n_wf_ci_yml
  n_wf_migrate_yml["migrate.yml (push, workflow_dispatch) migrate"]
  n_branch_main -->|push| n_wf_migrate_yml
  n_wf_probe_yml["probe.yml (workflow_dispatch) probe"]
  n_manual["Manual / dispatch"]
  n_manual --> n_wf_probe_yml
  n_wf_sweep_watchdog_yml["sweep-watchdog.yml (schedule, workflow_dispatch) watchdog"]
  n_cron_sweep_watchdog_yml["cron 8,23,38,53 * * * *"]
  n_cron_sweep_watchdog_yml --> n_wf_sweep_watchdog_yml
  n_wf_sweep_yml["sweep.yml (workflow_dispatch) sweep"]
  n_manual --> n_wf_sweep_yml
  n_host["kwook-demo Cloudflare Pages"]
  n_supabase["Supabase Postgres"]
  n_wf_migrate_yml -->|migrate| n_supabase
```

## Runtime

```mermaid
graph LR
  n_browser["Browser"]
  n_host["kwook-demo Cloudflare Pages serves ./dist"]
  n_browser --> n_host
  n_supabase["Supabase Postgres + Auth + Storage"]
  n_host -->|read| n_supabase
  n_job_migrate_yml["migrate.yml (GitHub Actions)"]
  n_job_migrate_yml -->|writes| n_supabase
  n_job_sweep_watchdog_yml["sweep-watchdog.yml (GitHub Actions)"]
  n_svc_Telegram["Telegram"]
  n_job_sweep_watchdog_yml -->|writes| n_svc_Telegram
  n_job_sweep_yml["sweep.yml (GitHub Actions)"]
  n_svc_Google_Gemini["Google Gemini"]
  n_job_sweep_yml -->|writes| n_svc_Google_Gemini
  n_job_sweep_yml -->|writes| n_supabase
  n_job_sweep_yml -->|writes| n_svc_Telegram
```

## Data

**8** table(s) across **16** migration(s). RLS is reported on/off only — a regex cannot honestly claim to have read a policy's logic.

```mermaid
graph TD
  n_tbl_events["events<br/><small>RLS on</small>"]
  n_tbl_listing_urls["listing_urls<br/><small>RLS on</small>"]
  n_tbl_observations["observations<br/><small>RLS on</small>"]
  n_tbl_products["products<br/><small>RLS on</small>"]
  n_tbl_resolution_proposals["resolution_proposals<br/><small>RLS on · 1 policy</small>"]
  n_tbl_rules["rules<br/><small>RLS on</small>"]
  n_tbl_sources["sources<br/><small>RLS on</small>"]
  n_tbl_sweeps["sweeps<br/><small>RLS on</small>"]
  n_tbl_events -->|fk| n_tbl_listing_urls
  n_tbl_events -->|fk| n_tbl_products
  n_tbl_events -->|fk| n_tbl_rules
  n_tbl_events -->|fk| n_tbl_sweeps
  n_tbl_listing_urls -->|fk| n_tbl_products
  n_tbl_listing_urls -->|fk| n_tbl_sources
  n_tbl_observations -->|fk| n_tbl_listing_urls
  n_tbl_observations -->|fk| n_tbl_sweeps
  n_tbl_resolution_proposals -->|fk| n_tbl_listing_urls
  n_tbl_resolution_proposals -->|fk| n_tbl_products
  n_tbl_resolution_proposals -->|fk| n_tbl_sweeps
```

## Where each fact came from

| Node | Fact | Source |
|---|---|---|
| ci.yml | jobs: architecture-current · lint · tests · typecheck; on: pull_request, push | `.github/workflows/ci.yml` |
| events | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| Google Gemini | credential read by sweep.yml | `.github/workflows/sweep.yml` |
| kwook-demo | Cloudflare Pages, build dir ./dist | `wrangler.jsonc` |
| listing_urls | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| migrate.yml | jobs: migrate; on: push, workflow_dispatch; applies migrations | `.github/workflows/migrate.yml` |
| observations | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| probe.yml | jobs: probe; on: workflow_dispatch | `.github/workflows/probe.yml` |
| products | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| resolution_proposals | table; RLS on | `supabase/migrations/20260831130000_resolution_proposals.sql` |
| rules | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| sources | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| Supabase | credential read by migrate.yml | `.github/workflows/migrate.yml` |
| Supabase | credential read by sweep.yml | `.github/workflows/sweep.yml` |
| Supabase | @supabase/supabase-js present | `src/lib/supabaseClient.ts` |
| sweep-watchdog.yml | jobs: watchdog; on: schedule, workflow_dispatch | `.github/workflows/sweep-watchdog.yml` |
| sweep.yml | jobs: sweep; on: workflow_dispatch | `.github/workflows/sweep.yml` |
| sweeps | table; RLS on | `supabase/migrations/20260830180000_init.sql` |
| Telegram | credential read by sweep-watchdog.yml | `.github/workflows/sweep-watchdog.yml` |
| Telegram | credential read by sweep.yml | `.github/workflows/sweep.yml` |
