import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import { loadTsModule } from './loadTsModule.mjs'

const sheet = await loadTsModule('../app/utils/assetLibrarySheet.ts', import.meta.url)
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('sheet height stays within half the viewport and clears the toolbar', () => {
  assert.equal(sheet.maxSheetHeight(1000), 500)
  assert.equal(sheet.clampSheetHeight(900, 1000), 500)
  assert.equal(sheet.clampSheetHeight(10, 1000), sheet.ASSET_SHEET_MIN_HEIGHT)
  assert.equal(sheet.clampSheetHeight(400, 1000, 300), 300 - sheet.ASSET_SHEET_TOOLBAR_CLEARANCE)
  assert.equal(sheet.defaultSheetHeight(1000), 360)
})

test('canvas toolbar opens the local library sheet and places dragged assets', () => {
  const canvas = read('app/components/agent-lab/InfiniteCanvas.vue')
  const drawer = read('app/components/agent-lab/AssetLibrarySheet.vue')
  const page = read('app/pages/projects/[id].vue')
  assert.match(canvas, /data-testid="canvas-library-button"/)
  assert.match(canvas, /placeLibraryAsset/)
  assert.match(canvas, /data-canvas-asset-surface/)
  assert.match(canvas, /librarySheet\.value\?\.saveCanvasAsset/)
  assert.match(drawer, /\/api\/asset-libraries/)
  assert.match(drawer, /source: 'library'/)
  assert.match(drawer, /addToCanvas/)
  assert.doesNotMatch(drawer, /\/api\/asset-libraries\/browse|seoTitle|author/)
  assert.match(page, /:add-urls="addCanvasUrls"/)
})

test('addCanvasUrls places hosted library media without attaching it', async () => {
  const source = ts.createSourceFile('useAgentLab.ts', read('app/composables/useAgentLab.ts'), ts.ScriptTarget.Latest, true)
  let code = ''
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'addCanvasUrls')
      code = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(code)
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let persisted = 0
  let id = 0
  const images = { value: [{ id: 'old', url: 'https://m.test/old.png' }] }
  const context = vm.createContext({
    exports: {},
    images,
    readOnly: false,
    persistChat: async () => { persisted++ },
    crypto: { randomUUID: () => `id${++id}` },
    isMediaAudioUrl: url => url.endsWith('.mp3'),
    isMediaVideoUrl: url => url.endsWith('.mp4'),
  })
  vm.runInContext(`${js}\nexports.addCanvasUrls = addCanvasUrls`, context)
  const inserted = []
  const added = await context.exports.addCanvasUrls([
    { url: 'https://m.test/a.png', name: 'A', kind: 'image' },
    { url: 'https://m.test/a.png', name: 'dup' },
    { url: 'https://m.test/b.mp4', name: 'B', kind: 'video' },
    { url: 'blob:local', name: 'bad' },
  ], { beforeInsert: image => inserted.push(image.url) })
  assert.deepEqual([...added], ['https://m.test/a.png', 'https://m.test/b.mp4'])
  assert.deepEqual(inserted, [...added])
  assert.deepEqual(JSON.parse(JSON.stringify(images.value.slice(0, 2).map(image => [image.kind, image.status, image.name]))), [['video', 'success', 'B'], ['upload', 'success', 'A']])
  assert.equal(persisted, 1)
})
