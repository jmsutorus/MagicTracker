import assert from "node:assert/strict";
import { test } from "node:test";

import { describeOwnedCopies } from "./constants";

test("one group reads as a plain count of that kind of copy", () => {
  assert.equal(
    describeOwnedCopies([{ finish: "foil", condition: "NM", quantity: 2 }]),
    "own 2 foil NM",
  );
});

test("the ordinary finish is still named", () => {
  // A bare "own 1" would leave the finish unstated, which is the one thing
  // someone hunting a foil needs to know.
  assert.equal(
    describeOwnedCopies([{ finish: "nonfoil", condition: "NM", quantity: 1 }]),
    "own 1 nonfoil NM",
  );
});

test("mixed copies lead with the total", () => {
  assert.equal(
    describeOwnedCopies([
      { finish: "nonfoil", condition: "LP", quantity: 1 },
      { finish: "foil", condition: "NM", quantity: 2 },
    ]),
    "own 3: 1 nonfoil LP · 2 foil NM",
  );
});

test("the total counts copies, not groups", () => {
  assert.equal(
    describeOwnedCopies([
      { finish: "nonfoil", condition: "NM", quantity: 4 },
      { finish: "nonfoil", condition: "MP", quantity: 3 },
      { finish: "etched", condition: "DMG", quantity: 1 },
    ]),
    "own 8: 4 nonfoil NM · 3 nonfoil MP · 1 etched DMG",
  );
});

test("no copies describes nothing, so a caller renders no badge", () => {
  assert.equal(describeOwnedCopies([]), "");
});
