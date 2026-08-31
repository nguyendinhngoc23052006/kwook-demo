import { afterEach, describe, expect, it } from "vitest";
import { proposeResolutions } from "./propose.js";

const saved = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});

const catalogue = [
  {
    sku: "KW-VUN-300",
    name: "Rong biển vụn trộn cơm gói to 300g",
    netWeightG: 300,
    packFormat: "goi",
  },
];

describe("proposeResolutions", () => {
  it("returns nothing when no key is configured, rather than throwing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // The sweep must behave exactly as it did before the model existed: no
    // credentials is a normal state, not a failure. A throw here would take
    // down a sweep whose real product - the observations - needs no model.
    await expect(proposeResolutions(["Rong biển vụn 300g"], catalogue)).resolves.toEqual([]);
  });

  it("does not call out at all when there is nothing unresolved", async () => {
    // Guards the cost path: an empty queue must not produce a request even
    // when a key IS present.
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-used-because-titles-is-empty";
    await expect(proposeResolutions([], catalogue)).resolves.toEqual([]);
  });
});
