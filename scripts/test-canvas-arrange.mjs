import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import * as canvasUtils from '../app/utils/infiniteCanvas.ts'
import { ARRANGE_CELL_HEIGHT, ARRANGE_CELL_WIDTH, ARRANGE_COLUMN_GAP, ARRANGE_COLUMNS, ARRANGE_GROUP_GAP, ARRANGE_ROW_GAP, arrangeCanvasItems } from '../shared/utils/canvasArrange.ts'

const rect = (width = 280, height = 282) => ({ x: 999, y: 777, width, height })
const item = (id, createdAt, extras = {}) => ({ id, createdAt, rect: rect(), ...extras })
const rows = result => [...result].map(([id, point]) => [id, point.x, point.y, point.width, point.height])

test('input order and repeated arrangement do not affect positions', () => {
  const items = [item('b', '2026-01-01'), item('c', '2026-01-02'), item('a', '2026-01-01')]
  const expected = rows(arrangeCanvasItems(items))
  assert.deepEqual(rows(arrangeCanvasItems([...items].reverse())), expected)
  assert.deepEqual(rows(arrangeCanvasItems(items.map(entry => ({ ...entry, rect: arrangeCanvasItems(items).get(entry.id) })))), expected)
  assert.deepEqual(expected.map(row => row[0]), ['a', 'b', 'c'])
})

test('oldest, newest and type modes use time and stable IDs; undated items follow', () => {
  const items = [item('old', '2025-01-01'), item('new', '2026-01-01'), item('missing', ''), item('video', '2025-02-01', { video: true })]
  assert.deepEqual([...arrangeCanvasItems(items, 'oldest').keys()], ['old', 'video', 'new', 'missing'])
  assert.deepEqual([...arrangeCanvasItems(items, 'newest').keys()], ['new', 'video', 'old', 'missing'])
  assert.deepEqual([...arrangeCanvasItems(items, 'type').keys()], ['old', 'new', 'missing', 'video'])
})

test('eleven single-item tasks fill ten columns before wrapping to a second row', () => {
  const items = Array.from({ length: 11 }, (_, index) => item(`task:${index}`, `2026-01-${String(index + 1).padStart(2, '0')}`, { taskId: `task:${index}` }))
  const result = arrangeCanvasItems(items)
  for (const [index, point] of [...result.values()].entries()) {
    assert.equal(point.x, (index % ARRANGE_COLUMNS) * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
    assert.equal(point.y, Math.floor(index / ARRANGE_COLUMNS) * (ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP))
  }
  assert.deepEqual(rows(arrangeCanvasItems([...items].reverse())), rows(result))
})

test('a three-item batch starts a new row when eight columns are occupied', () => {
  const singles = Array.from({ length: 8 }, (_, index) => item(`single:${index}`, `2026-01-0${index + 1}`))
  const batch = Array.from({ length: 3 }, (_, index) => item(`batch:${index}`, '2026-01-09', { taskId: 'batch', resultIndex: index }))
  const next = item('next', '2026-01-10')
  const result = arrangeCanvasItems([next, ...batch, ...singles])
  assert.equal(result.get('single:7').x, 7 * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
  for (const [index, entry] of batch.entries()) {
    assert.equal(result.get(entry.id).x, index * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
    assert.equal(result.get(entry.id).y, ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP)
  }
  assert.equal(result.get('next').x, 3 * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
  assert.equal(result.get('next').y, ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP)
})

test('an eleven-item batch wraps after ten columns and the next task starts after it', () => {
  const items = [item('later', '2026-02-01', { taskId: 'later' }), ...Array.from({ length: 11 }, (_, index) => item(`batch:${index}`, '2026-01-01', { taskId: 'batch', resultIndex: index }))]
  const result = arrangeCanvasItems(items)
  assert.deepEqual([...result.keys()], [...Array.from({ length: 11 }, (_, index) => `batch:${index}`), 'later'])
  assert.equal(result.get('batch:9').y, 0)
  assert.equal(result.get('batch:9').x, 9 * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
  assert.equal(result.get('batch:10').y, ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP)
  assert.equal(result.get('batch:10').x, 0)
  assert.equal(result.get('later').x, 0)
  assert.equal(result.get('later').y, 2 * ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP + ARRANGE_GROUP_GAP)
})

test('linked edits follow their source group, with every member of each batch intact', () => {
  const source = item('source', '2026-01-01', { url: 'https://example.test/source' })
  const other = item('other', '2026-01-02')
  const edit = item('edit', '2026-01-03', { taskId: 'edit-task', sourceUrls: [source.url] })
  const variant = item('variant', '2026-01-03', { taskId: 'edit-task' })
  assert.deepEqual([...arrangeCanvasItems([other, variant, edit, source]).keys()], ['source', 'edit', 'variant', 'other'])
  assert.deepEqual([...arrangeCanvasItems([other, variant, edit, source], 'type').keys()], ['source', 'edit', 'variant', 'other'])
})

test('type order keeps image-to-video results after all stills while oldest keeps them by their source', () => {
  const source = item('still:1', '2026-01-01', { url: 'https://example.test/still-1' })
  const still2 = item('still:2', '2026-01-02')
  const video1 = item('video:1', '2026-01-03', { video: true, sourceUrls: [source.url] })
  const still3 = item('still:3', '2026-01-04')
  const video2 = item('video:2', '2026-01-05', { video: true, sourceUrls: [source.url] })
  const items = [video2, still3, source, video1, still2]
  assert.deepEqual([...arrangeCanvasItems(items, 'type').keys()], ['still:1', 'still:2', 'still:3', 'video:1', 'video:2'])
  assert.deepEqual([...arrangeCanvasItems(items, 'oldest').keys()], ['still:1', 'video:1', 'video:2', 'still:2', 'still:3'])
})

test('uniform cells have fixed gaps and preserve source aspect ratio through object-contain', () => {
  const media = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvasMedia.vue', import.meta.url), 'utf8')
  assert.equal((media.match(/class="size-full object-contain"/g) || []).length, 2, 'image and video must fit without stretching')
  const items = [item('landscape', '2026-01-01', { taskId: 'one', rect: rect(800, 402) }), item('portrait', '2026-01-01', { taskId: 'one', rect: rect(280, 560) }), item('square', '2026-01-02', { taskId: 'two', rect: rect(280, 282) })]
  const result = arrangeCanvasItems(items)
  assert.equal(result.get('portrait').x - result.get('landscape').x, ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP)
  assert.equal(result.get('square').x, 2 * (ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP))
  assert.equal(result.get('square').y, 0)
  for (const point of result.values()) assert.deepEqual([point.width, point.height], [ARRANGE_CELL_WIDTH, ARRANGE_CELL_HEIGHT])
  // The canvas media elements use object-contain. The layout supplies a common viewport,
  // so each image fits without changing its intrinsic width/height ratio.
  const fit = (width, height) => {
    const scale = Math.min((ARRANGE_CELL_WIDTH - 2) / width, (ARRANGE_CELL_HEIGHT - 2) / height)
    return [width * scale, height * scale]
  }
  for (const [width, height] of [[800, 400], [400, 800], [400, 400]]) {
    const [fittedWidth, fittedHeight] = fit(width, height)
    assert.ok(Math.abs(fittedWidth / fittedHeight - width / height) < 1e-10)
  }
})

test('new result joins its task after arrangement and persists the reflow', () => {
  const file = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
  const source = ts.createSourceFile('canvas.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reconcile')
  const saved = []
  const state = {
    ...canvasUtils,
    ARRANGE_CELL_WIDTH,
    ARRANGE_CELL_HEIGHT,
    arrangeCanvasItems,
    arrangedMode: { value: true },
    arrangeOrder: { value: 'oldest' },
    ready: { value: true },
    assets: { value: [item('old:0', '2026-01-01', { taskId: 'old', resultIndex: 0 }), item('old:1', '2026-01-01', { taskId: 'old', resultIndex: 1 })] },
    positions: { value: new Map([['old:0', { x: 0, y: 0, width: ARRANGE_CELL_WIDTH, height: ARRANGE_CELL_HEIGHT }]]) },
    nextSlot: { value: 1 },
    urlPositions: new Map(),
    markNode: id => saved.push(id),
    markView: () => {},
  }
  vm.createContext(state)
  vm.runInContext(ts.transpile(fn.getText(source), { target: ts.ScriptTarget.ES2022 }), state)
  state.reconcile()
  assert.equal(state.positions.value.get('old:1').x, ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP)
  assert.equal(state.positions.value.get('old:1').y, 0)
  assert.ok(saved.includes('old:1'))
  assert.equal(state.nextSlot.value, 2)
})
