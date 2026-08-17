import { getOperators } from "../Filter/operators";
import type { OperatorOption } from "../Filter/operators";
import type { FilterField, FilterOperator } from "../Filter/types";
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

/**
 * The tree helpers a host needs beside the conversions: a fresh tree, telling a
 * group from a leaf, and setting one operator across a group. Re-exported rather
 * than moved so that `tree.ts` stays what it is — the edit primitives the
 * component runs on, which a consumer has no reason to reach for — while this
 * file is the whole of the API that is not the component itself.
 */
export { emptyTree, isGroup, setGroupConjunction } from "./tree";

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

export interface ConditionExpressionOptions {
  /**
   * Prefix every fieldname with this and a dot — `doc` for the `doc.status` an
   * Assignment Rule is evaluated against. Left off, fieldnames are emitted bare.
   */
  fieldPrefix?: string;

  /**
   * The doctype's filterable fields, for the two rules that cannot be decided
   * from a condition alone: a Check field compiles to its own truthiness, and a
   * numeric field compiles to a number rather than a quoted string, which is
   * what `doc.grand_total > "100"` would otherwise raise on. Without them both
   * fall back to reading the value — `"Yes"` is taken for a Check, and every
   * value is quoted — which is what the compilers in CRM and Helpdesk do.
   *
   * `ConditionBuilder` passes the fields it already derived from `doctype`, so
   * a host binding `v-model:expression` gets this for free.
   */
  fields?: FilterField[];
}

/**
 * Compile a tree into the Python expression `safe_eval` runs — the executable
 * half of what a host persists, next to the array `toFrappeConditions` writes.
 * Without this every consumer writes the compiler again, and the operators it
 * has to implement are not a `join(" and ")`: `like` is a membership test, `is
 * set` is the bare field, a Check field's `== "Yes"` is the bare field too.
 *
 * Compiled through `toFrappeConditions`, so a row without a field is treated
 * exactly as it is on save — dropped.
 */
export function toConditionExpression(
  tree: ConditionGroup<Leaf>,
  options: ConditionExpressionOptions = {}
): string {
  return compileEntries(toFrappeConditions(tree), options);
}

/**
 * Split one level of the array into its operands and the separators between
 * them, running each entry through `read`. An entry `read` makes nothing of
 * takes its pending separator with it, which is right at either end: a dropped
 * first entry has none pending, so the token after it is never kept either.
 *
 * Both directions need exactly this — reading a stored array into a tree, and
 * compiling one into an expression — and the rule is subtle enough that a second
 * copy of it would eventually disagree with this one.
 */
function foldEntries<T>(
  entries: unknown[],
  read: (entry: unknown) => T | null
): { items: T[]; separators: Conjunction[] } {
  const items: T[] = [];
  const separators: Conjunction[] = [];
  let pending: Conjunction | null = null;

  for (const entry of entries) {
    const token = asConjunction(entry);
    if (token !== null) {
      pending = token;
      continue;
    }

    const item = read(entry);
    if (item === null) {
      pending = null;
      continue;
    }

    if (items.length > 0) separators.push(pending ?? "and");
    items.push(item);
    pending = null;
  }

  return { items, separators };
}

/** One level of the array, as the expression it evaluates to. */
function compileEntries(
  entries: unknown[],
  options: ConditionExpressionOptions
): string {
  const { items, separators } = foldEntries(entries, (entry) => {
    const compiled = compileEntry(entry, options);
    return compiled === "" ? null : compiled;
  });

  return items.reduce(
    (expression, operand, index) =>
      index === 0
        ? operand
        : `${expression} ${separators[index - 1]} ${operand}`,
    ""
  );
}

/**
 * A nested group is parenthesised, so the tree's own shape decides the reading
 * rather than Python's precedence — the one place the two disagree is exactly
 * the group a user nested to say `(a or b) and c`.
 */
function compileEntry(
  entry: unknown,
  options: ConditionExpressionOptions
): string {
  if (Array.isArray(entry) && Array.isArray(entry[0])) {
    const nested = compileEntries(entry, options);
    return nested === "" ? "" : `(${nested})`;
  }
  return compileLeaf(entry, options);
}

/**
 * The operators that compile to a different Python token than they are written
 * with. Anything absent is emitted as it stands: a legacy `timespan` has no
 * rule here — which is why `conditionOperators` will not write a new one — and
 * emitting it unchanged keeps the record legible instead of silently altering
 * what the rule matches.
 */
const PYTHON_OPERATOR: Record<string, string> = {
  equals: "==",
  "=": "==",
  "==": "==",
  "not equals": "!=",
  "!=": "!=",
};

/** Fieldtypes whose value is a number in the document, not a string. */
const NUMERIC_FIELDTYPES = ["Int", "Float", "Currency", "Percent", "Rating"];

/** The comparisons a number is worth emitting bare for. */
const SCALAR_COMPARISONS = ["==", "!=", "<", "<=", ">", ">="];

function compileLeaf(
  entry: unknown,
  options: ConditionExpressionOptions
): string {
  if (
    !Array.isArray(entry) ||
    entry.length !== 3 ||
    typeof entry[0] !== "string"
  ) {
    return "";
  }

  const [fieldname, rawOperator, value] = entry;
  const { fieldPrefix, fields } = options;
  const field = fieldPrefix ? `${fieldPrefix}.${fieldname}` : fieldname;
  const token = String(rawOperator).toLowerCase();
  const operator = PYTHON_OPERATOR[token] ?? token;
  const fieldtype = fields?.find((f) => f.fieldname === fieldname)?.fieldtype;

  // A Check field holds the string "Yes"/"No" and compiles to the field itself:
  // the document's value is a 0/1, which `== "Yes"` never matches. Given fields,
  // the fieldtype decides and the guessing stops — including for a fieldname
  // they do not carry, which is a field the rule has outlived rather than a
  // Check. Given none, the value is all there is to go on and a Data field
  // holding the word "Yes" reads as a Check, which is what CRM's and Helpdesk's
  // compilers do.
  const check = String(value).trim().toLowerCase();
  const isCheck =
    fields !== undefined
      ? fieldtype === "Check"
      : check === "yes" || check === "no";
  if (
    (operator === "==" || operator === "!=") &&
    isCheck &&
    (check === "yes" || check === "no")
  ) {
    return (check === "yes") === (operator === "==") ? field : `not ${field}`;
  }

  // `is`/`is not` take Set or Not Set, and all four pairings resolve to the
  // field's truthiness. CRM's compiler leaves `is not` + `not set` to fall
  // through to `field is not "not set"`, which is true of every document.
  if (operator === "is" || operator === "is not") {
    if (check === "set" || check === "not set") {
      return (check === "set") === (operator === "is") ? field : `not ${field}`;
    }
  }

  // `like` is not a Python operator. The `field and` guard is what keeps a null
  // field out of the membership test, where it would raise rather than not match.
  if (operator === "like") return `(${field} and ${quote(value)} in ${field})`;
  if (operator === "not like")
    return `(${field} and ${quote(value)} not in ${field})`;

  if (operator === "in" || operator === "not in") {
    const items = asList(value).map(quote).join(", ");
    return `(${field} and ${field} ${operator} [${items}])`;
  }

  // `between` is two comparisons. The range arrives as a `[from, to]` pair from
  // the range picker and as a comma string from a record written by hand.
  const range = operator === "between" ? asRange(value) : null;
  if (range) {
    return `(${field} >= ${quote(range[0])} and ${field} <= ${quote(
      range[1]
    )})`;
  }

  // An unset value is the field's own falsiness, since there is no literal to
  // compare against — `field == None` is not what an empty condition means.
  if (value === null || value === undefined) {
    return operator === "==" || operator === "is" ? `not ${field}` : field;
  }

  // A numeric field's value is a number in the document, so a quoted one raises
  // rather than compares: `doc.grand_total > "100"` is a TypeError, not False.
  if (
    fieldtype !== undefined &&
    NUMERIC_FIELDTYPES.includes(fieldtype) &&
    SCALAR_COMPARISONS.includes(operator)
  ) {
    const number = Number(value);
    if (String(value).trim() !== "" && !Number.isNaN(number)) {
      return `${field} ${operator} ${number}`;
    }
  }

  if (typeof value === "number") return `${field} ${operator} ${value}`;
  // Python's booleans, not JavaScript's: `true` is a NameError under `safe_eval`.
  if (typeof value === "boolean")
    return `${field} ${operator} ${value ? "True" : "False"}`;

  return `${field} ${operator} ${quote(value)}`;
}

/** A Python string literal. The backslash goes first, or it escapes the escapes. */
function quote(value: unknown): string {
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** `in`'s operand: a list as it stands, a comma string as its parts. */
function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  if (typeof value === "string")
    return value.split(",").map((item) => item.trim());
  return [value];
}

/** `between`'s two ends, or null for a value that names only one of them. */
function asRange(value: unknown): [unknown, unknown] | null {
  if (Array.isArray(value))
    return value.length === 2 ? [value[0], value[1]] : null;
  if (typeof value !== "string" || !value.includes(",")) return null;
  const [from, to] = value.split(",").map((part) => part.trim());
  return [from, to];
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

  const { items, separators } = foldEntries(conditions, frappeToNode);
  return { conjunctions: separators, conditions: items };
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
