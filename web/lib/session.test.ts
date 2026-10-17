import test from "node:test";
import assert from "node:assert/strict";
import { sessionAt, nextChange, feeBps, MAX_FEE_BPS } from "./session.ts";

// timestamps copied from contracts/test/hook/UptickHook.t.sol
test("Tuesday 15:00 UTC regular, 02:00 off-hours, Saturday weekend", () => {
  assert.equal(sessionAt(1792508400), "Regular");
  assert.equal(sessionAt(1792461600), "OffHours");
  assert.equal(sessionAt(1792843200), "Weekend");
});

test("EDT open, close and weekend edges", () => {
  assert.equal(sessionAt(1793366999), "OffHours");
  assert.equal(sessionAt(1793367000), "Regular");
  assert.equal(sessionAt(1792785599), "Regular");
  assert.equal(sessionAt(1792785600), "Weekend");
  assert.equal(sessionAt(1792972799), "Weekend");
  assert.equal(sessionAt(1792972800), "OffHours");
});

test("DST boundaries 2026 and 2027", () => {
  assert.equal(sessionAt(1793626200), "OffHours"); // Mon 11-02 13:30 UTC, EST
  assert.equal(sessionAt(1793629800), "Regular");
  assert.equal(sessionAt(1793653199), "Regular");
  assert.equal(sessionAt(1793653200), "OffHours");
  assert.equal(sessionAt(1772807400), "Regular"); // Fri 2026-03-06 14:30 EST
  assert.equal(sessionAt(1772830800), "Weekend");
  assert.equal(sessionAt(1773062999), "OffHours"); // Mon 03-09 EDT
  assert.equal(sessionAt(1773063000), "Regular");
  assert.equal(sessionAt(1804861800), "Regular");
  assert.equal(sessionAt(1805117400), "Regular");
  assert.equal(sessionAt(1806094800), "Weekend");
});

test("all twenty holidays are off-hours, three weeks later regular", () => {
  const h = [1767279600, 1768834800, 1771254000, 1775228400, 1779721200, 1781881200, 1783090800, 1788793200,
    1795705200, 1798210800, 1798815600, 1800284400, 1802703600, 1806073200, 1811775600, 1813330800,
    1814799600, 1820242800, 1827154800, 1829660400];
  assert.equal(h.length, 20);
  for (const t of h) {
    assert.equal(sessionAt(t), "OffHours", String(t));
    assert.equal(sessionAt(t + 21 * 86400), "Regular", String(t));
  }
});

test("fees and next change", () => {
  assert.deepEqual([feeBps("Regular"), feeBps("OffHours"), feeBps("Weekend"), MAX_FEE_BPS], [25, 10, 5, 100]);
  assert.deepEqual(nextChange(1792508400), { at: 1792526400, to: "OffHours" }); // Tue 20:00 UTC close
  assert.deepEqual(nextChange(1792785000), { at: 1792785600, to: "Weekend" }); // Fri close
  assert.deepEqual(nextChange(1792843200), { at: 1792972800, to: "OffHours" }); // Sat to Mon 00:00
});
