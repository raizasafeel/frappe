<!--
  What goes in a row's leading cell: "Where" on the first row of a group, and on
  every row after it the operator joining that row to the one above. Every row
  shows its operator, including the row a nested group's card sits in — a card
  with nothing in this cell reads as unattached to the rules above it.

  The cell around it — its width, the band that keeps it level with the controls,
  and the bracket it sits on — belongs to the row. This renders the word and
  nothing else, so a host replacing it through `#where` / `#conjunction` keeps all
  three.

  Every gap carries its own operator, so every row after the first holds a
  button. A read-only tree renders the word as text rather than a disabled
  button: a disabled control is skipped in a screen reader's forms mode and is
  exempt from the contrast minimum. `Button` overwrites a fallthrough
  `aria-label` with its `label`, so what the control does goes on
  `aria-describedby`.
-->
<template>
	<div class="text-p-base text-ink-gray-5">
		<div v-if="index === 0">{{ labels.where }}</div>
		<template v-else>
			<Button
				v-if="canToggle"
				variant="subtle"
				class="w-max"
				iconRight="lucide-refresh-cw"
				:label="word"
				:aria-describedby="hintId"
				@click="context.toggleConjunction(groupPath, index - 1)"
			/>
			<div v-else>{{ word }}</div>
			<span v-if="canToggle" :id="hintId" class="sr-only">
				{{ labels.conjunctionHint }}
			</span>
		</template>
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
</script>
