<!--
  The group's bracket, as it passes one row: a rule down the leading cells, with
  the operator sitting on it.

  Drawn as two lengths rather than one, so it stops short of the word instead of
  running behind it — a chip could paint over a rule it covered, a bare word
  cannot, and neither can know what surface it is on. It is measured from the
  row's first line, not from the middle of the row: a condition is free to grow
  downward, and the length below simply runs further when it does.

  Positioned against the cell that holds it, so it stays centred on the word
  whatever width the conjunction track resolves to.
-->
<template>
	<template v-if="count > 1">
		<span
			v-if="index > 0"
			aria-hidden="true"
			class="absolute start-1/2 border-s border-outline-gray-2"
			:style="above"
		/>
		<span
			v-if="index < count - 1"
			aria-hidden="true"
			class="absolute start-1/2 border-s border-outline-gray-2"
			:style="below"
		/>
	</template>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		/** This row's index within its group. */
		index: number;

		/** How many rows the group holds. A group of one joins nothing. */
		count: number;

		/**
		 * How far below the row's top edge its first line starts, in pixels. The row
		 * decides it — a card's first line sits inside the card's own chrome — and
		 * both lengths move with the word rather than staying on the row's edge.
		 */
		offset?: number;
	}>(),
	{ offset: 0 }
);

/** Half of the group's `gap-y-4`, which each end reaches into to meet the next. */
const HALF_GAP = 8;

/** The height of one control, which is the line the operator is anchored to. */
const FIRST_LINE = 28;

// The length above bridges the row gap and then runs down to the word wherever
// the offset has put it, so an offset row is still joined to the one before it
// rather than left with a gap the width of the card's padding.
const above = computed(() => ({
	top: `-${HALF_GAP}px`,
	height: `${HALF_GAP + props.offset}px`,
}));

const below = computed(() => ({
	top: `${props.offset + FIRST_LINE}px`,
	bottom: `-${HALF_GAP}px`,
}));
</script>
