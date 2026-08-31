/**
 * Which listings are still on sale, and which are ghosts.
 *
 * A `listing_urls` row is permanent - it is the identity a price history hangs
 * off, so it is never deleted when a seller takes the listing down. That is
 * correct for history and wrong for a queue: without a filter, every listing
 * that ever existed stays in the unresolved pile forever, and the model is
 * asked about it on every sweep for the rest of the project.
 *
 * The rule is exact, not a staleness window: a listing is a ghost only when
 * its source was READ SUCCESSFULLY this sweep and the listing was not among
 * what came back. If the source failed - blocked, down, or deactivated after
 * three strikes - nothing was learned about its listings, so they all stay.
 */
export type QueueCandidate = {
  source_id: string;
  last_seen_at: string | null;
};

export function stillListed<T extends QueueCandidate>(
  candidates: T[],
  sourcesReadThisSweep: Set<string>,
  sweepStartedAt: string,
): T[] {
  const start = Date.parse(sweepStartedAt);
  return candidates.filter((c) => {
    if (!sourcesReadThisSweep.has(c.source_id)) return true;
    if (!c.last_seen_at) return false;
    return Date.parse(c.last_seen_at) >= start;
  });
}
