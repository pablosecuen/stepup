import { test } from "node:test";
import assert from "node:assert/strict";
import { saveGridScroll, restoreGridScroll } from "../grid-scroll.ts";

test("returning to the same calendar restores both the hour and the weekend scroll once", () => {
  const data = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { setItem: (k: string, v: string) => data.set(k, v), getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => data.delete(k) } });
  try {
    saveGridScroll("/calendario?semana=qa", { scrollTop: 187, scrollLeft: 140 });
    const scroller = { scrollTop: 0, scrollLeft: 0 };
    assert.equal(restoreGridScroll("/calendario?semana=qa", scroller), true);
    assert.deepEqual(scroller, { scrollTop: 187, scrollLeft: 140 });
    assert.equal(restoreGridScroll("/calendario?semana=qa", scroller), false);
    saveGridScroll("/calendario?semana=qa", { scrollTop: 200, scrollLeft: 100 });
    assert.equal(restoreGridScroll("/calendario?semana=otra", scroller), false);
    assert.deepEqual(scroller, { scrollTop: 187, scrollLeft: 140 });
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
