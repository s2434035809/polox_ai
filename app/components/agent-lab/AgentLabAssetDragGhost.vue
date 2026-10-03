<script setup lang="ts">
import type { CanvasAssetDragState } from '~/utils/canvasAssetDrag'
import { assetDragHint } from '~/utils/canvasAssetDrag'

/** Cursor ghost for pointer drags of media between the canvas, the asset drawer and the chat. */
defineProps<{ state: CanvasAssetDragState | null }>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state"
      data-testid="canvas-drag-ghost"
      class="pointer-events-none fixed top-0 left-0 z-[200] flex max-w-56 items-center gap-2 rounded-lg border bg-background/95 p-1.5 pr-3 text-xs shadow-lg"
      :class="state.phase === 'target' ? 'border-primary text-primary' : 'border-border text-muted-foreground'"
      :style="{ transform: `translate(${state.x + 14}px, ${state.y + 14}px)` }"
      aria-hidden="true"
    >
      <img v-if="state.previewUrl" :src="state.previewUrl" alt="" class="size-10 shrink-0 rounded object-cover">
      <span v-else class="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
        <Icon :name="state.kind === 'video' ? 'i-lucide-play' : state.kind === 'audio' ? 'i-lucide-music' : state.kind === 'document' ? 'i-lucide-file-text' : 'i-lucide-image'" class="size-4" />
      </span>
      <span class="min-w-0">
        <span class="block truncate font-medium text-foreground">{{ state.name }}</span>
        <span class="block truncate">{{ assetDragHint(state) }}</span>
      </span>
    </div>
  </Teleport>
</template>
