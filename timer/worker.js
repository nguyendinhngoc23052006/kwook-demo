/**
 * A timer, and nothing else.
 *
 * GitHub Actions' scheduler has fired this repo's hourly cron twice in its
 * lifetime and not once in the seven hours after the cron was moved off the
 * contended top-of-hour slot. GitHub documents `schedule` as best-effort -
 * delayed under load, and dropped outright when load is high enough - so no
 * cron expression fixes it. The sweep already paces itself once started; what
 * was missing was something reliable to start it.
 *
 * Cloudflare's cron triggers are that. This Worker does exactly one thing:
 * POST workflow_dispatch. The scraping, parsing, detecting and model calls all
 * stay in GitHub Actions where they already work - this is a doorbell, not a
 * second pipeline. It uses one subrequest and a millisecond of CPU, which is
 * far inside the Workers free tier.
 *
 * Deploy: see timer/README.md
 */

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },

  // Same work on a manual GET, so the deployment can be proven without
  // waiting for a cron tick.
  async fetch(_request, env) {
    const result = await dispatch(env);
    return new Response(result.body, { status: result.status });
  },
};

async function dispatch(env) {
  const repo = env.GITHUB_REPO; // "owner/name"
  const workflow = env.WORKFLOW_FILE ?? "sweep.yml";
  const ref = env.GITHUB_REF ?? "main";
  const iterations = env.SWEEP_ITERATIONS ?? "5";

  if (!repo || !env.GITHUB_TOKEN) {
    return { status: 500, body: "GITHUB_REPO and GITHUB_TOKEN must be set" };
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "content-type": "application/json",
        // GitHub rejects requests without a User-Agent.
        "user-agent": "gia-san-timer",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: { iterations } }),
    },
  );

  // 204 is success and carries no body. Anything else is worth reading, so
  // pass it through rather than collapsing it to "failed".
  const detail = res.status === 204 ? "" : await res.text();
  const line = `dispatch ${repo}/${workflow}@${ref} -> HTTP ${res.status} ${detail}`.trim();
  console.log(line);

  return { status: res.ok ? 200 : 502, body: line };
}
