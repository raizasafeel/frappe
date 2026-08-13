<!--
  The leading cell of a condition row: "Where" on the first row of a group, and
  on every row after it the operator joining that row to the one above. Every row
  shows its operator, including the row a nested group's card sits in — a card
  with nothing in this cell reads as unattached to the rules above it.

  What `uniform` changes is how many of them are controls, not how many are
  shown: the group carries one operator, so the second row holds the button that
  rewrites it and the rows below render the word as text. Text, not a disabled
  button, for the reason `readonly` renders text: a disabled control is skipped
  in a screen reader's forms mode and is exempt from the contrast minimum.
  `Button` overwrites a fallthrough `aria-label` with its `label`, so what the
  control does goes on `aria-describedby`.
-->
<template>
	<div
		class="relative flex min-w-[66px] items-center justify-center self-stretch text-p-base text-ink-gray-5"
	>
		<!-- This row's two lengths of the group's bracket, drawn by the cell the
		word is in so they are centred on it whatever the conjunction track resolves
		to. Each outer end reaches half the row gap past the cell — `gap-y-4`, hence
		8px — so the lengths meet and the group reads as one rule rather than as
		ticks beside its rows; each inner end stops short of the word rather than
		running behind it, which keeps the rule off the text without needing the
		word to paint an opaque background over a surface it cannot know. -->
		<template v-if="drawsRule">
			<span
				v-if="index > 0"
				aria-hidden="true"
				class="absolute start-1/2 border-s border-outline-gray-2"
				:style="{ top: REACH, height: LENGTH }"
			/>
			<span
				v-if="index < count - 1"
				aria-hidden="true"
				class="absolute start-1/2 border-s border-outline-gray-2"
				:style="{ bottom: REACH, height: LENGTH }"
			/>
		</template>

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

const props = withDefaults(
	defineProps<{
		index: number;
		conjunction: Conjunction;
		groupPath: ConditionPath;

		/** Whether this gap's control is live. Decided by the group, not here. */
		canToggle?: boolean;

		/** How many rows the group holds, which is where the bracket ends. */
		count?: number;
	}>(),
	{ count: 0 }
);

const context = useConditionBuilderContext();
const labels = context.labels;
const hintId = useId();

const word = computed(() => (props.conjunction === "and" ? labels.value.and : labels.value.or));

/** Half of the group's `gap-y-4`, which each end reaches into to meet the next. */
const REACH = "-8px";

/**
 * How far each length runs: from half the row gap outside the cell to the edge
 * of the word at its middle. Half of the tallest thing the cell holds — the
 * chip — plus the reach, so a length never crosses what the row is showing.
 */
const LENGTH = "calc(50% - 6px)";

/** A group of one joins nothing, so it draws no rule. */
const drawsRule = computed(() => props.count > 1);
</script>
