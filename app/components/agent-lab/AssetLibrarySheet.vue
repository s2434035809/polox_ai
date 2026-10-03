<script setup lang="ts">
import type { AssetLibraryAssetList, AssetLibraryAssetPublic, AssetLibraryList, AssetLibraryPublic } from '~~/shared/types/assetLibrary'
import type { CanvasAssetDragState } from '~/utils/canvasAssetDrag'
import { toast } from 'vue-sonner'
import { ASSET_LIBRARY_NAME_MAX, nextAssetLibraryTitle } from '~~/shared/types/assetLibrary'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { acceptsAssetDrop, ASSET_LIBRARY_DROP_ATTR, CANVAS_ASSET_DRAG_STATE_KEY, CANVAS_OVERLAY_ATTR, resolveAssetDropTarget } from '~/utils/canvasAssetDrag'
import { clampSheetHeight, defaultSheetHeight } from '~/utils/assetLibrarySheet'

/**
 * Canvas asset drawer. Browses local SQLite libraries (`GET /api/asset-libraries`)
 * and drags items onto the canvas or the agent chat. Touch uses tap actions instead.
 */
export interface CanvasLibraryDropAsset { url: string, name: string, kind: 'image' | 'video' | 'audio' }

const props = defineProps<{
  open: boolean
  mobile?: boolean
  canAddToCanvas?: boolean
  canSendToChat?: boolean
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:height': [height: number]
  'addToCanvas': [asset: AssetLibraryAssetPublic, point: { x: number, y: number } | null]
  'sendToChat': [asset: AssetLibraryAssetPublic]
}>()

const root = ref<HTMLElement>()
const height = ref(0)
const folders = ref<AssetLibraryPublic[]>([])
const foldersLoaded = ref(false)
const foldersLoading = ref(false)
const folderQuery = ref('')
const folderSort = ref<'updated' | 'name'>('updated')
const activeLibraryId = ref('')
const assetsByLibrary = ref<Record<string, AssetLibraryAssetPublic[]>>({})
const assetsLoading = ref(false)
const assetQuery = ref('')
const creatingFolder = ref(false)
const folderDraft = ref('')
const folderSaving = ref(false)
const savingLibraryId = ref('')
const assetDrag = useState<CanvasAssetDragState | null>(CANVAS_ASSET_DRAG_STATE_KEY, () => null)

const activeLibrary = computed(() => folders.value.find(item => item.id === activeLibraryId.value) || null)
const visibleFolders = computed(() => {
  const query = folderQuery.value.trim().toLowerCase()
  const items = folders.value.filter(item => !query || item.name.toLowerCase().includes(query))
  return [...items].sort((a, b) => folderSort.value === 'name'
    ? a.name.localeCompare(b.name)
    : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
})
const visibleAssets = computed(() => {
  const query = assetQuery.value.trim().toLowerCase()
  const items = activeLibraryId.value ? (assetsByLibrary.value[activeLibraryId.value] || []) : []
  return items.filter(item => !query || item.name.toLowerCase().includes(query))
})

function parentHeight() {
  return root.value?.parentElement?.clientHeight || 0
}
function viewportHeight() {
  return import.meta.client ? window.innerHeight : 800
}
function setHeight(value: number) {
  height.value = clampSheetHeight(value, viewportHeight(), parentHeight())
  emit('update:height', props.open ? height.value : 0)
}
function resetView() {
  activeLibraryId.value = ''
  assetQuery.value = ''
  creatingFolder.value = false
}
watch(() => props.open, async (open) => {
  if (!open) {
    emit('update:height', 0)
    resetView()
    return
  }
  if (!height.value)
    height.value = defaultSheetHeight(viewportHeight())
  await nextTick()
  setHeight(height.value)
  void loadFolders()
}, { immediate: true })
useEventListener('resize', () => {
  if (props.open)
    setHeight(height.value)
})

let resizeDrag: { pointer: number, y: number, height: number } | undefined
function onHandleDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  resizeDrag = { pointer: event.pointerId, y: event.clientY, height: height.value }
}
function onHandleMove(event: PointerEvent) {
  if (resizeDrag?.pointer !== event.pointerId)
    return
  setHeight(resizeDrag.height + resizeDrag.y - event.clientY)
}
function onHandleUp(event: PointerEvent) {
  if (resizeDrag?.pointer === event.pointerId)
    resizeDrag = undefined
}
function onHandleKey(event: KeyboardEvent) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    setHeight(height.value + (event.key === 'ArrowUp' ? 24 : -24))
  }
}
function close() {
  emit('update:open', false)
}
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!props.open || event.key !== 'Escape' || event.defaultPrevented || assetDrag.value)
    return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable="true"]'))
    return
  close()
})

async function loadFolders() {
  if (!props.open || foldersLoading.value)
    return
  foldersLoading.value = true
  try {
    const page = await $fetch<AssetLibraryList>('/api/asset-libraries')
    folders.value = page.items || []
    foldersLoaded.value = true
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not load your asset library'))
  }
  finally {
    foldersLoading.value = false
  }
}
async function openLibrary(library: AssetLibraryPublic) {
  activeLibraryId.value = library.id
  assetQuery.value = ''
  if (assetsByLibrary.value[library.id])
    return
  assetsLoading.value = true
  try {
    const page = await $fetch<AssetLibraryAssetList>(`/api/asset-libraries/${encodeURIComponent(library.id)}/assets`)
    assetsByLibrary.value = { ...assetsByLibrary.value, [library.id]: page.items || [] }
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not load this folder'))
    activeLibraryId.value = ''
  }
  finally {
    assetsLoading.value = false
  }
}
function back() {
  activeLibraryId.value = ''
  assetQuery.value = ''
}
function startNewFolder() {
  creatingFolder.value = true
  folderDraft.value = nextAssetLibraryTitle(folders.value.map(item => item.name))
}
async function submitNewFolder() {
  const name = folderDraft.value.trim()
  if (!name || folderSaving.value)
    return
  folderSaving.value = true
  try {
    const created = await $fetch<AssetLibraryPublic>('/api/asset-libraries', { method: 'POST', body: { name } })
    folders.value = [created, ...folders.value.filter(item => item.id !== created.id)]
    creatingFolder.value = false
    folderDraft.value = ''
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not create the folder'))
  }
  finally {
    folderSaving.value = false
  }
}

function addAssetLocally(libraryId: string, asset: AssetLibraryAssetPublic) {
  const current = assetsByLibrary.value[libraryId] || []
  if (!current.some(item => item.id === asset.id || item.url === asset.url))
    assetsByLibrary.value = { ...assetsByLibrary.value, [libraryId]: [asset, ...current] }
  folders.value = folders.value.map(item => item.id === libraryId
    ? { ...item, assetCount: item.assetCount + (current.some(row => row.url === asset.url) ? 0 : 1), coverUrl: item.coverUrl || (asset.kind === 'image' ? asset.url : item.coverUrl), updatedAt: new Date().toISOString() }
    : item)
}

async function saveCanvasAsset(libraryId: string, asset: CanvasLibraryDropAsset) {
  if (!libraryId || !asset.url)
    return
  savingLibraryId.value = libraryId
  try {
    const created = await $fetch<AssetLibraryAssetPublic>(`/api/asset-libraries/${encodeURIComponent(libraryId)}/assets`, {
      method: 'POST',
      body: { url: asset.url, name: asset.name, kind: asset.kind },
    })
    addAssetLocally(libraryId, created)
    const name = folders.value.find(item => item.id === libraryId)?.name || 'folder'
    toast.success(`Saved to ${name}`)
  }
  catch (error) {
    toast.error(readErrorMessage(error, 'Could not save to the library'))
  }
  finally {
    savingLibraryId.value = ''
  }
}
defineExpose({ saveCanvasAsset })

let suppressClick = false
let outDrag: { asset: AssetLibraryAssetPublic, pointer: number, x: number, y: number, started: boolean } | undefined
function updateOutDrag(event: PointerEvent) {
  if (!outDrag)
    return
  const target = resolveAssetDropTarget(document.elementFromPoint(event.clientX, event.clientY))
  const accepted = acceptsAssetDrop(target, { source: 'library', kind: outDrag.asset.kind })
    && (target!.type !== 'canvas' || Boolean(props.canAddToCanvas))
    && (target!.type !== 'chat' || Boolean(props.canSendToChat))
  assetDrag.value = {
    phase: accepted ? 'target' : 'outside',
    x: event.clientX,
    y: event.clientY,
    name: outDrag.asset.name,
    previewUrl: outDrag.asset.kind === 'image' ? outDrag.asset.url : '',
    kind: outDrag.asset.kind,
    source: 'library',
    ...(accepted ? { target: target!.type } : {}),
  }
}
function onAssetPointerDown(event: PointerEvent, asset: AssetLibraryAssetPublic) {
  if (props.mobile || event.pointerType === 'touch' || event.button !== 0)
    return
  if ((event.target as HTMLElement).closest('input, button, [data-no-drag]'))
    return
  outDrag = { asset, pointer: event.pointerId, x: event.clientX, y: event.clientY, started: false }
}
function onWindowPointerMove(event: PointerEvent) {
  if (!outDrag || outDrag.pointer !== event.pointerId)
    return
  if (!outDrag.started) {
    if (Math.hypot(event.clientX - outDrag.x, event.clientY - outDrag.y) < 5)
      return
    outDrag.started = true
    document.getSelection()?.removeAllRanges()
  }
  event.preventDefault()
  updateOutDrag(event)
}
function finishOutDrag(event: PointerEvent | null) {
  const drag = outDrag
  outDrag = undefined
  if (!drag?.started) {
    if (drag)
      assetDrag.value = null
    return
  }
  const state = assetDrag.value
  assetDrag.value = null
  suppressClick = true
  setTimeout(() => { suppressClick = false }, 0)
  if (!event || state?.phase !== 'target')
    return
  if (state.target === 'chat')
    emit('sendToChat', drag.asset)
  else if (state.target === 'canvas')
    emit('addToCanvas', drag.asset, { x: event.clientX, y: event.clientY })
}
useEventListener('pointermove', onWindowPointerMove)
useEventListener('pointerup', (event: PointerEvent) => {
  if (outDrag?.pointer === event.pointerId)
    finishOutDrag(event)
})
useEventListener('pointercancel', (event: PointerEvent) => {
  if (outDrag?.pointer === event.pointerId)
    finishOutDrag(null)
})
onBeforeUnmount(() => {
  if (outDrag?.started)
    assetDrag.value = null
  outDrag = undefined
})

const overlayAttrs = { [CANVAS_OVERLAY_ATTR]: '' }
function dropAttrs(libraryId: string) {
  return { [ASSET_LIBRARY_DROP_ATTR]: libraryId }
}
</script>

<template>
  <section
    v-if="open"
    ref="root"
    v-bind="overlayAttrs"
    data-testid="asset-library-sheet"
    role="region"
    aria-label="Asset library"
    class="absolute inset-x-0 bottom-0 z-[45] flex flex-col rounded-t-2xl border-t border-border bg-background/98 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur"
    :style="{ height: `${height}px` }"
    @pointerdown.stop
    @dblclick.stop
    @wheel.stop
  >
    <div
      class="flex h-5 shrink-0 cursor-row-resize touch-none items-center justify-center"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize asset library"
      :aria-valuenow="height"
      tabindex="0"
      data-testid="asset-library-sheet-handle"
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="onHandleUp"
      @pointercancel="onHandleUp"
      @keydown="onHandleKey"
    >
      <span class="h-1 w-10 rounded-full bg-muted-foreground/40" />
    </div>
    <header class="flex shrink-0 items-center gap-2 px-3 pb-2">
      <Button v-if="activeLibrary" type="button" variant="ghost" size="icon" class="size-8 rounded-lg shadow-none" aria-label="Back to folders" data-testid="asset-library-back" @click="back">
        <Icon name="i-lucide-arrow-left" class="size-4" />
      </Button>
      <Icon v-else name="i-lucide-library" class="ml-1 size-4 text-muted-foreground" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ activeLibrary ? activeLibrary.name : 'Asset library' }}
        <span v-if="activeLibrary" class="ml-1 text-xs font-normal text-muted-foreground">{{ activeLibrary.assetCount }} assets</span>
      </h2>
      <Button v-if="!activeLibrary" type="button" variant="outline" size="sm" class="h-7 rounded-lg px-2 text-xs shadow-none" data-testid="asset-library-new-folder" :disabled="creatingFolder" @click="startNewFolder">
        <Icon name="i-lucide-folder-plus" class="size-3.5" />
        New folder
      </Button>
      <Button type="button" variant="ghost" size="icon" class="size-8 rounded-lg shadow-none" aria-label="Close asset library" @click="close">
        <Icon name="i-lucide-x" class="size-4" />
      </Button>
    </header>

    <template v-if="!activeLibrary">
      <div class="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Input v-model="folderQuery" type="search" placeholder="Search folders" aria-label="Search folders" data-testid="asset-library-folder-search" class="h-8 rounded-lg bg-input/30 text-sm shadow-none" />
        <Button type="button" variant="ghost" size="sm" class="h-8 shrink-0 rounded-lg px-2 text-xs shadow-none" data-testid="asset-library-folder-sort" @click="folderSort = folderSort === 'name' ? 'updated' : 'name'">
          {{ folderSort === 'name' ? 'A–Z' : 'Recent' }}
        </Button>
      </div>
      <form v-if="creatingFolder" class="flex shrink-0 items-center gap-1 px-3 pb-2" @submit.prevent="submitNewFolder">
        <Input v-model="folderDraft" :maxlength="ASSET_LIBRARY_NAME_MAX" :disabled="folderSaving" aria-label="Folder name" class="h-8 max-w-64 rounded-lg text-sm shadow-none" @keydown.escape.prevent="creatingFolder = false" />
        <Button type="submit" size="sm" class="h-8 rounded-lg px-3 text-xs shadow-none" :disabled="folderSaving || !folderDraft.trim()">
          Create
        </Button>
      </form>
      <div v-if="!foldersLoaded" class="flex flex-1 justify-center py-8">
        <Spinner class="size-5 text-muted-foreground" />
      </div>
      <div v-else-if="!visibleFolders.length" class="mx-3 mb-3 flex min-h-28 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground" data-testid="asset-library-empty">
        <p>{{ folderQuery.trim() ? 'No folders match that search.' : 'No folders yet. Create one, then drag canvas cards onto it.' }}</p>
      </div>
      <div v-else class="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="asset-library-folder-list">
        <button
          v-for="library in visibleFolders"
          :key="library.id"
          type="button"
          v-bind="dropAttrs(library.id)"
          data-testid="asset-library-folder"
          class="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-2 text-left hover:bg-accent/40"
          :class="savingLibraryId === library.id && 'ring-2 ring-primary/40'"
          :aria-label="`Open ${library.name}`"
          @click="openLibrary(library)"
        >
          <span class="flex h-16 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
            <img v-if="library.coverUrl" :src="library.coverUrl" alt="" class="size-full object-cover" draggable="false">
            <Icon v-else name="i-lucide-folder" class="size-6 text-muted-foreground" />
          </span>
          <span class="flex items-center gap-1 text-xs">
            <span class="min-w-0 flex-1 truncate font-medium">{{ library.name }}</span>
            <span class="shrink-0 tabular-nums text-muted-foreground">{{ library.assetCount }}</span>
          </span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="shrink-0 px-3 pb-2">
        <Input v-model="assetQuery" type="search" :placeholder="`Search in ${activeLibrary.name}`" aria-label="Search assets in this folder" data-testid="asset-library-asset-search" class="h-8 rounded-lg bg-input/30 text-sm shadow-none" />
      </div>
      <div v-bind="dropAttrs(activeLibrary.id)" data-testid="asset-library-assets" class="flex min-h-0 flex-1 flex-col">
        <div v-if="assetsLoading && !visibleAssets.length" class="flex justify-center py-8">
          <Spinner class="size-5 text-muted-foreground" />
        </div>
        <div v-else-if="!visibleAssets.length" class="mx-3 mb-3 flex min-h-28 flex-1 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground" data-testid="asset-library-folder-empty">
          {{ assetQuery.trim() ? 'No assets match that search.' : 'This folder is empty. Drag a canvas card here, or save one from the canvas.' }}
        </div>
        <div v-else class="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="asset-library-asset-list">
          <div
            v-for="asset in visibleAssets"
            :key="asset.id"
            data-testid="asset-library-asset"
            class="group relative min-w-0 select-none overflow-hidden rounded-xl border border-border bg-card"
            :class="!mobile && 'cursor-grab active:cursor-grabbing'"
            @pointerdown="onAssetPointerDown($event, asset)"
            @dragstart.prevent
          >
            <div class="flex aspect-[4/3] items-center justify-center bg-muted/40">
              <img v-if="asset.kind === 'image'" :src="asset.url" alt="" class="size-full object-cover" draggable="false">
              <Icon v-else :name="asset.kind === 'video' ? 'i-lucide-clapperboard' : 'i-lucide-audio-lines'" class="size-6 text-muted-foreground" />
            </div>
            <p class="truncate px-2 py-1.5 text-xs">
              {{ asset.name }}
            </p>
            <div class="absolute top-2 right-2 flex gap-1" :class="mobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'" data-no-drag>
              <button
                v-if="canAddToCanvas"
                type="button"
                class="flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-1 text-[10px] shadow-sm hover:bg-accent"
                :aria-label="`Add ${asset.name} to canvas`"
                title="Add to canvas"
                @click="emit('addToCanvas', asset, null)"
              >
                <Icon name="i-lucide-square-plus" class="size-3.5" />
                <span v-if="mobile">Add to canvas</span>
              </button>
              <button
                v-if="canSendToChat"
                type="button"
                class="flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-1 text-[10px] shadow-sm hover:bg-accent"
                :aria-label="`Send ${asset.name} to chat`"
                title="Send to chat"
                @click="emit('sendToChat', asset)"
              >
                <Icon name="i-lucide-message-square-plus" class="size-3.5" />
                <span v-if="mobile">Send to chat</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
