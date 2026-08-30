import { describe, expect, it } from "vitest";
import { normalizeTitle, parseUnitsSold, parseVnd } from "./vnd.js";

describe("parseVnd", () => {
  it("reads Vietnamese thousands separators as whole dong", () => {
    expect(parseVnd("42.120 ₫")).toBe(42120);
    expect(parseVnd("52.900₫")).toBe(52900);
    expect(parseVnd("120.000 đ")).toBe(120000);
    expect(parseVnd("1.250.000 ₫")).toBe(1250000);
    expect(parseVnd("185.000₫")).toBe(185000);
  });

  it("does not fall into the parseFloat trap", () => {
    expect(parseVnd("42.120 ₫")).not.toBe(42);
    expect(parseVnd("42.120 ₫")).not.toBeCloseTo(42.12);
  });

  it("returns null when there is nothing to read", () => {
    expect(parseVnd("")).toBeNull();
    expect(parseVnd(null)).toBeNull();
    expect(parseVnd("Đã bán")).toBeNull();
  });
});

describe("parseUnitsSold", () => {
  it("reads the sold counter", () => {
    expect(parseUnitsSold("Đã bán 1.240")).toBe(1240);
    expect(parseUnitsSold("Đã bán 256")).toBe(256);
    expect(parseUnitsSold("Đã bán 1")).toBe(1);
  });

  it("is null when the counter is absent", () => {
    expect(parseUnitsSold("Hoàn tiền 2.0%")).toBeNull();
    expect(parseUnitsSold(null)).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("strips diacritics including the standalone d", () => {
    expect(normalizeTitle("Rong biển cuộn cơm 100 lá")).toBe("rong bien cuon com 100 la");
    expect(normalizeTitle("Đặc biệt")).toBe("dac biet");
  });

  it("folds punctuation and case so listing variants collide", () => {
    expect(normalizeTitle("Rong biển cuộn cơm 100 lá - -")).toBe(
      normalizeTitle("RONG BIỂN CUỘN CƠM 100 LÁ"),
    );
  });
});
