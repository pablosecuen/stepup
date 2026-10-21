import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileCalendarHourFit } from "../mobile-density.ts";

test("mobile week preserves the original 50px/hour and the complete 08–22 axis", () => {
  for (const available of [0, 280, 400, 600, 700, 1000]) {
    const fit = mobileCalendarHourFit(available, 7);
    assert.equal(fit.hourHeightPx, Math.max(50, available / 14));
    assert.equal(fit.overflows, fit.hourHeightPx * 14 > available);
  }
});

test("mobile day matches the original fit for short phones, standalone viewports and tablets", () => {
  for (let available = 0; available <= 1600; available += 7) {
    const expected = Math.min(56, Math.max(34, available / 13));
    assert.equal(mobileCalendarHourFit(available, 1).hourHeightPx, expected);
  }
});

test("invalid and hidden viewport measurements do not create infinite or negative grid geometry", () => {
  for (const value of [NaN, Infinity, -Infinity, -500]) {
    assert.deepEqual(mobileCalendarHourFit(value, 7), { hourHeightPx: 50, overflows: true });
    assert.deepEqual(mobileCalendarHourFit(value, 1), { hourHeightPx: 34, overflows: true });
  }
});
