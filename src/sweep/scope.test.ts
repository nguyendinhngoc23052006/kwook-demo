import { describe, expect, it } from "vitest";
import { classifyScope } from "./scope.js";

describe("classifyScope", () => {
  it("excludes a listing that names a competitor brand", () => {
    expect(classifyScope("Mì Cay Hàn Quốc Shin Ramyun Nongshim")).toEqual({
      outOfScope: true,
      brand: "nongshim",
    });
    expect(classifyScope("Rong biển cuộn cơm 10 lá Gimfood - 23/ gói/ 10Lá")).toEqual({
      outOfScope: true,
      brand: "gimfood",
    });
    expect(classifyScope("Miến khoai lang hàn quốc Nongwoo, Gogi 1 Kg")).toEqual({
      outOfScope: true,
      brand: "nongwoo",
    });
  });

  it("keeps a genuine Kwook listing that carries no brand word at all", () => {
    // This exact title is one of the five in the self-cannibalisation cluster.
    // A "no Kwook word means not Kwook" rule would silently delete the finding.
    expect(classifyScope("Rong biển cuộn cơm 100 lá -  -")).toEqual({ outOfScope: false });
  });

  it("keeps an unbranded grocery, because unbranded is not evidence", () => {
    expect(classifyScope("Ớt Bột Hàn Quốc Làm Kim Chi Màu Đẹp Loại Vảy Mịn 1kg")).toEqual({
      outOfScope: false,
    });
  });

  it("matches a brand as a whole word, not inside another word", () => {
    expect(classifyScope("Rong biển CJ-style cuộn cơm")).toEqual({ outOfScope: true, brand: "cj" });
    expect(classifyScope("Rong biển cjxyz cuộn cơm")).toEqual({ outOfScope: false });
  });

  it("is case and diacritic insensitive", () => {
    expect(classifyScope("MÌ NONGSHIM")).toEqual({ outOfScope: true, brand: "nongshim" });
  });
});
