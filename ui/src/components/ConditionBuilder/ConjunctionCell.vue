<!--
  The leading cell of a condition row: "Where" on the first row of a group, and
  on every row after it the operator joining that row to the one above. The cell
  sits on the group's bracket, so its chip is centred on the rule the bracket
  draws and paints over it.

  In `uniform` mode the group carries one operator, so only the second row shows
  a chip and the rows below it show nothing — one word per group, rather than the
  same word repeated down a column with every copy but the first inert. A
  read-only tree renders the word as text. `Button` overwrites a fallthrough
  `aria-label` with its `label`, so what the control does goes on
  `aria-describedby`.
-->
<template>
	<div
		class="relative flex min-w-[66px] items-center justify-center self-stretch text-p-base text-ink-gray-5"
	>
		<!-- This row's length of the group's bracket, drawn by the cell the chip is
		in so it is centred on the chip whatever the cell's width resolves to. Each
		end reaches half the row gap past the cell — `gap-y-4`, hence 8px — so the
		lengths meet and the group reads as one rule rather than as ticks beside its
		rows. It runs between the chips it joins: from the middle of the first row,
		clear of the `Where` above it, to the middle of the last. -->
		<span
			v-if="rule"
			aria-hidden="true"
			class="absolute start-1/2 border-s border-outline-gray-2"
			:style="rule"
		/>

		<div v-if="index === 0">{{ labels.where }}</div>
		<template v-else-if="showsWord">
			<Button
				v-if="!context.readonly.value"
				variant="subtle"
				class="w-max"
				iconRight="lucide-refresh-cw"
				:label="word"
				:aria-describedby="canToggle ? hintId : undefined"
				@click="canToggle && context.toggleConjunction(groupPath, index - 1)"
			/>
			<div v-else class="bg-surface-white px-1">{{ word }}</div>
			<span v-if="canToggle" :id="hintId" class="sr-only">
				{{ labels.conjunctionHint }}
			</span>
		</template>

		<!-- The operator this row is joined on is not shown, so it is said instead:
		without it a row past the second in a uniform group reads as unattached. -->
		<span v-else class="sr-only">{{ word }}</span>
	</div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { Button } from "frappe-ui";
import { useConditionBuilderContext } from "./context";
import type { ConditionPath, Conjunction } from "./types";

const props = defineProps<{
	index: number;
	conjunction: Conjunction;
	groupPath: ConditionPath;

	/** Whether this gap's control is live. Decided by the group, not here. */
	canToggle?: boolean;

	/** How many rows the group holds, which is where the bracket ends. */
	count?: number;
}>();

const context = useConditionBuilderContext();
const labels = context.labels;
const hintId = useId();

const word = computed(() => (props.conjunction === "and" ? labels.value.and : labels.value.or));

/**
 * Whether this row draws the operator at all. Every gap carries its own in
 * `mixed`; in `uniform` the group has one, and the second row is where it is
 * shown — which is also the only row whose control is live.
 */
const showsWord = computed(() => context.conjunctionMode.value === "mixed" || props.index === 1);

/** Half of the group's `gap-y-4`, which each end reaches into to meet the next. */
const REACH = "-8px";

/** Half the line height of the cell's own text, which the rule starts clear of. */
const CLEAR_OF_TEXT = "calc(50% + 12px)";

/**
 * This row's length of the bracket, or nothing for a group of one — which joins
 * nothing and so draws no rule. The rule runs between the ends it joins rather
 * than the full height of the group: it starts under the `Where` naming the
 * group, and stops at the middle of the last row instead of trailing off into
 * the gap below it.
 */
const rule = computed(() => {
	const count = props.count ?? 0;
	if (count < 2) return undefined;
	return {
		top: props.index === 0 ? CLEAR_OF_TEXT : REACH,
		bottom: props.index === count - 1 ? "50%" : REACH,
	};
});
</script>
