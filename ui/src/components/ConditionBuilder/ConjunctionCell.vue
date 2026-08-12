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
	<div class="flex min-w-[66px] items-center justify-center text-p-base text-ink-gray-5">
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
</script>
