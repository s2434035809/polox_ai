import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const cache = new Map()
function load(file) {
  if (cache.has(file))
    return cache.get(file)
  const module = { exports: {} }
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } }).outputText
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id.startsWith('.') || id.startsWith('~~/')) {
        const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id)
        const fileTarget = target.endsWith('.ts') || target.endsWith('.js') || target.endsWith('.json') ? target : `${target}.ts`
        if (fileTarget.endsWith('.json')) {
          const data = JSON.parse(readFileSync(fileTarget, 'utf8'))
          return { __esModule: true, default: data }
        }
        return load(fileTarget)
      }
      return require(id)
    },
  }, { filename: file })
  cache.set(file, module.exports)
  return module.exports
}

const choice = load(resolve(root, 'server/agent/videoChoice.ts'))
const search = load(resolve(root, 'server/agent/webSearch.ts'))
const labels = load(resolve(root, 'server/agent/attachmentLabels.ts'))

function user(text) {
  return { role: 'user', content: text }
}
function ask(id, videoRequest, questions = []) {
  return {
    role: 'assistant',
    tool_calls: [{ id, type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ videoRequest, questions }) } }],
  }
}
function tool(id, body) {
  return { role: 'tool', tool_call_id: id, content: JSON.stringify(body) }
}

test('video model card lists live models and recommends the cheapest suitable one', () => {
  const models = load(resolve(root, 'shared/utils/agentModels.ts'))
  const messages = [
    user('Make a short video of a cat.'),
    ask('a1', { requestKind: 'new', referenceMedia: 'none', structure: 'continuous' }),
  ]
  const args = choice.modelChoiceAskArgs(messages, { videoRequest: { requestKind: 'new', referenceMedia: 'none' }, questions: [] })
  const question = args.questions.find(item => item.id === 'video_model')
  assert.ok(question)
  const ids = question.options.filter(option => option.id !== 'other').map(option => option.id)
  assert.ok(ids.length >= 2)
  assert.equal(question.recommendedId, ids[0])
  assert.match(question.options[0].label, /(Recommended)/)
  assert.doesNotMatch(args.recommendation, /credits/)
  assert.match(args.recommendation, /cheapest/i)
  const registered = ids.map(id => models.AGENT_MODELS.find(model => model.id === id))
  assert.ok(registered.every(Boolean))
  const cheapest = registered.slice().sort((a, b) => choice.cheapestVideoCost(a) - choice.cheapestVideoCost(b) || a.name.localeCompare(b.name))[0]
  assert.equal(question.recommendedId, cheapest.id)
})

test('duration and resolution default to the cheapest tier after the model is picked', () => {
  const preview = choice.modelChoiceAskArgs([user('video')], { videoRequest: { requestKind: 'new', referenceMedia: 'none' }, questions: [] })
  const modelId = preview.questions[0].recommendedId
  const messages = [
    user('video'),
    ask('m', { requestKind: 'new', referenceMedia: 'none' }, preview.questions),
    tool('m', { ok: true, answers: [{ questionId: 'video_model', optionId: modelId }] }),
  ]
  const params = choice.modelChoiceAskArgs(messages)
  assert.ok(params.questions.some(question => question.id.startsWith('video_param_')))
  assert.match(params.recommendation, /cheap-test/i)
  for (const question of params.questions) {
    const recommended = question.options.find(option => option.id === question.recommendedId)
    assert.match(recommended.label, /Recommended/)
  }
  const state = choice.videoChoice(messages)
  assert.equal(state.stage, 'params')
  assert.equal(state.settled, false)
})

test('several clips share one model card and user wording is not regex-matched', () => {
  const args = choice.modelChoiceAskArgs([user('make it seamless and one take with cuts please')], {
    videoRequest: { requestKind: 'new', referenceMedia: 'none', clipCount: 4 },
    questions: [],
  })
  assert.match(args.prompt, /4 videos/)
  assert.equal(args.questions.filter(question => question.id === 'video_model').length, 1)
  const ignored = choice.videoChoice([user('seamless loop storyboard with reference video')])
  assert.notEqual(ignored.stage, 'reference')
})

test('conflict structure is refused without a keyword scan', () => {
  assert.throws(() => choice.modelChoiceAskArgs([user('hello')], {
    videoRequest: { requestKind: 'new', structure: 'conflict' },
    questions: [],
  }), /both/)
})

test('web search keeps the platform size table when public pages fail', async () => {
  const result = await search.webSearch('YouTube channel banner size', AbortSignal.abort())
  assert.equal(result.ok, true)
  assert.ok(result.results.some(item => item.source === 'builtin' && /2560/.test(item.snippet)))
  assert.ok(result.results.every(item => item.source === 'builtin'))
  const calls = [{ id: 's1', function: { name: 'web_search', arguments: JSON.stringify({ query: 'YouTube channel banner size' }) } }]
  const failed = await search.runWebSearchCalls(calls, undefined, async () => {
    throw new Error('network down')
  })
  assert.equal(failed[0].result.ok, false)
  assert.equal(failed[0].result.ok, false)
})

test('attachment lines carry sanitized filenames', () => {
  const parsed = labels.parseChatAttachments([
    { url: 'https://cdn.example/a.png', name: 'logo.png' },
    'https://cdn.example/b.png',
  ])
  assert.equal(JSON.stringify(parsed.urls), JSON.stringify(['https://cdn.example/a.png','https://cdn.example/b.png']))
  assert.equal(labels.attachmentListLine(0, parsed.urls[0], parsed.names.get(parsed.urls[0])), '1. "logo.png" — https://cdn.example/a.png')
})
