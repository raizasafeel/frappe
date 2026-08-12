<!--
  The end of a row: a Remove button, and an overflow menu holding everything
  else — Move Up / Move Down / Turn into a Group / Ungroup. Turning a leaf into a
  group adds a node, so it is gated by `disabled`; the rest act on rows that
  already exist. `Button` overwrites `aria-label` from its `label` prop, so the
  icon-only triggers are named through `aria-labelledby` — including the row's
  field, so the Status row's menu is not one of eight identical ones.

  The move items are the keyboard path to what the drag handle does with a
  pointer: an action menu is more discoverable and more reliable than directional
  keys, and it keeps the row to one button that opens things.
-->
<template>
	<!-- `justify-self-end`: the row gives this cell every pixel the cells before it
	did not use, so that the menu can sit on the row's end edge rather than
	wherever the value control happened to stop. -->
	<div
		v-if="!context.readonly.value"
		data-slot="condition-actions"
		class="flex w-max items-center justify-self-end"
	>
		<!-- Before the Remove button in the DOM: focus is placed back on the first
		button in this cell after an edit, and the menu is the one that survives a
		move — the Remove button removes the row it sits in. -->
		<Dropdown v-if="options.length" placement="right" :options="options">
			<Button variant="ghost" icon="lucide-more-horizontal" :aria-labelledby="menuNameIds" />
		</Dropdown>
		<Button
			variant="ghost"
			icon="lucide-trash-2"
			:aria-labelledby="removeNameIds"
			@click="context.remove(path)"
		/>
		<span :id="menuNameId" class="sr-only">{{ menuName }}</span>
		<span :id="removeNameId" class="sr-only">{{ removeName }}</span>
	</div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { Button, Dropdown } from "frappe-ui";
import { useConditionBuilderContext } from "./context";
import { canNest } from "./tree";
import type { ConditionPath } from "./types";

const props = defineProps<{
	path: ConditionPath;
	isGroup: boolean;

	/** Id of the element holding this row's field label, rendered by the row. */
	fieldLabelId?: string;

	/** False for the first row of its group, which has nowhere above to go. */
	canMoveUp?: boolean;

	/** False for the last row of its group. */
	canMoveDown?: boolean;

	/**
	 * Reordering, handed down rather than run from here: the group holds the
	 * field label the move announces, and the row's index within it.
	 */
	moveUp?: () => void;
	moveDown?: () => void;
}>();

const context = useConditionBuilderContext();
const menuNameId = useId();
const removeNameId = useId();

function nameIds(own: string): string {
	return props.fieldLabelId ? `${props.fieldLabelId} ${own}` : own;
}

const menuNameIds = computed(() => nameIds(menuNameId));
const removeNameIds = computed(() => nameIds(removeNameId));

interface ActionItem {
	label: string;
	icon?: string;
	theme?: "red";
	onClick: () => void;
}

const menuName = computed(() =>
	props.isGroup ? context.labels.value.groupActions : context.labels.value.rowActions
);

const removeName = computed(() =>
	props.isGroup ? context.labels.value.removeGroup : context.labels.value.remove
);

const groupPath = computed(() => props.path.slice(0, -1));

const options = computed<ActionItem[]>(() => {
	const labels = context.labels.value;
	const items: ActionItem[] = [];

	if (props.canMoveUp && props.moveUp) {
		items.push({
			label: labels.moveUp,
			icon: "lucide-arrow-up",
			onClick: props.moveUp,
		});
	}

	if (props.canMoveDown && props.moveDown) {
		items.push({
			label: labels.moveDown,
			icon: "lucide-arrow-down",
			onClick: props.moveDown,
		});
	}

	// Wrapping a leaf puts a group where the leaf sits, which is the same reach as
	// adding a group to its parent — hence the parent's path here.
	if (
		!props.isGroup &&
		!context.disabled.value &&
		canNest(groupPath.value, context.maxDepth.value)
	) {
		items.push({
			label: labels.turnIntoGroup,
			icon: "lucide-group",
			onClick: () => context.turnIntoGroup(props.path),
		});
	}

	if (props.isGroup) {
		items.push({
			label: labels.ungroup,
			icon: "lucide-ungroup",
			onClick: () => context.ungroup(props.path),
		});
	}

	return items;
});
</script>
