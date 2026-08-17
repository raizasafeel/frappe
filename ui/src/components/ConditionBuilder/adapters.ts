import { getOperators } from "../Filter/operators";
import type { OperatorOption } from "../Filter/operators";
import type { FilterOperator } from "../Filter/types";
import { isGroup } from "./tree";
import type {
  ConditionGroup,
  ConditionNode,
  ConditionValue,
  Conjunction,
  FieldConditionValue,
} from "./types";

type Leaf = FieldConditionValue;
type Node = ConditionNode<Leaf>;

const UNWRITABLE_OPERATORS: FilterOperator[] = ["timespan"];
const IS_NOT: OperatorOption = { label: "Is not", value: "is not" };

/**
 * The operators this component can write. The host's compiler implements
 * `is not`, and has no rule for `timespan` — which would raise when the rule
 * runs. `getOperators` returns a fresh array, so it is safe to reshape.
 */
export function conditionOperators(
  fieldtype: string,
  fieldname?: string
): OperatorOption[] {
  const offered = getOperators(fieldtype, fieldname).filter(
    (option) => !UNWRITABLE_OPERATORS.includes(option.value)
  );
  const is = offered.findIndex((option) => option.value === "is");
  if (is !== -1) offered.splice(is + 1, 0, IS_NOT);
  return offered;
}

/**
 * Operators accepted on the way in, mapped to the vocabulary the tree stores.
 * The host's compiler treats `equals`, `=` and `==` alike, so Python's own
 * tokens read as aliases. An entry on an unlisted operator is dropped.
 */
const READ_OPERATOR: Record<string, FilterOperator> = {
  "==": "equals",
  "=": "equals",
  equals: "equals",
  "!=": "not equals",
  "not equals": "not equals",
  like: "like",
  "not like": "not like",
  in: "in",
  "not in": "not in",
  is: "is",
  "is not": "is not",
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
  between: "between",
  timespan: "timespan",
};

/**
 * Convert a tree to the interleaved array that Frappe's Assignment Rule and
 * SLA condition fields persist. One gap, one token, in order — the array is
 * per-gap too, so a mixed level needs no flattening in either direction.
 */
export function toFrappeConditions(tree: ConditionGroup<Leaf>): unknown[] {
  const out: unknown[] = [];
  let written = 0;

  tree.conditions.forEach((node, index) => {
    // A row with no field holds no condition, so dropping it is lossless.
    if (!isGroup(node) && !node.fieldname) return;

    const encoded = nodeToFrappe(node);

    // The host's compiler destructures a field/operator/value out of every
    // entry, so a group that encodes to nothing is dropped rather than written
    // as `[]`. `removeNode` prunes them, so only a hand-written record gets here.
    if (isGroup(node) && Array.isArray(encoded) && encoded.length === 0) return;

    // `written`, not `index`, so a skipped entry cannot leave the array starting
    // on a conjunction. Each survivor keeps the token that sat above it.
    if (written > 0) out.push(tree.conjunctions[index - 1] ?? "and");
    out.push(encoded);
    written += 1;
  });

  return out;
}

function nodeToFrappe(node: Node): unknown {
  if (isGroup(node)) return toFrappeConditions(node);
  return [node.fieldname, node.operator, node.value];
}

/**
 * Parse the interleaved array back into a tree. An entry this parser cannot
 * model — a doctype-qualified filter, an unlisted operator, a stray token — is
 * dropped, so a record holding one is edited without it and saved without it. A
 * mixed level stays flat, one token per gap: `safe_eval` binds `and` tighter
 * than `or`, so nesting adds nothing.
 */
export function fromFrappeConditions(
  conditions: unknown
): ConditionGroup<Leaf> {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { conjunctions: [], conditions: [] };
  }

  const nodes: Node[] = [];
  const seps: Conjunction[] = [];
  let pendingSep: Conjunction | null = null;

  for (const item of conditions) {
    const sep = asConjunction(item);
    if (sep !== null) {
      pendingSep = sep;
      continue;
    }
    const node = frappeToNode(item);
    // A dropped entry takes its pending token with it: kept, that token would
    // re-join the entry's neighbours on a conjunction nobody wrote, or leave the
    // level starting on one.
    if (node === null) {
      pendingSep = null;
      continue;
    }

    if (nodes.length > 0) seps.push(pendingSep ?? "and");
    nodes.push(node);
    pendingSep = null;
  }

  return { conjunctions: seps, conditions: nodes };
}

/**
 * The separator tokens, case-insensitively. Frappe writes them lowercase, but a
 * record hand-edited or produced by another tool can carry `"OR"` — matched
 * here, since sending it down the operand path would invert the rule.
 */
function asConjunction(item: unknown): Conjunction | null {
  if (typeof item !== "string") return null;
  const token = item.trim().toLowerCase();
  return token === "and" || token === "or" ? token : null;
}

/** A node, or null for an entry this parser cannot model. */
function frappeToNode(item: unknown): Node | null {
  if (Array.isArray(item)) {
    // A new, still-empty group is persisted as `[]`; read it back as an empty group.
    if (item.length === 0) return { conjunctions: [], conditions: [] };

    // A group's first element is itself an array; a leaf's is a fieldname.
    if (Array.isArray(item[0])) return fromFrappeConditions(item);
  }

  if (Array.isArray(item) && item.length === 3 && typeof item[0] === "string") {
    const token = String(item[1]).toLowerCase();
    // `hasOwn`, not a bare index: a stored operator named `constructor` would
    // otherwise resolve through `Object.prototype` and pass the check below.
    const operator = Object.hasOwn(READ_OPERATOR, token)
      ? READ_OPERATOR[token]
      : undefined;
    if (operator) {
      return {
        fieldname: item[0],
        operator,
        value: item[2] as ConditionValue,
      };
    }
  }

  // Not a shape this parser can model: wrong length, doctype-qualified, an
  // unlisted operator, or not an array at all.
  return null;
}
