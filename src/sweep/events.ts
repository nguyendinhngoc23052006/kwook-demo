import {
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
 * Run the detectors over one sweep's observations.
 *
 * attribution_loss is deliberately NOT run: kitbuy's cards carry no brand
 * field, so brand_string is null for every listing and the detector would
 * emit a "high" finding for all 29 of them every hour. A detector fed a
 * column nothing populates reports noise, not a problem. It comes back when
 * a source that exposes brand attribution is wired in.
 */
export function runDetectors(
  current: Observation[],
  previous: Observation[],
  referenceBySku: Map<string, number>,
): Finding[] {
  return [
    ...selfCannibalization(current),
    ...deadListing([...previous, ...current]),
    ...dispersion(current),
    ...floorBreach(current, referenceBySku),
    ...fakeAnchor(current),
    ...newSeller(current, previous),
  ];
}
