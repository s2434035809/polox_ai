import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { loadTsModule } from './loadTsModule.mjs'

const rules = await loadTsModule('../app/utils/agentUploadRules.ts', import.meta.url)
const drop = await loadTsModule('../app/utils/canvasFileDrop.ts', import.meta.url)
const canvasUtils = await loadTsModule('../app/utils/infiniteCanvas.ts', import.meta.url)

const labPath = new URL('../app/composables/useAgentLab.ts', import.meta.url)
const labSource = ts.createSourceFile('useAgentLab.ts', readFileSync(labPath, 'utf8'), ts.ScriptTarget.Latest, true)
function extract(names) {
  let out = ''
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
      out += `${node.getText(labSource)}\n`
    ts.forEachChild(node, visit)
  }
  visit(labSource)
  return ts.transpileModule(out, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}

const MB = 1024 * 1024
const file = (name, kind, size = MB) => ({ name, kind, size, type: '' })
const classify = f => f.kind || null
const kindGlobals = {
  isAgentImageFile: f => f.kind === 'image',
  isAgentAudioFile: f => f.kind === 'audio',
  isAgentVideoFile: f => f.kind === 'video',
  isAgentDocumentFile: f => f.kind === 'document',
}

test('upload plan: supported types and per-kind size limits, no per-drop count cap', () => {
  const ok = rules.planAgentUploads([file('a.png', 'image'), file('b.mp4', 'video', 150 * MB)], classify)
  assert.deepEqual(ok.accepted.map(item => item.kind), ['image', 'video'])
  assert.deepEqual(ok.errors, [])

  const mixed = rules.planAgentUploads([file('a.exe', null), file('b.png', 'image'), file('c.png', 'image', 11 * MB)], classify)
  assert.deepEqual(mixed.accepted.map(item => item.file.name), ['b.png'])
  assert.deepEqual(mixed.errors, [rules.AGENT_UPLOAD_TYPE_ERROR, 'Each image must be 10MB or smaller'])

  const none = rules.planAgentUploads([file('a.exe', null)], classify)
  assert.deepEqual(none, { accepted: [], errors: [rules.AGENT_UPLOAD_TYPE_ERROR] })

  const many = rules.planAgentUploads(Array.from({ length: 12 }, (_, i) => file(`${i}.png`, 'image')), classify)
  assert.equal(many.accepted.length, 12, 'no per-drop file count cap')
  assert.deepEqual(many.errors, [])

  for (const [kind, max] of Object.entries(rules.AGENT_UPLOAD_MAX_BYTES)) {
    assert.equal(rules.planAgentUploads([file('x', kind, max)], classify).accepted.length, 1)
    assert.deepEqual(rules.planAgentUploads([file('x', kind, max + 1)], classify).errors, [rules.AGENT_UPLOAD_SIZE_ERRORS[kind]])
  }
})

test('canvas drop validation matches the chat attachment upload (types, sizes, messages)', () => {
  const code = extract(['attachFiles'])
  for (const [kind, max] of Object.entries(rules.AGENT_UPLOAD_MAX_BYTES)) {
    for (const size of [max, max + 1]) {
      const errors = []
      const attachments = { value: [] }
      const context = vm.createContext({
        exports: {},
        ...kindGlobals,
        attachments,
        images: { value: [] },
        sessionId: { value: '' },
        attachmentUploads: new Map(),
        baseUrl: '/agent',
        crypto: { randomUUID: () => 'id' },
        URL: { createObjectURL: () => 'blob:x' },
        AbortController,
        ensureSession: () => new Promise(() => {}),
        requireLogin: () => true,
        clearLabError: () => {},
        setLabError: e => errors.push(e),
        labHeaders: () => ({}),
      })
      vm.runInContext(`${code}\nexports.attachFiles = attachFiles`, context)
      void context.exports.attachFiles([file('x', kind, size)])
      const plan = rules.planAgentUploads([file('x', kind, size)], classify)
      assert.equal(attachments.value.length, plan.accepted.length, `${kind} ${size}`)
      assert.deepEqual(errors, plan.errors, `${kind} ${size}`)
    }
  }
  const errors = []
  const context = vm.createContext({ exports: {}, ...kindGlobals, attachments: { value: [] }, requireLogin: () => true, setLabError: e => errors.push(e), clearLabError: () => {} })
  vm.runInContext(`${code}\nexports.attachFiles = attachFiles`, context)
  void context.exports.attachFiles([file('a.exe', null)])
  assert.deepEqual(errors, [rules.AGENT_UPLOAD_TYPE_ERROR])
})

function uploadHarness({ fail = new Set() } = {}) {
  const code = extract(['agentUploadKind', 'uploadCanvasFiles'])
  const state = {
    exports: {},
    ...kindGlobals,
    planAgentUploads: rules.planAgentUploads,
    readOnly: false,
    attachments: { value: [{ id: 'keep' }] },
    images: { value: [{ id: 'old', url: 'https://media.test/old.png' }] },
    sessionId: { value: '' },
    canvasUploads: { value: 0 },
    baseUrl: '/agent',
    errors: [],
    requests: [],
    persisted: 0,
    crypto: { randomUUID: () => 'rid' },
    FormData: class { append(_k, f) { this.file = f } },
    fetch: async (url, options) => {
      state.requests.push(url)
      const f = options.body.file
      if (fail.has(f.name))
        return { ok: false, json: async () => ({ error: 'Storage unavailable' }) }
      return { ok: true, json: async () => ({ sessionId: 's1', image: { id: `img-${f.name}`, url: `https://media.test/${f.name}`, kind: 'upload', status: 'success' } }) }
    },
    ensureSession: async () => 's1',
    requireLogin: () => true,
    clearLabError: () => {},
    labHeaders: () => ({}),
  }
  state.setLabError = e => state.errors.push(e)
  state.persistChat = async () => { state.persisted++ }
  vm.createContext(state)
  vm.runInContext(`${code}\nexports.uploadCanvasFiles = uploadCanvasFiles`, state)
  return state
}

test('dropped files become canvas assets, never chat attachments', async () => {
  const h = uploadHarness({ fail: new Set(['bad.png']) })
  const log = []
  await h.exports.uploadCanvasFiles([file('a.png', 'image'), file('bad.png', 'image'), file('x.exe', null)], {
    accepted: files => log.push(['accepted', Array.from(files, f => f.name)]),
    beforeInsert: (f, image) => log.push(['insert', f.name, image.url, h.images.value.some(item => item.id === image.id)]),
    settled: (f, ok) => log.push(['settled', f.name, ok]),
  })
  assert.deepEqual(h.attachments.value, [{ id: 'keep' }], 'attachment list untouched')
  assert.deepEqual(Array.from(h.images.value, item => item.id), ['img-a.png', 'old'])
  assert.equal(h.requests.length, 2)
  assert.ok(h.requests.every(url => url === '/agent/v1/uploads?sessionId=s1'))
  assert.deepEqual(log.find(entry => entry[0] === 'accepted'), ['accepted', ['a.png', 'bad.png']])
  assert.deepEqual(log.find(entry => entry[0] === 'insert'), ['insert', 'a.png', 'https://media.test/a.png', false], 'position is reserved before the asset appears')
  assert.deepEqual(log.filter(entry => entry[0] === 'settled').map(entry => entry.slice(1)).sort(), [['a.png', true], ['bad.png', false]])
  assert.deepEqual(h.errors, [rules.AGENT_UPLOAD_TYPE_ERROR, 'Storage unavailable'])
  assert.equal(h.canvasUploads.value, 0)
  assert.equal(h.persisted, 1)
  assert.equal(h.sessionId.value, 's1')
})

test('read-only and invalid drops upload nothing', async () => {
  const ro = uploadHarness()
  ro.readOnly = true
  await ro.exports.uploadCanvasFiles([file('a.png', 'image')])
  assert.equal(ro.requests.length, 0)
  const big = uploadHarness()
  let accepted = false
  await big.exports.uploadCanvasFiles([file('a.png', 'image', 11 * MB)], { accepted: () => { accepted = true } })
  assert.equal(big.requests.length, 0)
  assert.equal(accepted, false)
  assert.deepEqual(big.errors, ['Each image must be 10MB or smaller'])
})

test('drop layout: centred on the drop point, no overlaps with cards or each other', () => {
  const point = { x: 1000, y: 500 }
  const [first] = drop.layoutDroppedFiles(point, 1, [])
  assert.equal(first.x + first.width / 2, point.x)
  assert.equal(first.y + first.height / 2, point.y)

  const occupied = [{ x: 1180, y: 300, width: 280, height: 280 }, { x: 800, y: 700, width: 400, height: 300 }]
  const slots = drop.layoutDroppedFiles(point, 7, occupied)
  assert.equal(slots.length, 7)
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  for (const [i, slot] of slots.entries()) {
    for (const rect of occupied)
      assert.equal(overlaps(slot, rect), false)
    for (const other of slots.slice(i + 1))
      assert.equal(overlaps(slot, other), false)
    assert.equal(slot.width, canvasUtils.CARD_WIDTH)
  }
  assert.ok(Math.abs(slots[0].x - (point.x - canvasUtils.CARD_WIDTH / 2)) < canvasUtils.CELL_X, 'stays near the drop point')
})

test('screen → world conversion honours pan and zoom', () => {
  assert.deepEqual(drop.canvasWorldPoint({ x: 300, y: 200 }, { left: 100, top: 50 }, { x: 0, y: 0, zoom: 1 }), { x: 200, y: 150 })
  assert.deepEqual(drop.canvasWorldPoint({ x: 300, y: 200 }, { left: 100, top: 50 }, { x: 100, y: -50, zoom: 2 }), { x: 50, y: 100 })
})

test('wiring: editable page passes the uploader, project page passes the uploader; canvas consumes reserved drop positions', () => {
  const page = readFileSync(new URL('../app/pages/projects/[id].vue', import.meta.url), 'utf8')
  const canvas = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
  assert.ok(page.includes(':upload-files="uploadCanvasFiles"'))
  assert.ok(canvas.includes('const fileDropEnabled = computed(() => Boolean(props.uploadFiles) && !props.readOnly)'))
  assert.ok(canvas.includes('urlPositions.get(asset.url) || reservedDropPositions.get(asset.url)'))
  assert.ok(canvas.includes('data-testid="canvas-upload-placeholder"'))
  assert.ok(canvas.includes('data-testid="canvas-file-drop-zone"'))
})
