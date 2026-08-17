import type {
  ConditionGroup,
  ConditionNode,
  ConditionPath,
  Conjunction,
} from "./types";

/**
 * Groups are told apart from leaves structurally, so the model survives a JSON
 * round-trip with no discriminator field to keep in sync.
 */
export function isGroup<T>(node: ConditionNode<T>): node is ConditionGroup<T> {
  return (
    node !== null &&
    typeof node === "object" &&
    Array.isArray((node as ConditionGroup<T>).conjunctions) &&
    Array.isArray((node as ConditionGroup<T>).conditions)
  );
}

export function emptyTree<T>(): ConditionGroup<T> {
  return { conjunctions: [], conditions: [] };
}

/**
 * The conjunction a newly appended child joins on: the group's last one, so a
 * run of `and`s keeps extending and the toggle is only for breaking it. The
 * first gap is `and`, matching Frappe's own default.
 */
function nextConjunction<T>(group: ConditionGroup<T>): Conjunction {
  return group.conjunctions[group.conjunctions.length - 1] ?? "and";
}

/**
 * Every gap but the first needs an operator. Called after the push, so
 * `conditions` already counts the new child.
 */
function pushConjunction<T>(group: ConditionGroup<T>): void {
  if (group.conditions.length > 1)
    group.conjunctions.push(nextConjunction(group));
}

/**
 * Drop the gap the child at `index` displayed — the one above it, or below it
 * for the first child, which shows no operator of its own. Every surviving row
 * keeps the word it was already showing.
 */
function removeConjunctionAt<T>(group: ConditionGroup<T>, index: number): void {
  if (group.conjunctions.length === 0) return;
  group.conjunctions.splice(index === 0 ? 0 : index - 1, 1);
}

/**
 * A detached, proxy-free copy every operation starts from. `structuredClone`
 * keeps non-JSON values in a consumer's leaf (a `Date`, a `Map`) intact; a JSON
 * round-trip is the fallback for the shapes it refuses.
 */
function clone<T>(tree: ConditionGroup<T>): ConditionGroup<T> {
  try {
    return structuredClone(tree);
  } catch {
    return JSON.parse(JSON.stringify(tree));
  }
}

export function getNode<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath
): ConditionNode<T> | undefined {
  let node: ConditionNode<T> = tree;
  for (const index of path) {
    if (!isGroup(node)) return undefined;
    node = node.conditions[index];
    if (node === undefined) return undefined;
  }
  return node;
}

function parentOf<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath
): ConditionGroup<T> | undefined {
  const node = getNode(tree, path.slice(0, -1));
  return node !== undefined && isGroup(node) ? node : undefined;
}

/**
 * Every edit is the same three steps — clone, resolve, bail if the path names
 * nothing — around one mutation. Written once so a new operation cannot forget
 * the clone and mutate the tree the host still holds, and so "a path that no
 * longer resolves is a no-op" is one rule rather than nine copies of it.
 */
function editGroup<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  edit: (group: ConditionGroup<T>) => void
): ConditionGroup<T> {
  const next = clone(tree);
  const group = getNode(next, groupPath);
  if (group !== undefined && isGroup(group)) edit(group);
  return next;
}

/** The same, for an edit that addresses a child by its place in its parent. */
function editParent<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath,
  edit: (parent: ConditionGroup<T>, index: number) => void
): ConditionGroup<T> {
  const next = clone(tree);
  const parent = parentOf(next, path);
  if (parent) edit(parent, path[path.length - 1]);
  return next;
}

export function addCondition<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  leaf: T
): ConditionGroup<T> {
  return editGroup(tree, groupPath, (group) => {
    group.conditions.push(leaf);
    pushConjunction(group);
  });
}

export function addGroup<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  leaf: T
): ConditionGroup<T> {
  return editGroup(tree, groupPath, (group) => {
    group.conditions.push({ conjunctions: [], conditions: [leaf] });
    pushConjunction(group);
  });
}

export function removeNode<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath
): ConditionGroup<T> {
  if (path.length === 0) return emptyTree<T>();

  const next = clone(tree);
  const parent = parentOf(next, path);
  if (!parent) return next;

  const index = path[path.length - 1];
  parent.conditions.splice(index, 1);
  removeConjunctionAt(parent, index);

  // A group that just lost its last child goes with it.
  if (parent.conditions.length === 0 && path.length > 1) {
    return removeNode(next, path.slice(0, -1));
  }
  return next;
}

/**
 * Move a child within its own group. Reordering never reparents, so the tree's
 * shape — and every other row's path — survives the move.
 *
 * The operator travels with the row that displayed it, which is the rule
 * `removeConjunctionAt` already follows: the vacated gap closes the same way a
 * removal closes it, and the carried word reopens one at the destination. A row
 * dropped at the top displays no operator, so its word goes to the gap below it,
 * where the row it displaced now reads it.
 */
export function moveNode<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  from: number,
  to: number
): ConditionGroup<T> {
  return editGroup(tree, groupPath, (group) => {
    const last = group.conditions.length - 1;
    if (from === to || from < 0 || to < 0 || from > last || to > last) return;

    const [node] = group.conditions.splice(from, 1);
    const carried = group.conjunctions[from === 0 ? 0 : from - 1] ?? "and";
    removeConjunctionAt(group, from);

    group.conditions.splice(to, 0, node);
    // Only if the move re-opened a gap: a group of one has none to carry.
    if (group.conditions.length > 1) {
      group.conjunctions.splice(to === 0 ? 0 : to - 1, 0, carried);
    }
  });
}

export function updateLeaf<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath,
  leaf: T
): ConditionGroup<T> {
  return editParent(tree, path, (parent, index) => {
    parent.conditions[index] = leaf;
  });
}

export function turnIntoGroup<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath
): ConditionGroup<T> {
  return editParent(tree, path, (parent, index) => {
    const node = parent.conditions[index];
    if (node === undefined || isGroup(node)) return;
    parent.conditions[index] = { conjunctions: [], conditions: [node] };
  });
}

export function ungroup<T>(
  tree: ConditionGroup<T>,
  path: ConditionPath
): ConditionGroup<T> {
  if (path.length === 0) return clone(tree);

  return editParent(tree, path, (parent, index) => {
    const group = parent.conditions[index];
    if (group === undefined || !isGroup(group)) return;

    // An empty group leaves nothing behind, so this is a removal, gap and all.
    if (group.conditions.length === 0) {
      parent.conditions.splice(index, 1);
      removeConjunctionAt(parent, index);
      return;
    }

    parent.conditions.splice(index, 1, ...group.conditions);
    // Only the group's inner gaps insert: the gaps that joined it to its
    // siblings now join the outermost of those children, where they already sit.
    parent.conjunctions.splice(index, 0, ...group.conjunctions);
  });
}

/**
 * Flip one gap. `index` addresses `conjunctions` — the row's index minus one,
 * the gap above the row whose cell was clicked.
 */
export function toggleConjunction<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  index: number
): ConditionGroup<T> {
  return editGroup(tree, groupPath, (group) => {
    const current = group.conjunctions[index];
    if (current === undefined) return;
    group.conjunctions[index] = current === "and" ? "or" : "and";
  });
}

/**
 * Set every gap in a group at once. What a group header writes, and what a host
 * that wants one operator per group runs from the `#conjunction` slot.
 */
export function setGroupConjunction<T>(
  tree: ConditionGroup<T>,
  groupPath: ConditionPath,
  value: Conjunction
): ConditionGroup<T> {
  return editGroup(tree, groupPath, (group) => {
    group.conjunctions = group.conjunctions.map(() => value);
  });
}

/** The root group is depth 0, so a group at `path` sits at `path.length`. */
export function canNest(groupPath: ConditionPath, maxDepth: number): boolean {
  return groupPath.length < maxDepth;
}
