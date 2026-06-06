import { describe, it, expect } from "vitest";
import { patternMatches } from "../src/services/matchService.js";

describe("patternMatches", () => {
  it("wildcard * matches anything", () => {
    expect(patternMatches("*", "order.created")).toBe(true);
    expect(patternMatches("*", "user.deleted")).toBe(true);
    expect(patternMatches("*", "anything")).toBe(true);
  });

  it("exact match works", () => {
    expect(patternMatches("order.created", "order.created")).toBe(true);
    expect(patternMatches("order.created", "order.updated")).toBe(false);
  });

  it("single-segment glob: user.*", () => {
    expect(patternMatches("user.*", "user.created")).toBe(true);
    expect(patternMatches("user.*", "user.deleted")).toBe(true);
    expect(patternMatches("user.*", "order.created")).toBe(false);
  });

  it("single-segment glob does NOT cross segment boundaries", () => {
    expect(patternMatches("user.*", "user.profile.updated")).toBe(false);
  });

  it("deep glob: order.** matches any depth", () => {
    expect(patternMatches("order.**", "order.created")).toBe(true);
    expect(patternMatches("order.**", "order.item.refunded")).toBe(true);
    expect(patternMatches("order.**", "user.created")).toBe(false);
  });

  it("no false positives on partial prefix match", () => {
    expect(patternMatches("order.*", "orders.created")).toBe(false);
  });
});
