import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TERMS, type TermId } from "./terms.ts";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("every gloss is a plain sentence: a label, a definition of one to three sentences, no dash tell", () => {
  const ids = Object.keys(TERMS) as TermId[];
  assert.ok(ids.length >= 14, "the glossary is not empty");
  const labels = new Set<string>();
  for (const id of ids) {
    const { label, text } = TERMS[id];
    assert.ok(label.length > 2 && label.length < 32, `${id} label`);
    assert.ok(!labels.has(label), `${id} label repeats`);
    labels.add(label);
    const sentences = text.split(/(?<=\.)\s+/);
    assert.ok(sentences.length >= 1 && sentences.length <= 4, `${id} runs ${sentences.length} sentences`);
    assert.ok(text.length > 60 && text.length < 420, `${id} is ${text.length} characters`);
    assert.ok(!/—| -- /.test(text + label), `${id} carries a dash tell`);
    assert.ok(text.trim().endsWith("."), `${id} ends in a period`);
  }
});

test("the loan words are defined in plain terms a stranger can act on", () => {
  assert.match(TERMS.healthFactor.text, /Above 1 the loan is safe/);
  assert.match(TERMS.healthFactor.text, /1 or below a liquidator/);
  assert.doesNotMatch(TERMS.lltv.text, /LLTV/, "the acronym is not user-facing");
  assert.match(TERMS.liquidationPrice.text, /repay your USDG and take your vault shares/);
  assert.match(TERMS.inKind.text, /no swap/);
  assert.match(TERMS.kept.text, /minus sign means/);
});

// A gloss that no screen opens is decoration. Each domain word is opened by a Term on the screen where a stranger first meets it.
const WHERE: Array<[TermId, string]> = [
  ["kept", "components/idle-finder.tsx"],
  ["borrowRoom", "components/idle-finder.tsx"],
  ["lltv", "components/idle-finder.tsx"],
  ["inKind", "components/idle-finder.tsx"],
  ["morpho", "components/idle-finder.tsx"],
  ["kept", "components/vault-list.tsx"],
  ["lltv", "components/earn-borrow.tsx"],
  ["morpho", "components/earn-borrow.tsx"],
  ["collateral", "components/earn-borrow.tsx"],
  ["healthFactor", "components/earn-borrow.tsx"],
  ["liquidationPrice", "components/earn-borrow.tsx"],
  ["collateral", "components/your-loan.tsx"],
  ["healthFactor", "components/your-loan.tsx"],
  ["liquidationPrice", "components/your-loan.tsx"],
  ["funding", "components/hedge-plan.tsx"],
  ["healthFactor", "components/hedge-plan.tsx"],
];

test("each screen opens the gloss of the word it leans on", () => {
  assert.ok(WHERE.length > 0);
  for (const [id, file] of WHERE) {
    assert.match(src(file), new RegExp(`<Term id="${id}"`), `${file} never opens the ${id} gloss`);
  }
});

test("no screen names a gloss that does not exist", () => {
  const files = ["components/idle-finder.tsx", "components/earn-borrow.tsx", "components/your-loan.tsx", "components/vault-list.tsx", "components/hedge-plan.tsx"];
  let seen = 0;
  for (const f of files) {
    for (const m of src(f).matchAll(/<Term id="(\w+)"/g)) {
      seen++;
      assert.ok(m[1] in TERMS, `${f} opens an unknown term ${m[1]}`);
    }
  }
  assert.ok(seen >= 14, `only ${seen} Term uses found`);
});
