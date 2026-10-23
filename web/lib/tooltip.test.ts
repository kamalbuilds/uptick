import test from "node:test";
import assert from "node:assert/strict";
import { tooltipShift } from "./tooltip.ts";

const fits = (anchor: number, vw: number) => {
  const left = anchor + tooltipShift(anchor, vw);
  const box = Math.min(280, vw - 24);
  return left >= 12 && left + box <= vw - 12;
};

test("a word with room to the right keeps its tooltip where it is", () => {
  assert.equal(tooltipShift(46, 375), 0);
  assert.equal(tooltipShift(100, 1440), 0);
});

test("a word near the right edge of a phone pulls the tooltip left until it clears the gutter", () => {
  // The measured case: Morpho Blue at 203px on a 375px screen, where the old right-anchored box ran from -3px to 277px.
  assert.equal(tooltipShift(203, 375), 363 - 280 - 203);
  assert.ok(fits(203, 375));
});

test("a word flush against the left edge is pushed in by the gutter", () => {
  assert.equal(tooltipShift(2, 375), 10);
});

test("every anchor from the left edge to the right edge fits at phone and desktop widths", () => {
  let checked = 0;
  for (const vw of [320, 375, 414, 768, 1440]) {
    for (let a = 0; a <= vw; a += 7) {
      assert.ok(fits(a, vw), `anchor ${a} in ${vw}`);
      checked++;
    }
  }
  assert.ok(checked > 200);
});

test("a screen narrower than the box shrinks it to the viewport less both gutters", () => {
  assert.equal(tooltipShift(150, 300), 12 - 150);
  assert.ok(fits(150, 300));
});
