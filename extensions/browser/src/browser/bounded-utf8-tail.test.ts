import { describe, expect, it } from "vitest";
import { createBoundedUtf8Tail, decodeBoundedUtf8Tail } from "./bounded-utf8-tail.js";

describe("bounded UTF-8 tail", () => {
  it("keeps the newest bytes across several chunks", () => {
    const tail = createBoundedUtf8Tail(8);
    tail.append("older");
    tail.append("-newest");

    expect(tail.text()).toBe("r-newest");
  });

  it("drops a partial leading code point after byte truncation", () => {
    const encoded = Buffer.from(`old🦞new`);

    expect(decodeBoundedUtf8Tail(encoded, 5)).toBe("new");
  });

  it("replaces the retained tail when one chunk fills the limit", () => {
    const tail = createBoundedUtf8Tail(4);
    tail.append("old");
    tail.append("123456");

    expect(tail.text()).toBe("3456");
    tail.clear();
    expect(tail.text()).toBe("");
  });

  it("copies bytes out of caller-owned buffers", () => {
    const tail = createBoundedUtf8Tail(4);
    const source = Buffer.from("test");
    tail.append(source);
    source.fill(0);

    expect(tail.text()).toBe("test");
  });

  it("keeps the correct tail across many small appends that wrap the ring repeatedly", () => {
    // Regression for the ring-buffer rewrite: a flat shift-on-overflow
    // implementation only needed to get this right once, but a ring buffer
    // must correctly advance `start` and wrap `writePos` on every single
    // append, so exercise many more appends than the ring's capacity.
    const tail = createBoundedUtf8Tail(5);
    let expected = "";
    for (let i = 0; i < 50; i += 1) {
      const chunk = `${i % 10}`;
      tail.append(chunk);
      expected = (expected + chunk).slice(-5);
    }
    expect(tail.text()).toBe(expected);
  });

  it("wraps correctly when a single append straddles the end of the ring", () => {
    const tail = createBoundedUtf8Tail(6);
    tail.append("abcd"); // start=0, totalBytes=4
    tail.append("ef"); // fills exactly to capacity, writePos wraps to 0 next time
    tail.append("gh"); // evicts "ab", writes "gh" straddling the ring boundary
    expect(tail.text()).toBe("cdefgh");
  });
});
