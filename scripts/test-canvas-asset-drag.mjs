import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadTsModule } from './loadTsModule.mjs'

const drag = await loadTsModule('../app/utils/canvasAssetDrag.ts', import.meta.url)
const canvasSource = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')

const rect = { left: 100, top: 50, right: 500, bottom: 450 }

test('pointer inside the canvas keeps the canvas drag; leaving it starts the chat hand-off', () => {
  assert.equal(drag.isOutsideRect({ x: 300, y: 200 }, rect), false)
  assert.equal(drag.isOutsideRect({ x: 100, y: 50 }, rect), false, 'edges still count as inside')
  assert.equal(drag.isOutsideRect({ x: 99, y: 200 }, rect), true)
  assert.equal(drag.isOutsideRect({ x: 300, y: 451 }, rect), true)
  assert.equal(drag.canvasAssetDragPhase({ outside: false, overTarget: true }), 'canvas', 'inside the canvas never attaches')
  assert.equal(drag.canvasAssetDragPhase({ outside: true, overTarget: false }), 'outside')
  assert.equal(drag.canvasAssetDragPhase({ outside: true, overTarget: true }), 'target')
})

test('hand-off is only for editable canvases that offer attaching, and never for touch', () => {
  assert.equal(drag.canvasHandoffEnabled({ showAttach: true, readOnly: false, pointerType: 'mouse' }), true)
  assert.equal(drag.canvasHandoffEnabled({ showAttach: true, readOnly: false, pointerType: 'pen' }), true)
  assert.equal(drag.canvasHandoffEnabled({ showAttach: true, readOnly: false, pointerType: 'touch' }), false)
  assert.equal(drag.canvasHandoffEnabled({ showAttach: true, readOnly: true, pointerType: 'mouse' }), false, 'admin read-only view')
  assert.equal(drag.canvasHandoffEnabled({ showAttach: false, readOnly: false, pointerType: 'mouse' }), false)
  assert.equal(drag.canvasHandoffEnabled({ readOnly: false, pointerType: 'mouse' }), false)
})

test('only finished hosted assets can be dragged into the chat', () => {
  assert.equal(drag.canDragAssetToChat({ url: 'https://media.test/a.png', state: 'success' }), true)
  assert.equal(drag.canDragAssetToChat({ url: 'https://media.test/a.mp4', state: 'success', video: true }), true)
  assert.equal(drag.canDragAssetToChat({ url: 'https://media.test/a.png', state: 'generating' }), false)
  assert.equal(drag.canDragAssetToChat({ url: 'https://media.test/a.png', state: 'fail' }), false)
  assert.equal(drag.canDragAssetToChat({ url: '', state: 'success' }), false)
  assert.equal(drag.canDragAssetToChat({ url: 'blob:local', state: 'success' }), false)
  assert.equal(drag.canDragAssetToChat(undefined), false)
})

test('asset kinds map to attachment kinds', () => {
  assert.equal(drag.canvasDragAssetKind({ url: 'x', state: 'success' }), 'image')
  assert.equal(drag.canvasDragAssetKind({ url: 'x', state: 'success', video: true }), 'video')
  assert.equal(drag.canvasDragAssetKind({ url: 'x', state: 'success', audio: true }), 'audio')
  assert.equal(drag.canvasDragAssetKind({ url: 'x', state: 'success', document: true }), 'document')
})

test('OS file drags are recognised by the Files transfer type only', () => {
  assert.equal(drag.dataTransferHasFiles(['Files']), true)
  assert.equal(drag.dataTransferHasFiles(['text/plain', 'Files']), true)
  assert.equal(drag.dataTransferHasFiles(['text/uri-list']), false)
  assert.equal(drag.dataTransferHasFiles(undefined), false)
})

test('canvas drop reuses the "Use as reference" attach event and the chat marks itself as a drop target', () => {
  assert.equal(drag.CANVAS_ASSET_DROP_ATTR, 'data-agent-asset-drop')
  // Same payload as the per-card "Use as reference" button, so the page's attach pipeline (limits, dedupe, errors) applies.
  assert.ok(canvasSource.includes(`emit('attach', { urls: [dropAsset.url], prompt: dropAsset.name || dropAsset.prompt })`))
  assert.ok(canvasSource.includes(`@click="emit('attach', { urls: [asset.url], prompt: asset.name || asset.prompt })"`))
  // Only a real pointerup attaches; Escape / pointercancel / lost capture just cancel.
  assert.ok(canvasSource.includes('@pointerup="end($event)" @pointercancel="end()"'))
  assert.ok(canvasSource.includes(`event?.type === 'pointerup'`))
  assert.ok(chatSource.includes(`:${drag.CANVAS_ASSET_DROP_ATTR}="acceptsAttachmentDrop ? '' : undefined"`))
  assert.ok(chatSource.includes('const acceptsAttachmentDrop = computed(() => !props.readOnly && !composerLocked.value)'))
})
