import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileDayHeading, mobileFiveDayTracks } from "../mobile-viewport.ts";

test("five equal mobile days fit exactly and the remaining weekend stays reachable", () => {
  for (const width of [320, 375, 390, 430, 600]) {
    const result = mobileFiveDayTracks(width, 36, 7);
    assert.equal(result.trackPx.length, 7);
    assert.equal(new Set(result.trackPx).size, 1);
    assert.equal(36 + result.trackPx.slice(0, 5).reduce((a, b) => a + b, 0), width);
    assert.ok(Math.abs(result.totalPx - width - result.trackPx[0] * 2) < 1e-8);
    assert.equal(result.expanded, true);
  }
});
test("day mode and shorter ranges do not acquire empty horizontal columns", () => {
  assert.deepEqual(mobileFiveDayTracks(390, 36, 1), { trackPx: [354], totalPx: 390, expanded: false });
  assert.equal(mobileFiveDayTracks(390, 36, 5).totalPx, 390);
  assert.equal(mobileDayHeading(2, 11), "Miércoles 11");
  assert.equal(mobileDayHeading(6, 15), "Domingo 15");
});
