import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function createLifecycle(fetchImpl) {
  const document = new EventTarget()
  document.hidden = false
  const window = new EventTarget()
  const source = readFileSync(new URL('../app/utils/pageLifecycle.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.client', 'true')
  const context = vm.createContext({
    exports: {},
    document,
    window,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
  })
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  return { ...context.exports, document, window }
}

test('hide aborts work and duplicate resume events trigger one refresh', () => {
  const lifecycle = createLifecycle(async () => Response.json({ ok: true }))
  let resumes = 0
  let pauses = 0
  lifecycle.onPageResume(() => resumes++)
  lifecycle.onPagePause(() => pauses++)
  const first = lifecycle.pageLifecycleSignal()
  lifecycle.document.hidden = true
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.window.dispatchEvent(new Event('pagehide'))
  assert.equal(first.aborted, true)
  assert.equal(pauses, 1)
  lifecycle.document.hidden = false
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.window.dispatchEvent(new Event('pageshow'))
  assert.equal(resumes, 1)
  assert.equal(lifecycle.pageLifecycleSignal().aborted, false)
})

test('install is idempotent and a second visibility event cannot trigger another refresh', () => {
  const lifecycle = createLifecycle(async () => Response.json({ ok: true }))
  let resumes = 0
  lifecycle.pageLifecycleSignal()
  lifecycle.onPageResume(() => resumes++)
  lifecycle.onPageResume(() => resumes++)
  lifecycle.pageLifecycleSignal()
  lifecycle.document.hidden = true
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.document.hidden = false
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.window.dispatchEvent(new Event('pageshow'))
  assert.equal(resumes, 2)
})

test('hidden page never starts a fetch and does not retry it on resume', async () => {
  let requests = 0
  const lifecycle = createLifecycle(async () => {
    requests++
    return Response.json({ ok: true })
  })
  lifecycle.document.hidden = true
  lifecycle.pageLifecycleSignal()
  await assert.rejects(lifecycle.pageFetch('/api/projects'), { name: 'AbortError' })
  await assert.rejects(lifecycle.pageFetchJson('/api/projects'), { name: 'AbortError' })
  lifecycle.document.hidden = false
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  lifecycle.window.dispatchEvent(new Event('pageshow'))
  assert.equal(requests, 0)
})

test('hidden document cancels an in-flight JSON refresh', async () => {
  const lifecycle = createLifecycle((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  const pending = lifecycle.pageFetchJson('/api/projects', {}, 1000)
  lifecycle.document.hidden = true
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  await assert.rejects(pending, { name: 'AbortError' })
})

test('a stalled JSON refresh reaches its timeout', async () => {
  const lifecycle = createLifecycle((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')))
  }))
  await assert.rejects(lifecycle.pageFetchJson('/api/projects', {}, 10), { name: 'AbortError' })
})

test('pagehide without a hidden document cannot leave a visible page paused', async () => {
  let requests = 0
  const lifecycle = createLifecycle(async () => {
    requests++
    return Response.json({ ok: true })
  })
  let resumes = 0
  lifecycle.onPageResume(() => resumes++)
  lifecycle.pageLifecycleSignal()
  // WebKit: pagehide fires, but no visibilitychange/pageshow follows while the page stays visible.
  lifecycle.window.dispatchEvent(new Event('pagehide'))
  const signal = lifecycle.pageLifecycleSignal()
  assert.equal(signal.aborted, false)
  assert.equal(resumes, 1)
  await lifecycle.pageFetchJson('/api/projects')
  assert.equal(requests, 1)
})

test('focus ends a pause that missed its visible event', () => {
  const lifecycle = createLifecycle(async () => Response.json({ ok: true }))
  let resumes = 0
  lifecycle.onPageResume(() => resumes++)
  const first = lifecycle.pageLifecycleSignal()
  lifecycle.window.dispatchEvent(new Event('pagehide'))
  assert.equal(first.aborted, true)
  lifecycle.window.dispatchEvent(new Event('focus'))
  assert.equal(resumes, 1)
  lifecycle.window.dispatchEvent(new Event('focus'))
  assert.equal(resumes, 1)
})

test('a still-hidden page stays paused when asked for a signal', () => {
  const lifecycle = createLifecycle(async () => Response.json({ ok: true }))
  lifecycle.pageLifecycleSignal()
  lifecycle.document.hidden = true
  lifecycle.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(lifecycle.pageLifecycleSignal().aborted, true)
  lifecycle.window.dispatchEvent(new Event('focus'))
  assert.equal(lifecycle.pageLifecycleSignal().aborted, true)
})
