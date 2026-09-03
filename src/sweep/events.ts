import {
  attributionLoss,
  deadListing,
  dispersion,
  type Finding,
  fakeAnchor,
  floorBreach,
  newSeller,
  type Observation,
  selfCannibalization,
} from "./detect.js";

/**
 * One row of the `rules` table, as the sweep now actually reads it.
 *
 * It did not read it before, and that was the quietest lie in the system: the
 * table stores a threshold, a severity and an active flag for all seven
 * detectors, the dashboard shows them, and every one of the three was ignored.
 * The thresholds in detect.ts were hardcoded defaults that HAPPENED to equal
 * the seeded values, so nothing looked wrong - change `gap_pct` to 40 in the
 * database and the sweep kept using 25, with no error and no way to tell.
 *
 * For a system whose whole claim is that a business person can tune it without
 * a developer, a decorative control surface is worse than none.
 */
export type Rule = {
  type: string;
  threshold: Record<string, unknown>;
  severity: Finding["severity"];
  active: boolean;
};

const RANK: Record<Finding["severity"], number> = { info: 0, medium: 1, high: 2 };

/**
 * The rule sets the severity; a detector may raise it but never lower it.
 *
 * dispersion is why: it calls a spread over 100% "high" while its rule says
 * "medium", and that escalation is a real judgment about the data rather than
 * a default someone forgot to change. Taking the higher of the two keeps the
 * rule authoritative without discarding what the detector observed.
 *
 * Downgrading is deliberately not offered. The lever for "stop telling me
 * about this" is the threshold, which changes what counts as a finding at
 * all; relabelling a finding the detector considers serious would leave it on
 * the screen wearing the wrong colour, which is the worse of the two.
 */
function escalate(found: Finding["severity"], rule: Finding["severity"]): Finding["severity"] {
  return RANK[found] > RANK[rule] ? found : rule;
}

/** A threshold value, or the detector's own default when the row omits it. */
function num(threshold: Record<string, unknown>, key: string, fallback: number): number {
  const v = threshold[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strings(threshold: Record<string, unknown>, key: string): string[] {
  const v = threshold[key];
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Run the detectors the rules table says to run, with the values it gives.
 *
 * attribution_loss is scoped here rather than switched off here. It used to be
 * omitted outright because kitbuy's cards carry no brand field, so feeding it
 * every observation flagged all 29 of them every hour. But absence of a field
 * is not a misattribution: a source that never publishes a brand cannot lose
 * one. Scoped to the observations that DO carry a brand - tiki on all 150 of
 * its observations, tteokbokki on 10 - it becomes a check that runs and
 * passes, which is a far stronger thing to show than a check that is dark.
 */
export function runDetectors(
  current: Observation[],
  previous: Observation[],
  referenceBySku: Map<string, number>,
  rules: Rule[],
): Finding[] {
  const active = new Map(rules.filter((r) => r.active).map((r) => [r.type, r]));
  const out: Finding[] = [];

  const run = (type: string, detect: (t: Record<string, unknown>) => Finding[]): void => {
    const rule = active.get(type);
    if (rule === undefined) return;
    for (const f of detect(rule.threshold)) {
      out.push({ ...f, severity: escalate(f.severity, rule.severity) });
    }
  };

  run("self_cannibalization", (t) => selfCannibalization(current, num(t, "gap_pct", 25)));
  run("dead_listing", (t) => deadListing([...previous, ...current], num(t, "window_hours", 24)));
  run("dispersion", (t) => dispersion(current, num(t, "pct", 30)));
  run("floor_breach", (t) => floorBreach(current, referenceBySku, num(t, "tolerance", 0.1)));
  run("fake_anchor", (t) => fakeAnchor(current, num(t, "multiple", 3)));
  run("attribution_loss", (t) => {
    // No accepted spellings means no way to tell a correct brand from a wrong
    // one, and this detector's answer in that state is "everything is wrong":
    // it would post a high-severity finding for all 160 observations that
    // carry a brand. That is a misconfiguration, not a finding.
    //
    // The state is reachable. The spellings live in a migration and the code
    // ships from Cloudflare, and the two land independently on a merge - so a
    // sweep starting in between would read `{}` from a table the new code
    // trusts. A detector whose configuration cannot distinguish pass from
    // fail must not run.
    const accepted = strings(t, "accepted");
    if (accepted.length === 0) return [];
    return attributionLoss(
      current.filter((o) => o.brandString !== null),
      accepted,
    );
  });
  run("new_seller", () => newSeller(current, previous));

  return out;
}
