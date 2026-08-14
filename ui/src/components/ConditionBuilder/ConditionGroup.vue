<!--
  One group of conditions, rendering its children and itself again for a nested
  group. The root is a `<fieldset>` with a hidden `<legend>`; nested groups use
  `role="group"`, announced on entry rather than before every control inside.
  `role="list"` stays explicit: WebKit drops list semantics under
  `list-style: none`, taking the item count with it.
-->
<template>
	<component
		:is="rootTag"
		data-slot="condition-group"
		:data-depth="path.length"
		:role="rootTag === 'fieldset' ? undefined : 'group'"
		:aria-label="rootTag === 'fieldset' ? undefined : groupName"
		class="flex w-full min-w-0 flex-col gap-4"
		:class="hasCard && 'rounded-lg border border-outline-gray-2 bg-surface-white p-3'"
	>
		<legend v-if="rootTag === 'fieldset'" class="sr-only">
			{{ groupName }}
		</legend>

		<!-- `header` placement: the group's one operator, and the buttons that add to
		it, on a bar of its own. The rows below then hold nothing but conditions —
		which is the point of the placement — and a nested card states how it joins
		the rules around it without a cell in the row it sits in. The control is
		hidden with fewer than two conditions rather than disabled: with no gap to
		operate on it would be a dead control, not a locked one. -->
		<div v-if="hasHeader" class="flex flex-wrap items-center justify-between gap-2">
			<TabButtons
				v-if="group.conditions.length > 1 && !context.readonly.value"
				:model-value="headerConjunction"
				:options="conjunctionOptions"
				:aria-label="context.labels.value.conjunctionHint"
				size="sm"
				@update:model-value="onHeaderConjunction"
			/>
			<div v-else-if="group.conditions.length > 1" class="text-p-base text-ink-gray-5">
				{{ headerWord }}
			</div>
			<span v-else />

			<div
				v-if="!context.readonly.value"
				class="flex"
				:data-add-group="path.join('.')"
				:data-condition-builder="context.builderId.value"
			>
				<slot name="addCondition" v-bind="addConditionProps()">
					<AddConditionButton :path="path" :can-add-group="canAddGroup" />
				</slot>
			</div>
		</div>

		<!-- Each row carries its own grid rather than sharing one with its siblings.
		A shared grid sizes each track from the widest cell in the group, so every
		field control is as wide as the longest label; per row, each control is the
		width of what it holds and the row reads as a phrase. What the rows still
		share is their end edge: the last track takes the leftover and pins the
		actions to the end of it, so they line up down the group whatever the cells
		before them hold. -->
		<Draggable
			v-if="group.conditions.length"
			:model-value="group.conditions"
			:item-key="keyOf"
			:disabled="!canReorder"
			handle=".condition-drag-handle"
			tag="ul"
			role="list"
			class="flex w-full min-w-0 list-none flex-col gap-4"
			@change="onDragChange"
		>
			<template #item="{ element: condition, index }">
				<li
					class="grid min-w-0 items-start gap-x-2"
					:style="{ gridTemplateColumns: trackListFor(condition) }"
					:data-condition-path="[...path, index].join('.')"
					:data-condition-builder="context.builderId.value"
				>
					<!-- The row owns the leading cell, not what goes in it: the band
					below is one control tall and centres its content, so the operator
					lines up with the controls beside it whether it is the built-in cell
					or a `#where` / `#conjunction` of the host's own — a bare word is
					half the height of a control and would otherwise sit above it. The
					band grows if what the host puts in it is taller.

					The bracket is drawn here too, for the same reason: it spans the
					row, which the cell inside it does not, and it is the group's mark
					rather than the cell's — replacing the cell should not erase it. -->
					<div
						v-if="!hasHeader"
						class="relative flex min-w-[66px] flex-col self-stretch"
					>
						<ConditionRule
							:index="index"
							:count="group.conditions.length"
							:offset="firstLineOffset(condition)"
						/>
						<div
							class="flex min-h-7 items-center justify-center"
							:style="firstLineStyle(condition)"
						>
							<slot v-if="index === 0" name="where" v-bind="whereProps()">
								<ConjunctionCell
									:index="index"
									:conjunction="conjunctionAt(index)"
									:can-toggle="canToggleAt(index)"
									:group-path="path"
								/>
							</slot>
							<slot v-else name="conjunction" v-bind="conjunctionProps(index)">
								<ConjunctionCell
									:index="index"
									:conjunction="conjunctionAt(index)"
									:can-toggle="canToggleAt(index)"
									:group-path="path"
								/>
							</slot>
						</div>
					</div>

					<!-- Pointer-only, and hidden from assistive tech: it duplicates no
					control, so there is nothing for it to name. A host that needs a
					keyboard path to the same edit builds one in `#actions`, which is
					handed `moveUp` / `moveDown` and their guards. -->
					<div
						v-if="canReorder"
						class="condition-drag-handle flex h-7 w-4 cursor-grab items-center justify-center"
						:style="firstLineStyle(condition)"
						aria-hidden="true"
					>
						<span class="lucide-grip-vertical size-4 text-ink-gray-4" />
					</div>

					<!-- A card gets a row of its own shape — one stretching track between
					the conjunction and the actions — so it runs to the end of the row
					rather than to wherever three content-sized cells happen to stop. A
					group past `modalDepth` is a button in an ordinary row, and spans the
					three the leaf would have used. -->
					<template v-if="isGroup(condition)">
						<div
							class="min-w-0"
							:style="childIsModal() ? { gridColumn: 'span 3' } : undefined"
						>
							<Button
								v-if="childIsModal()"
								data-slot="open-nested"
								variant="outline"
								class="w-max"
								:label="context.labels.value.openNested"
								aria-haspopup="dialog"
								:aria-expanded="nestedOpen === index"
								@click="nestedOpen = index"
							/>
							<ConditionGroup
								v-else
								:group="asGroup(condition)"
								:path="[...path, index]"
								:base-depth="baseDepth"
							>
								<template v-if="$slots.condition" #condition="slotProps">
									<slot name="condition" v-bind="slotProps" />
								</template>
								<template v-if="$slots.value" #value="valueProps">
									<slot name="value" v-bind="valueProps" />
								</template>
								<template v-if="$slots.where" #where="whereSlot">
									<slot name="where" v-bind="whereSlot" />
								</template>
								<template v-if="$slots.conjunction" #conjunction="conjSlot">
									<slot name="conjunction" v-bind="conjSlot" />
								</template>
								<template v-if="$slots.actions" #actions="actionsSlot">
									<slot name="actions" v-bind="actionsSlot" />
								</template>
								<template v-if="$slots.addCondition" #addCondition="addSlot">
									<slot name="addCondition" v-bind="addSlot" />
								</template>
							</ConditionGroup>
						</div>
					</template>

					<ConditionRow
						v-else
						:condition="condition"
						:path="[...path, index]"
						:field-label-id="rowFieldId(index)"
					>
						<template v-if="$slots.condition" #condition="slotProps">
							<slot name="condition" v-bind="slotProps" />
						</template>
						<template v-if="$slots.value" #value="valueProps">
							<slot name="value" v-bind="valueProps" />
						</template>
					</ConditionRow>

					<!-- The same first-line band as the leading cell, for the same
					reason: a host's `#actions` is level with the controls rather than
					with the top of a row that has grown. -->
					<div
						class="flex min-h-7 items-center justify-end justify-self-end"
						:style="firstLineStyle(condition)"
					>
						<slot name="actions" v-bind="actionsProps(index, isGroup(condition))">
							<ConditionActions
								:path="[...path, index]"
								:is-group="isGroup(condition)"
								:field-label-id="rowFieldId(index)"
							/>
						</slot>
					</div>

					<span :id="rowFieldId(index)" class="sr-only">
						{{ leafFieldLabel(condition, context.fields.value) }}
					</span>
				</li>
			</template>
		</Draggable>

		<!-- A header has already drawn this, above. -->
		<div
			v-if="!context.readonly.value && !hasHeader"
			class="flex"
			:data-add-group="path.join('.')"
			:data-condition-builder="context.builderId.value"
		>
			<slot name="addCondition" v-bind="addConditionProps()">
				<AddConditionButton :path="path" :can-add-group="canAddGroup" />
			</slot>
		</div>

		<Dialog
			:model-value="nestedGroup !== undefined"
			:title="context.labels.value.nestedTitle"
			size="3xl"
			@update:model-value="onNestedOpenChange"
		>
			<template #default>
				<ConditionGroup
					v-if="nestedGroup !== undefined && nestedOpen !== null"
					:group="nestedGroup"
					:path="[...path, nestedOpen]"
					:base-depth="path.length + 1"
				>
					<template v-if="$slots.condition" #condition="slotProps">
						<slot name="condition" v-bind="slotProps" />
					</template>
					<template v-if="$slots.value" #value="valueProps">
						<slot name="value" v-bind="valueProps" />
					</template>
					<template v-if="$slots.where" #where="whereSlot">
						<slot name="where" v-bind="whereSlot" />
					</template>
					<template v-if="$slots.conjunction" #conjunction="conjSlot">
						<slot name="conjunction" v-bind="conjSlot" />
					</template>
					<template v-if="$slots.actions" #actions="actionsSlot">
						<slot name="actions" v-bind="actionsSlot" />
					</template>
					<template v-if="$slots.addCondition" #addCondition="addSlot">
						<slot name="addCondition" v-bind="addSlot" />
					</template>
				</ConditionGroup>
			</template>
		</Dialog>
	</component>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { Button, Dialog, TabButtons } from "frappe-ui";
// @ts-ignore — vuedraggable ships no bundled types
import Draggable from "vuedraggable";
import type { FilterField } from "../Filter/types";
import AddConditionButton from "./AddConditionButton.vue";
import ConditionActions from "./ConditionActions.vue";
import ConditionRow from "./ConditionRow.vue";
import ConditionRule from "./ConditionRule.vue";
import ConjunctionCell from "./ConjunctionCell.vue";
import { useConditionBuilderContext } from "./context";
import { canNest, isGroup } from "./tree";
import type {
	ActionsSlotProps,
	AddConditionSlotProps,
	ConditionGroup as ConditionGroupType,
	ConditionPath,
	ConditionSlotProps,
	ConjunctionSlotProps,
	Conjunction,
	FieldConditionValue,
	ValueSlotProps,
	WhereSlotProps,
} from "./types";

defineOptions({ name: "ConditionGroup" });

const props = withDefaults(
	defineProps<{
		group: ConditionGroupType<unknown>;
		path: ConditionPath;

		/**
		 * Depth at which the current inline run started. A dialog hands back the
		 * width nesting had eaten, so it resets this to the group's own depth and
		 * `modalDepth` is measured from here rather than from the root.
		 */
		baseDepth?: number;
	}>(),
	{ baseDepth: 0 }
);

// Explicit slot types break the inference cycle self-recursion creates: the
// template passes this component's own slots back into itself.
interface GroupSlots {
	condition?(props: ConditionSlotProps<unknown>): any;
	value?(props: ValueSlotProps): any;
	where?(props: WhereSlotProps): any;
	conjunction?(props: ConjunctionSlotProps): any;
	actions?(props: ActionsSlotProps): any;
	addCondition?(props: AddConditionSlotProps): any;
}

defineSlots<GroupSlots>();

const context = useConditionBuilderContext();
const rowIdPrefix = useId();

const canAddGroup = computed(() => canNest(props.path, context.maxDepth.value));

/** Whether this group's rows can be dragged. A read-only tree cannot be edited
 * at all, and `disabled` blocks adding rather than rearranging. */
const canReorder = computed(() => context.reorderable.value && !context.readonly.value);

/**
 * A row's key: its index, which is what keeps a row's DOM — and the focus inside
 * it — in place across the commits an edit makes. Keying by the node's identity
 * would remount every row on every keystroke, since each edit clones the tree.
 * `indexOf` is by reference, and a group holds few enough rows for the scan.
 */
function keyOf(node: unknown): number {
	return props.group.conditions.indexOf(node);
}

interface DragChange {
	moved?: { element: unknown; oldIndex: number; newIndex: number };
}

/**
 * A drop. `change` rather than `update:modelValue`: it carries the two indices,
 * and the tree is edited by path, not by handing back a rearranged array.
 * vuedraggable has already put the dragged node back where it started by the
 * time this runs, so the commit below is what actually moves it.
 */
function onDragChange(event: DragChange) {
	const moved = event.moved;
	if (!moved) return;
	context.move(props.path, moved.oldIndex, moved.newIndex, {
		name: leafFieldLabel(moved.element, context.fields.value),
		// The pointer holds no focus to return, and stealing it after a drop would
		// put a focus ring somewhere the user never typed.
		focus: false,
	});
}

// Only nested groups draw their own card; the root's border is the builder's.
// `bordered: 'root'` drops these, so depth reads from indentation alone.
const isNested = computed(() => props.path.length > 0);
const hasCard = computed(() => isNested.value && context.bordered.value === "all");

// A `<fieldset>` groups form controls, so a read-only tree — which has none —
// uses the same `role="group"` as the nested levels.
const rootTag = computed(() => (!isNested.value && !context.readonly.value ? "fieldset" : "div"));

// A group is described by its conjunction, which is otherwise conveyed only by a
// button between rows — reached after the first condition, not before it. Mixed
// operators are neither "match all" nor "match any", so they get their own name.
const groupName = computed(() => {
	const labels = context.labels.value;
	const gaps = props.group.conjunctions;
	if (gaps.length === 0 || gaps.every((c) => c === "and")) return labels.matchAll;
	if (gaps.every((c) => c === "or")) return labels.matchAny;
	return labels.matchMixed;
});

/** The operator above row `index`, i.e. the gap that row's cell edits. */
function conjunctionAt(index: number): Conjunction {
	return props.group.conjunctions[index - 1] ?? "and";
}

/**
 * Whether row `index`'s cell is live. `mixed` gives every gap its own control;
 * in `uniform` the group carries one operator, so only the second row's control
 * is live and every row below it is locked.
 */
function canToggleAt(index: number): boolean {
	if (index < 1 || context.readonly.value) return false;
	return context.conjunctionMode.value === "mixed" || index === 1;
}

/** Whether this group states its operator at its top rather than in its rows. */
const hasHeader = computed(() => context.conjunctionPlacement.value === "header");

/**
 * The operator the header shows. A group whose gaps disagree — a tree authored
 * in `mixed` and opened under a header — has no one answer, so the control shows
 * neither until it is used, which then settles every gap at once.
 */
const headerConjunction = computed<Conjunction | undefined>(() => {
	const gaps = props.group.conjunctions;
	if (gaps.length === 0) return undefined;
	return gaps.every((gap) => gap === gaps[0]) ? gaps[0] : undefined;
});

const headerWord = computed(() => {
	const labels = context.labels.value;
	if (headerConjunction.value === undefined) return labels.matchMixed;
	return headerConjunction.value === "and" ? labels.and : labels.or;
});

const conjunctionOptions = computed(() => [
	{ label: context.labels.value.and, value: "and" },
	{ label: context.labels.value.or, value: "or" },
]);

function onHeaderConjunction(value: unknown) {
	if (value === "and" || value === "or") context.setConjunction(props.path, value);
}

/** The leading conjunction cell, wide enough for `Where` at any of its lengths. */
const CONJUNCTION_TRACK = "minmax(66px, max-content)";

/**
 * The trailing actions' track. It takes the row's leftover width rather than the
 * width of the buttons, and they sit at its end — so Remove lands on the
 * container's end edge in every row, with the slack the content-sized cells
 * before it did not use collecting harmlessly in between. `max-content` as the
 * floor keeps the buttons from being squeezed when a row has no slack to give.
 */
const ACTIONS_TRACK = "minmax(max-content, 1fr)";

/**
 * The handle's own track, and only where there is a handle: an empty one would
 * indent every row of a tree that cannot be rearranged. It sits after the
 * conjunction so the three content tracks stay the three a group's row spans.
 */
const handleTrack = computed(() => (canReorder.value ? ["max-content"] : []));

/** The row's leading cell, which a header has taken out of the row entirely. */
const conjunctionTrack = computed(() => (hasHeader.value ? [] : [CONJUNCTION_TRACK]));

const trackList = computed(() =>
	[
		...conjunctionTrack.value,
		...handleTrack.value,
		context.columns.value.field,
		context.columns.value.operator,
		context.columns.value.value,
		ACTIONS_TRACK,
	].join(" ")
);

/**
 * A card's row, whose middle is one stretching track rather than three sized to
 * their contents: a group has no field, operator or value of its own, and a card
 * that stopped where three content-sized cells stopped would leave its end edge
 * somewhere arbitrary instead of against the actions beside it.
 */
const groupTrackList = computed(() =>
	[...conjunctionTrack.value, ...handleTrack.value, "minmax(0, 1fr)", "max-content"].join(" ")
);

function trackListFor(node: unknown): string {
	return isInlineGroup(node) ? groupTrackList.value : trackList.value;
}

/** Whether `node` draws as a card in this row, rather than as a button or a leaf. */
function isInlineGroup(node: unknown): boolean {
	return isGroup(node) && !childIsModal();
}

/**
 * The card's own chrome above the first line inside it: its `border` and its
 * `p-3`. Both are written here, on the group element, so they move together.
 */
const CARD_FIRST_LINE = 13;

/**
 * How far into a row its first line starts. Zero for a leaf, whose controls
 * begin at the row's top edge — but a nested card's first rule begins inside the
 * card's border and padding, and the operator joining that card to the rules
 * above belongs beside that rule rather than beside the card's top edge, which is
 * a corner with nothing on it.
 *
 * A card is the only thing this component puts in a row that displaces its own
 * first line. A `#condition` that does the same — labels above its controls, a
 * leading margin — is the host's to place with `#where` / `#conjunction`, since
 * nothing here can measure it.
 */
function firstLineOffset(node: unknown): number {
	const drawsCard = isInlineGroup(node) && context.bordered.value === "all";
	return drawsCard ? CARD_FIRST_LINE : 0;
}

/** The offset as it is applied to the row's cells: the bracket takes the number. */
function firstLineStyle(node: unknown): { marginTop: string } | undefined {
	const offset = firstLineOffset(node);
	return offset ? { marginTop: `${offset}px` } : undefined;
}

/** Id of the span holding a row's field label, which names its controls. */
function rowFieldId(index: number): string {
	return `${rowIdPrefix}-${index}`;
}

/**
 * The field a leaf names, as text. Every control in a row is named after it, so
 * eight operator selects are told apart by more than the word "operator". A
 * fieldname with no Meta behind it shows as itself, since removing the row is the
 * only way to fix it; duck-typing on `fieldname` labels a custom leaf shape too.
 */
function leafFieldLabel(node: unknown, fields: FilterField[]): string {
	if (node === null || typeof node !== "object") return "";
	const fieldname = (node as Partial<FieldConditionValue>).fieldname;
	if (typeof fieldname !== "string" || fieldname === "") return "";
	return fields.find((f) => f.fieldname === fieldname)?.label ?? fieldname;
}

function whereProps(): WhereSlotProps {
	return { groupPath: props.path, conjunction: props.group.conjunctions[0] };
}

function conjunctionProps(index: number): ConjunctionSlotProps {
	return {
		conjunction: conjunctionAt(index),
		index,
		gap: index - 1,
		groupPath: props.path,
		toggle: () => context.toggleConjunction(props.path, index - 1),
		canToggle: canToggleAt(index),
	};
}

function actionsProps(index: number, group: boolean): ActionsSlotProps {
	const path = [...props.path, index];
	const last = props.group.conditions.length - 1;
	return {
		path,
		isGroup: group,
		disabled: context.disabled.value,
		readonly: context.readonly.value,
		canGroup: canNest(props.path, context.maxDepth.value),
		canMoveUp: canReorder.value && index > 0,
		canMoveDown: canReorder.value && index < last,
		moveUp: () => moveRow(index, index - 1),
		moveDown: () => moveRow(index, index + 1),
		turnIntoGroup: () => context.turnIntoGroup(path),
		ungroup: () => context.ungroup(path),
		remove: () => context.remove(path),
	};
}

/** A move run from a row's menu, which keeps its focus on the way. */
function moveRow(from: number, to: number) {
	context.move(props.path, from, to, {
		name: leafFieldLabel(props.group.conditions[from], context.fields.value),
	});
}

function addConditionProps(): AddConditionSlotProps {
	return {
		groupPath: props.path,
		addCondition: () => context.addCondition(props.path),
		addGroup: () => context.addGroup(props.path),
		canAddGroup: canAddGroup.value,
		disabled: context.disabled.value,
	};
}

const nestedOpen = ref<number | null>(null);

// Past `modalDepth` a child stops rendering inline: each level costs a card's
// border and padding, so deep trees run out of width. Depth counts from
// `baseDepth`, so the budget restarts inside each dialog — N levels inline, a
// dialog, N more inline — making the escape periodic rather than a fixed list.
function childIsModal(): boolean {
	return props.path.length + 1 - props.baseDepth > context.modalDepth.value;
}

/**
 * The open dialog's subject, resolved every render rather than captured on open:
 * emptying the group the dialog shows prunes it, leaving the index addressing
 * whatever moved into its place or nothing at all. Resolving each time closes the
 * dialog once its subject stops existing.
 */
const nestedGroup = computed<ConditionGroupType<unknown> | undefined>(() => {
	if (nestedOpen.value === null) return undefined;
	const node = props.group.conditions[nestedOpen.value];
	return node !== undefined && isGroup(node) ? node : undefined;
});

// The dialog is addressed by child index, and an index is only stable while this
// group's children are. Edits inside the open nested group leave the count here
// alone, so the dialog stays open for its own work and closes exactly when its
// subject may have moved. This also clears an index left set by a prune that
// closed the dialog without emitting `update:model-value`.
watch(
	() => props.group.conditions.length,
	() => {
		nestedOpen.value = null;
	}
);

// A removal at or above this group's path re-points the instances that rendered
// the later siblings, so this one may now be showing a different group with the
// same child count. A deeper removal — including one inside the open dialog —
// leaves it alone.
watch(
	() => context.lastRemoval.value,
	(removal) => {
		if (removal && isAtOrAbove(removal.path, props.path)) nestedOpen.value = null;
	}
);

/** Whether `edit` addresses this group or one of its ancestors. */
function isAtOrAbove(edit: ConditionPath, own: ConditionPath): boolean {
	return edit.length <= own.length && edit.every((index, depth) => index === own[depth]);
}

function onNestedOpenChange(open: boolean) {
	if (!open) nestedOpen.value = null;
}

// `v-if="isGroup(...)"` does not narrow the union for vue-tsc, hence the cast.
function asGroup(node: unknown) {
	return node as ConditionGroupType<unknown>;
}
</script>
