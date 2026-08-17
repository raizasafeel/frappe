# ConditionBuilder

A nested tree of conditions joined by AND / OR — the control behind an
Assignment Rule's conditions, an SLA's, or any rule that needs `A and (B or C)`.
Grouping, conjunction toggling and add/remove belong to the component; the row is
a slot, so it fits doctype field conditions and domain-specific rules alike.

`Filter` is the flat, AND-only version of the same idea. Both read their
operator tables and value controls from the same modules, so they cannot drift.
See [ADR-0008](../../../docs/adr/0008-conditionbuilder-composes-filter-rules.md).

```ts
import { ConditionBuilder } from "@framework/ui/ConditionBuilder";
import type { ConditionGroup, FilterField } from "@framework/ui/ConditionBuilder";
```

An app that aliases the package to its source directory rather than resolving
`exports` imports `@framework/ui/components/ConditionBuilder`.

## Fields

Either give it a `doctype` and let it derive fields from Meta, as `Filter` does:

```vue
<ConditionBuilder v-model="conditions" doctype="ToDo" />
```

…or supply them yourself, in the same `FilterField` shape (`options` is Frappe's
newline-joined string):

```vue
<ConditionBuilder v-model="conditions" :fields="fields" />
```

`doctype` is read once at setup, so a host that switches doctype should remount
with `:key`. When the Meta request fails the component says so and offers a
retry, rather than presenting every row as though its field had been deleted.

## The model

```ts
{
  // one operator per gap: conjunctions[i] joins conditions[i] to conditions[i + 1]
  conjunctions: ["and", "or"],
  conditions: [
    { fieldname: "status", operator: "equals", value: "Open" },
    { fieldname: "subject", operator: "like", value: "refund" },
    {
      conjunctions: [],
      conditions: [{ fieldname: "priority", operator: "equals", value: "High" }],
    },
  ],
}
```

A group is anything with a `conjunctions` and a `conditions` array; everything
else is a leaf. The distinction is structural on purpose, so the tree survives a
JSON round-trip with no discriminator to keep in sync.

`conjunctions` always holds `conditions.length - 1` entries. A mixed level means
what Python means, since the array it compiles to is evaluated by `safe_eval`:
`and` binds tighter than `or`. Nest a group to override that.

`modelValue` is required and the component holds nothing of its own: an edit is
an emit, and a host that drops it renders a tree that does not move. `null` is
an empty tree — what a nullable backend field bound straight to `v-model`
arrives as — so the only thing left for a missing prop to mean is a wiring
mistake, which is worth failing on.

### One operator per group

Every gap carries its own and/or, so one level can read `A and B or C`. The
operators sit on a rule drawn down the start edge of the group, so what a chip
joins is visible rather than inferred from the row it happens to sit on. Every
row shows its operator, including the row a nested group's card sits in — a card
with nothing in that cell reads as unattached.

CRM and Helpdesk instead give a whole group a single operator. That is a host
policy, not a mode here — apply it from the `#conjunction` slot, where
`setGroupConjunction` writes every gap in the group at once:

```vue
<template #conjunction="{ conjunction, groupPath }">
  <Button
    :label="conjunction"
    @click="tree = setGroupConjunction(tree, groupPath, conjunction === 'and' ? 'or' : 'and')"
  />
</template>
```

### Rows taller than one line

A row is as tall as its condition, and a condition is free to grow: a hint under
a control, a wrapped value, a second row of inputs. The operator, the drag handle
and the actions menu are anchored to the row's **first line** rather than centred
in it, so a condition that grows downward does not carry its operator halfway
down beside nothing.

The first line is assumed to be one control tall, which is what the built-in leaf
renders. A `#condition` slot that leads with something taller — visible field
labels above its controls, say — will show the operator beside that instead. Use
`#where` / `#conjunction` to place it yourself in that case; they exist for it.

A row holding a nested group is the one row whose first line is not at its top
edge, and the component accounts for it: the card draws its own border and
padding, so the first line of that row is the first rule _inside_ the card, and
the operator, handle and menu drop to meet it — a card's operator belongs beside
the rule it introduces, not beside the card's empty top corner. Under
`bordered="root"` or `"none"` there is no card and so no drop.

## Reordering

Rows can be dragged within their group by the handle beside the operator, which
announces where the row came from and where it landed. `reorderable: false` turns
the handles off.

Dragging is the only built-in path, so it is pointer-only. `#actions` is handed
`moveUp` / `moveDown` and their guards, so a host that needs a keyboard path puts
its own items in that menu; they run the same edit and announce the same
sentence.

A move never reparents: a row cannot leave the group it is in, and dropping one
on a nested group's card does not put it inside. Grouping stays an explicit
`Turn into a Group` / `Add Condition Group`, so a drag can change the order a
group reads in but never its shape.

The operator travels with the row that displayed it, which is the rule a removal
already follows. Moving `C` to the top of `A and B or C` gives `C or A and B`:
the word `C` showed is now above `A`.

Order is meaning in a group whose gaps disagree, so a move there can change what
the rule matches — `A and B or C and D`, with `B` dragged to the end, is
`A or C and D and B`. That is the level being what it says it is, not the drag
misbehaving: `and` binds tighter than `or`, so which rows sit either side of an
`or` is the rule. Where every gap holds the same operator — a group the host
keeps uniform — a move cannot change the rule at all.

## Operators

Reading is wider than writing: the reader accepts every operator the stored
format can hold, and a leaf keeps a stored operator in its own dropdown even
when the field's own operator list would not offer it today — a saved rule is
always legible, and is only rewritten deliberately.

Writing is narrower than `Filter`'s list. `is not` is offered because the host's
compiler implements it; `timespan` is withheld because the host's compiler has
no rule for it and would emit an expression that raises whenever the rule runs.

## Persisting

Frappe's Assignment Rule and SLA condition fields store an array that interleaves
conjunctions between conditions. Convert at the persistence boundary:

```ts
import {
  fromFrappeConditions,
  toFrappeConditions,
} from "@framework/ui/ConditionBuilder";

const tree = fromFrappeConditions(JSON.parse(doc.assign_condition_json || "[]"));
doc.assign_condition_json = JSON.stringify(toFrappeConditions(tree));
```

A level that mixes `and` and `or` stays flat and stays mixed, one token per gap.
Separator tokens are matched case-insensitively, since a record hand-edited or
written by another tool can carry `"OR"`, and reading that as an operand would
invert the rule.

An entry that cannot be parsed as a condition — an unknown operator, a
doctype-qualified filter, a stray `null`, number or token between two filters —
is **dropped**, along with the conjunction beside it. The tree is what the editor
shows and what the next save writes, so such an entry is gone from the record
rather than carried through it.

Two things are dropped rather than written: an empty group, and a row the user
added but never gave a field to. Both are lossless — neither holds a condition —
and both would otherwise be written as an entry the host's compiler cannot
destructure into a field, an operator and a value.

A stored `==`, `=` or `!=` is read as an alias and re-saved in this component's
vocabulary. No migration is needed: the host's compiler maps `equals`, `=` and
`==` onto the same `==`, so the compiled expression does not change.

## Slots

| Slot | Replaces |
| --- | --- |
| `#condition` | the whole row, for a leaf of your own shape |
| `#value` | only the value control inside the built-in row |
| `#where` / `#conjunction` | the leading cell of a row |
| `#actions` | the row's overflow menu |
| `#addCondition` | a group's add affordance |
| `#empty` | the empty state's content |

Supplying an empty template removes that furniture entirely.

## Props worth knowing

| Prop | Does |
| --- | --- |
| `columns` | the three cells' grid track sizes |
| `maxDepth` | how deep nesting is offered (default 4) |
| `modalDepth` | where nesting escapes into a dialog (default 2) |
| `bordered` | `all` / `root` / `none` — which groups draw a card |
| `newCondition` | factory for a new leaf, when `#condition` is used |
| `labels` | every string it renders, for `__()` |
| `disabled` | blocks *adding*; existing rows stay editable |
| `readonly` | nothing is editable; the tree renders as text |
| `reorderable` | whether rows can be dragged or moved (default true) |

`disabled` is for a form failing validation: no new conditions, but the ones
there can still be fixed or removed. `readonly` shows a rule you are not editing.

## Accessibility

- A group is a `<fieldset>` at the root and `role="group"` nested, named from its
  own conjunction — nested `<legend>`s are read before every control, and a
  fixed name would state the opposite the moment the conjunction is toggled.
- Rows are a real list, so position is announced without a name to keep in sync.
- Every control is named by `aria-labelledby` against the row's field, so eight
  operator selects are told apart ("Status, operator"). Attribute fallthrough is
  not used: `Button` overwrites `aria-label` from `label`, and `Combobox` never
  passes attrs to its trigger.
- Removing a row moves focus to the row that took its place, and announces the
  count — plus the cascade, when the group went with it.
- The drag handle is `aria-hidden`: it duplicates no control and names nothing.
  **Reordering has no built-in keyboard path** — a known gap, and the reason
  `#actions` is handed `moveUp` / `moveDown`. Where a host adds them, the move
  announces both positions (a position alone means nothing to someone who did not
  watch it move) and returns focus to the menu it was run from.
- `readonly` renders text rather than disabled controls: a disabled control is
  skipped in a screen reader's forms mode and is exempt from the contrast
  minimum, which would make a read-only tree unreadable.

Known gap: the date and rating value controls drop attributes, so their cell
carries the name instead of the control. Fixing that needs an `aria-labelledby`
passthrough on the shared `Fields` components and frappe-ui's `DateRangePicker`.
