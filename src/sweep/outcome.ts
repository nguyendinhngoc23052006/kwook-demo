/**
 * Did this sweep fail, or did it merely have a bad hour?
 *
 * The two are not the same, and treating them the same took the pipeline off
 * the air. Run 29 observed all 34 listings, wrote all 6 findings, and then
 * exited 1 because Gemini had not answered when asked to put those findings
 * into Vietnamese. The hourly chain is handed off by the previous run, so a
 * non-zero exit did not merely mark one hour red - it stopped the clock. Two
 * such hours ended a chain that had been running since the previous
 * afternoon, and nothing swept again until a human noticed.
 *
 * So the exit code answers one question only: did the sweep do ITS OWN job -
 * observe the market and record what it found? A shop that was down and a
 * model that was busy are things the sweep observed, not things it got wrong.
 * They are still written to `sweeps.errors` and still shown on the dashboard;
 * only the exit code stops reacting to them.
 */

export type SweepError = {
  /** Set for whole-sweep stages. Absent on per-source and per-URL errors. */
  stage?: string;
  source?: string;
  url?: string;
  error?: unknown;
};

/**
 * The stages that ARE the sweep's own job.
 *
 * `events` qualifies because the findings are the output: a sweep that
 * observed the market but could not record what it concluded has produced
 * nothing. `propose` and `explain` are deliberately absent - both are model
 * assists that add to a result which is already complete and already correct
 * without them, which is the whole reason they run last.
 *
 * `load` was added after the reverse case was found: the sweep could not read
 * its own configuration. The queries for sources, seeds and products
 * discarded their errors, so a database that answered nothing produced an
 * empty source list, zero attempts, zero findings - and every downstream
 * check read that as a quiet hour. The job went green, no issue opened, and
 * the hourly report announced "no alerts". A sweep that never learned what to
 * watch has not had a quiet hour; it has failed before starting, and that is
 * the one failure mode nobody would have questioned.
 */
const FATAL_STAGES = new Set(["events", "load"]);

/**
 * The reason this sweep should exit non-zero, or null if it should not.
 *
 * A reason rather than a boolean so the log says what broke: a chain that
 * stops deserves better than `exit 1` on its own.
 */
export function sweepFailed(
  errors: SweepError[],
  counts: { sourcesAttempted: number; sourcesOk: number },
): string | null {
  const fatal = errors.filter((e) => e.stage !== undefined && FATAL_STAGES.has(e.stage));
  if (fatal.length > 0) {
    return `could not record this sweep's findings (${fatal.map((e) => e.stage).join(", ")})`;
  }

  // Every source failing is different in kind from one failing: it means the
  // runner reached nothing at all, so there is no market observation this
  // hour and the next sweep's comparison has nothing to compare against.
  // Guarded on `> 0` because a sweep with no configured sources is a fresh
  // database, not an outage.
  if (counts.sourcesAttempted > 0 && counts.sourcesOk === 0) {
    return `every source failed (0 of ${counts.sourcesAttempted})`;
  }

  return null;
}
