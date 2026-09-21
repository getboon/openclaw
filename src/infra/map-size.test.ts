// Covers bounded map pruning.
import { describe, expect, it } from "vitest";
import { pruneMapToMaxSize, pruneSetToMaxSize } from "./map-size.js";

describe("pruneMapToMaxSize", () => {
  it.each([
    {
      name: "keeps the newest entries after flooring fractional limits",
      entries: [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ] as const,
      maxSize: 2.9,
      expected: [
        ["b", 2],
        ["c", 3],
      ],
    },
    {
      name: "clears maps for zero limits",
      entries: [
        ["a", 1],
        ["b", 2],
      ] as const,
      maxSize: 0,
      expected: [],
    },
    {
      name: "clears maps for negative limits",
      entries: [
        ["a", 1],
        ["b", 2],
      ] as const,
      maxSize: -4,
      expected: [],
    },
    {
      name: "leaves maps untouched for NaN limits",
      entries: [
        ["a", 1],
        ["b", 2],
      ] as const,
      maxSize: Number.NaN,
      expected: [
        ["a", 1],
        ["b", 2],
      ],
    },
    {
      name: "leaves maps untouched for positive infinity limits",
      entries: [
        ["a", 1],
        ["b", 2],
      ] as const,
      maxSize: Number.POSITIVE_INFINITY,
      expected: [
        ["a", 1],
        ["b", 2],
      ],
    },
    {
      name: "clears maps for negative infinity limits",
      entries: [
        ["a", 1],
        ["b", 2],
      ] as const,
      maxSize: Number.NEGATIVE_INFINITY,
      expected: [],
    },
    {
      name: "leaves undersized maps untouched",
      entries: [["a", 1]] as const,
      maxSize: 5,
      expected: [["a", 1]],
    },
  ])("$name", ({ entries, maxSize, expected }) => {
    const map = new Map(entries);
    pruneMapToMaxSize(map, maxSize);
    expect([...map.entries()]).toEqual(expected);
  });
});

describe("pruneSetToMaxSize", () => {
  it.each([
    {
      name: "keeps the newest entries after flooring fractional limits",
      values: ["a", "b", "c"],
      maxSize: 2.9,
      expected: ["b", "c"],
    },
    {
      name: "clears sets for zero limits",
      values: ["a", "b"],
      maxSize: 0,
      expected: [],
    },
    {
      name: "clears sets for negative limits",
      values: ["a", "b"],
      maxSize: -4,
      expected: [],
    },
    {
      name: "leaves sets untouched for NaN limits",
      values: ["a", "b"],
      maxSize: Number.NaN,
      expected: ["a", "b"],
    },
    {
      name: "leaves sets untouched for positive infinity limits",
      values: ["a", "b"],
      maxSize: Number.POSITIVE_INFINITY,
      expected: ["a", "b"],
    },
    {
      name: "clears sets for negative infinity limits",
      values: ["a", "b"],
      maxSize: Number.NEGATIVE_INFINITY,
      expected: [],
    },
    {
      name: "leaves undersized sets untouched",
      values: ["a"],
      maxSize: 5,
      expected: ["a"],
    },
  ])("$name", ({ values, maxSize, expected }) => {
    const set = new Set(values);
    pruneSetToMaxSize(set, maxSize);
    expect([...set.values()]).toEqual(expected);
  });
});
