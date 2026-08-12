import { describe, expect, it } from "vitest";
import { moveNode } from "../tree";
import type { ConditionGroup } from "../types";

/** `A and B or C`, the tree every reorder below starts from. */
function tree(): ConditionGroup<string> {
  return { conjunctions: ["and", "or"], conditions: ["A", "B", "C"] };
}

function nested(): ConditionGroup<string> {
  return {
    conjunctions: ["or"],
    conditions: ["A", { conjunctions: ["and"], conditions: ["B", "C"] }],
  };
}

describe("moveNode", () => {
  it("reorders a row within its group", () => {
    const next = moveNode(tree(), [], 2, 0);
    expect(next.conditions).toEqual(["C", "A", "B"]);
  });

  it("leaves the source tree untouched", () => {
    const before = tree();
    moveNode(before, [], 0, 2);
    expect(before.conditions).toEqual(["A", "B", "C"]);
  });

  it("carries the operator the moved row displayed", () => {
    // C displayed "or"; at the top it is the gap below it that reads the word.
    const next = moveNode(tree(), [], 2, 0);
    expect(next.conjunctions).toEqual(["or", "and"]);
  });

  it("keeps one operator per gap", () => {
    for (const [from, to] of [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 2],
      [2, 0],
      [2, 1],
    ]) {
      const next = moveNode(tree(), [], from, to);
      expect(next.conjunctions).toHaveLength(next.conditions.length - 1);
    }
  });

  it("moves inside a nested group without touching its parent", () => {
    const next = moveNode(nested(), [1], 1, 0);
    const group = next.conditions[1] as ConditionGroup<string>;
    expect(group.conditions).toEqual(["C", "B"]);
    expect(next.conjunctions).toEqual(["or"]);
    expect(next.conditions[0]).toBe("A");
  });

  it("is a no-op when the row does not move", () => {
    expect(moveNode(tree(), [], 1, 1)).toEqual(tree());
  });

  it("is a no-op for an index outside the group", () => {
    expect(moveNode(tree(), [], 0, 3)).toEqual(tree());
    expect(moveNode(tree(), [], -1, 0)).toEqual(tree());
  });

  it("is a no-op for a path that is not a group", () => {
    expect(moveNode(nested(), [0], 0, 1)).toEqual(nested());
    expect(moveNode(tree(), [9], 0, 1)).toEqual(tree());
  });

  it("never reparents", () => {
    const next = moveNode(nested(), [1], 0, 1);
    expect(next.conditions).toHaveLength(2);
    expect(
      (next.conditions[1] as ConditionGroup<string>).conditions
    ).toHaveLength(2);
  });
});
