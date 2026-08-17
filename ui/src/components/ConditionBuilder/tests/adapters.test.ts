import { describe, expect, it } from "vitest";
import {
  fromFrappeConditions,
  toConditionExpression,
  toFrappeConditions,
} from "../adapters";
import type { ConditionGroup, FieldConditionValue } from "../types";
import type { FilterField } from "../../Filter/types";

type Tree = ConditionGroup<FieldConditionValue>;

function leaf(
  fieldname: string,
  operator: FieldConditionValue["operator"],
  value: FieldConditionValue["value"]
): FieldConditionValue {
  return { fieldname, operator, value };
}

/** A flat group over the leaves given, joined by the conjunctions given. */
function group(
  conditions: Tree["conditions"],
  ...conjunctions: Tree["conjunctions"]
): Tree {
  return { conjunctions, conditions };
}

describe("toConditionExpression", () => {
  it("is empty for a tree with nothing in it", () => {
    expect(toConditionExpression(group([]))).toBe("");
  });

  it("joins a level with the operator standing in each gap", () => {
    const tree = group(
      [
        leaf("status", "equals", "Open"),
        leaf("priority", "equals", "High"),
        leaf("agent", "equals", "sam"),
      ],
      "and",
      "or"
    );

    expect(toConditionExpression(tree)).toBe(
      'status == "Open" and priority == "High" or agent == "sam"'
    );
  });

  it("parenthesises a nested group rather than relying on precedence", () => {
    const tree = group(
      [
        group(
          [
            leaf("status", "equals", "Open"),
            leaf("status", "equals", "Replied"),
          ],
          "or"
        ),
        leaf("priority", "equals", "High"),
      ],
      "and"
    );

    expect(toConditionExpression(tree)).toBe(
      '(status == "Open" or status == "Replied") and priority == "High"'
    );
  });

  it("prefixes fieldnames when the host evaluates against a document", () => {
    const tree = group([leaf("status", "equals", "Open")]);

    expect(toConditionExpression(tree, { fieldPrefix: "doc" })).toBe(
      'doc.status == "Open"'
    );
  });

  describe("operators", () => {
    const compile = (
      operator: FieldConditionValue["operator"],
      value: FieldConditionValue["value"]
    ) => toConditionExpression(group([leaf("subject", operator, value)]));

    it("compiles equality and its aliases", () => {
      expect(compile("equals", "refund")).toBe('subject == "refund"');
      expect(compile("not equals", "refund")).toBe('subject != "refund"');
    });

    it("compiles like to a membership test guarded on the field", () => {
      expect(compile("like", "refund")).toBe(
        '(subject and "refund" in subject)'
      );
      expect(compile("not like", "refund")).toBe(
        '(subject and "refund" not in subject)'
      );
    });

    it("compiles in from a list and from a comma string alike", () => {
      expect(compile("in", ["Open", "Replied"])).toBe(
        '(subject and subject in ["Open", "Replied"])'
      );
      expect(compile("in", "Open, Replied")).toBe(
        '(subject and subject in ["Open", "Replied"])'
      );
      expect(compile("not in", ["Open"])).toBe(
        '(subject and subject not in ["Open"])'
      );
    });

    it("compiles between to two comparisons, from a pair or a comma string", () => {
      expect(compile("between", ["2026-01-01", "2026-01-31"])).toBe(
        '(subject >= "2026-01-01" and subject <= "2026-01-31")'
      );
      expect(compile("between", "2026-01-01,2026-01-31")).toBe(
        '(subject >= "2026-01-01" and subject <= "2026-01-31")'
      );
    });

    it("compiles every set/not set pairing to the field's truthiness", () => {
      expect(compile("is", "set")).toBe("subject");
      expect(compile("is", "not set")).toBe("not subject");
      expect(compile("is not", "set")).toBe("not subject");
      // CRM's compiler leaves this one to fall through to `subject is not "not
      // set"`, which is true of every document.
      expect(compile("is not", "not set")).toBe("subject");
    });

    it("compiles a Check field's Yes/No to the field itself", () => {
      expect(compile("equals", "Yes")).toBe("subject");
      expect(compile("equals", "No")).toBe("not subject");
      expect(compile("not equals", "Yes")).toBe("not subject");
      expect(compile("not equals", "No")).toBe("subject");
    });

    it("compiles an unset value to the field's own falsiness", () => {
      expect(compile("equals", null)).toBe("not subject");
      expect(compile(">", null)).toBe("subject");
    });

    it("emits numbers bare and booleans as Python's", () => {
      expect(compile(">", 5)).toBe("subject > 5");
      expect(compile("equals", true)).toBe("subject == True");
      expect(compile("equals", false)).toBe("subject == False");
    });

    it("escapes a value that would otherwise end the literal early", () => {
      expect(compile("equals", 'a "quoted" word')).toBe(
        'subject == "a \\"quoted\\" word"'
      );
      expect(compile("equals", "back\\slash")).toBe(
        'subject == "back\\\\slash"'
      );
    });
  });

  describe("with the doctype's fields", () => {
    const fields: FilterField[] = [
      {
        label: "Is Open",
        value: "is_open",
        fieldname: "is_open",
        fieldtype: "Check",
      },
      {
        label: "Subject",
        value: "subject",
        fieldname: "subject",
        fieldtype: "Data",
      },
      {
        label: "Grand Total",
        value: "grand_total",
        fieldname: "grand_total",
        fieldtype: "Currency",
      },
    ];

    const compile = (
      fieldname: string,
      operator: FieldConditionValue["operator"],
      value: FieldConditionValue["value"]
    ) =>
      toConditionExpression(group([leaf(fieldname, operator, value)]), {
        fields,
      });

    it("compiles a Check field to its truthiness and a Data field to a comparison", () => {
      expect(compile("is_open", "equals", "Yes")).toBe("is_open");
      expect(compile("is_open", "equals", "No")).toBe("not is_open");
      // Without fields this would read as a Check, since the value is the word.
      expect(compile("subject", "equals", "Yes")).toBe('subject == "Yes"');
    });

    it("compiles a numeric field's value to a number, not a quoted string", () => {
      // `doc.grand_total > "100"` raises under safe_eval rather than comparing.
      expect(compile("grand_total", ">", "100")).toBe("grand_total > 100");
      expect(compile("grand_total", "equals", "0")).toBe("grand_total == 0");
      // Not a number: quoted, so the expression still parses.
      expect(compile("grand_total", "equals", "lots")).toBe(
        'grand_total == "lots"'
      );
    });

    it("leaves an unknown fieldname to the value-only rules", () => {
      expect(compile("nonexistent", "equals", "Yes")).toBe(
        'nonexistent == "Yes"'
      );
    });
  });

  it("drops what the array drops, and the conjunction beside it", () => {
    const tree = group(
      [
        leaf("status", "equals", "Open"),
        // Added but never given a field: dropped on save, so dropped here.
        leaf("", "equals", ""),
        leaf("priority", "equals", "High"),
      ],
      "and",
      "or"
    );

    expect(toConditionExpression(tree)).toBe(
      'status == "Open" or priority == "High"'
    );
  });

  it("drops an empty group without leaving its operator dangling", () => {
    const tree = group([group([]), leaf("status", "equals", "Open")], "and");

    expect(toConditionExpression(tree)).toBe('status == "Open"');
  });

  it("drops an entry it cannot parse, and the conjunction beside it", () => {
    // A doctype-qualified filter has no row to render and no Python to compile
    // to, so the reader drops it rather than carrying a leaf nothing can edit.
    const tree = fromFrappeConditions([
      ["status", "==", "Open"],
      "and",
      ["HD Ticket", "priority", "==", "High"],
    ]);

    expect(toConditionExpression(tree)).toBe('status == "Open"');
  });
});

describe("toFrappeConditions / fromFrappeConditions", () => {
  it("round-trips a nested, mixed tree through the stored array", () => {
    const tree = group(
      [
        leaf("status", "equals", "Open"),
        group(
          [leaf("priority", "equals", "High"), leaf("agent", "is", "not set")],
          "or"
        ),
      ],
      "and"
    );

    const stored = toFrappeConditions(tree);

    expect(stored).toEqual([
      ["status", "equals", "Open"],
      "and",
      [["priority", "equals", "High"], "or", ["agent", "is", "not set"]],
    ]);
    expect(fromFrappeConditions(stored)).toEqual(tree);
  });

  it("drops a leading entry it cannot parse without stranding its operator", () => {
    // The dropped entry takes the token that followed it: kept, it would join
    // the level's first survivor to nothing and re-save as a leading `or`.
    expect(
      fromFrappeConditions([
        ["HD Ticket", "status", "==", "Open"],
        "or",
        ["priority", "==", "High"],
      ])
    ).toEqual(group([leaf("priority", "equals", "High")]));
  });

  it("keeps one gap per pair when a record repeats a token", () => {
    expect(
      fromFrappeConditions([
        ["status", "==", "Open"],
        "and",
        "or",
        ["priority", "==", "High"],
      ])
    ).toEqual(
      group(
        [leaf("status", "equals", "Open"), leaf("priority", "equals", "High")],
        "or"
      )
    );
  });
});
