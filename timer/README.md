# The timer

GitHub Actions is where the sweep runs. This Worker only **starts** it.

## Why it exists

`.github/workflows/sweep.yml` asks for `17,47 * * * *` — twice an hour. Measured
on this repo, GitHub's scheduler fired it **twice in two days**, then missed six
consecutive slots in a row. That is not a bug to fix: GitHub documents the
`schedule` event as best-effort — delayed when the platform is busy, and queued
runs "may be dropped". No cron expression changes that.

So the trigger moves somewhere that keeps time, and the work stays where it
already works. Cloudflare's cron triggers fire this Worker every 30 minutes; the
Worker POSTs one `workflow_dispatch` to GitHub; the sweep job then paces itself
hourly from the inside for the next ~5 hours. One doorbell, one pipeline.

Cost: one HTTP request every 30 minutes — 48 invocations a day against the
Workers free tier's 100,000. ([Cron Triggers are free-plan features, up to 3 per
Worker](https://developers.cloudflare.com/workers/platform/pricing/); this uses
one.)

## Setup — six clicks and two pastes, no terminal

### 1. Make the key GitHub will accept

1. GitHub → your avatar → **Settings** → **Developer settings** → **Personal
   access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name**: `gia-san-timer`. **Expiration**: 90 days.
3. **Repository access** → **Only select repositories** →
   `nguyendinhngoc23052006/kwook-demo`.
4. **Permissions** → **Repository permissions** → **Actions** → **Read and
   write**. Nothing else. (`Metadata: Read` is added for you and cannot be
   removed.)
5. **Generate token**, then copy the value. GitHub shows it once.

*Read and write on Actions is the whole grant: it can start a workflow and read
run status. It cannot read your code, write a commit, or touch any other repo.*

### 2. Create the Worker

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Start with Hello
   World!** → **Deploy**.
2. **Edit code**, select everything in the editor, and paste the contents of
   [`worker.js`](worker.js) over it → **Deploy**.

### 3. Give it the key and the target

In the Worker → **Settings** → **Variables and Secrets**:

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_TOKEN` | **Secret** | the token from step 1 |
| `GITHUB_REPO` | Text | `nguyendinhngoc23052006/kwook-demo` |
| `WORKFLOW_FILE` | Text | `sweep.yml` |
| `GITHUB_REF` | Text | `main` |
| `SWEEP_ITERATIONS` | Text | `5` |

`GITHUB_TOKEN` must be **Secret**, never Text. A Text variable is readable by
anyone who can open the Worker; a Secret is write-only after it is saved. Only
`GITHUB_TOKEN` is sensitive — the other four are public facts about this repo,
and keeping them as Text is what lets you retarget the timer without touching
code.

### 4. Set the clock

Worker → **Settings** → **Trigger Events** → **Add** → **Cron Trigger** →
`*/30 * * * *` → **Add**.

*If a label reads differently in your dashboard, look for **Cron** under the
Worker's settings — Cloudflare has moved this panel before, and I could not
reach their docs from this sandbox today (2026-08-31) to re-check the wording.*

### 5. Prove it, without waiting 30 minutes

Open the Worker's URL (`https://gia-san-timer.<your-subdomain>.workers.dev`) in a
browser tab. The Worker does exactly the same thing on a plain GET as it does on
a cron tick, and answers with what GitHub said:

```
dispatch nguyendinhngoc23052006/kwook-demo/sweep.yml@main -> HTTP 204
```

**204 is success** — GitHub returns no body for an accepted dispatch. Then check
the repo's **Actions** tab: a `sweep` run should be starting.

Anything else is the Worker telling you which step to redo:

| Response | Cause |
| --- | --- |
| `HTTP 401` | Token wrong, expired, or pasted as Text instead of Secret |
| `HTTP 403` | Token lacks **Actions: Read and write** |
| `HTTP 404` | `GITHUB_REPO` or `WORKFLOW_FILE` misspelled, or the workflow isn't on `main` yet |
| `HTTP 422` | `GITHUB_REF` names a branch that doesn't exist |
| `GITHUB_REPO and GITHUB_TOKEN must be set` | Step 3 wasn't saved |

## Why every 30 minutes when the sweep is hourly

A dispatch that lands while a sweep loop is already running does not stack up:
`sweep.yml` sets `cancel-in-progress: true`, so the newer run replaces the older
one and the loop restarts from fresh code. That makes a missed tick cost 30
minutes instead of a day, and it costs nothing when nothing was missed.

## Turning it off

Delete the cron trigger (step 4) and the sweeps stop at the end of the running
job's loop. Revoke the token in GitHub to be certain. Deleting the Worker does
both at once.
