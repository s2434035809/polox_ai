import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { detectedTextLines, textEditPrompt, textEditRequestText, validateTextEditAnswer, validateTextLines } from '../shared/utils/imageTextEditor.ts'

function loadFunction(file, name, context) {
  const path = new URL(file, import.meta.url)
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn, name)
  vm.runInContext(ts.transpileModule(fn.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

const imageUrl = 'https://example.com/poster.png'

test('detected lines keep the original and pre-fill only proposed replacements', () => {
  const lines = detectedTextLines([
    { original: 'SALE', location: 'top', x: 500, y: 100, proposed: 'NEW ARRIVALS' },
    { original: 'Shop now', location: 'bottom', x: 500, y: 900 },
    { original: 'Same', location: 'center', x: 500, y: 500, proposed: 'Same' },
    { original: 'Ignored', location: 'left', x: 100, y: 500, text: 'Unrequested edit', proposed: 42 },
    { original: 'Delete me', location: 'right', x: 900, y: 500, proposed: '' },
  ])
  assert.deepEqual(lines.map(line => [line.original, line.text]), [
    ['SALE', 'NEW ARRIVALS'],
    ['Shop now', 'Shop now'],
    ['Same', 'Same'],
    ['Ignored', 'Ignored'],
    ['Delete me', ''],
  ])
  assert.equal(lines[0].proposed, undefined)
  assert.equal(detectedTextLines([{ original: 'x', location: 'top', x: 1, y: 1, proposed: 'y'.repeat(2001) }])[0].text, 'x')
})

test('pre-filled edits can be confirmed without further changes; reverting everything cannot', () => {
  const detected = { imageUrl, lines: detectedTextLines([
    { original: 'SALE', location: 'top', x: 500, y: 100, proposed: 'NEW ARRIVALS' },
    { original: 'Shop now', location: 'bottom', x: 500, y: 900 },
  ]) }
  const confirmed = validateTextEditAnswer(detected, detected.lines, [imageUrl])
  assert.equal(confirmed.lines[0].text, 'NEW ARRIVALS')
  assert.match(textEditPrompt(confirmed.lines), /change "SALE" to "NEW ARRIVALS"/)
  assert.doesNotMatch(textEditPrompt(confirmed.lines), /Shop now/)
  const reverted = detected.lines.map(line => ({ ...line, text: line.original }))
  assert.throws(() => validateTextEditAnswer(detected, reverted, [imageUrl]), /Change at least/)
})

test('request text uses the latest real user message plus the optional instruction', () => {
  const messages = [
    { role: 'user', content: 'old request' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: [{ type: 'text', text: '@[Image Text Editor](skill:image-text-editor) 把 SALE 改成 NEW' }, { type: 'image_url', image_url: { url: imageUrl } }] },
    { role: 'user', internal: true, content: 'Internal continuation' },
  ]
  assert.equal(textEditRequestText(messages), '把 SALE 改成 NEW')
  assert.equal(textEditRequestText(messages, 'Change title to Hello'), '把 SALE 改成 NEW\nChange title to Hello')
  assert.equal(textEditRequestText(messages, '把 SALE 改成 NEW'), '把 SALE 改成 NEW')
  assert.equal(textEditRequestText(undefined), '')
  assert.equal(textEditRequestText([], 'x'.repeat(5000)).length, 4000)
})

test('detection sends the request after the image and returns a pre-filled card', async () => {
  let request
  const context = vm.createContext({
    AbortSignal,
    falReadableUrl: async url => url,
    validateTextLines,
    detectedTextLines,
    textEditRequestText,
    resolveSessionUrl: () => ({ url: imageUrl }),
    completeText: async (options) => { request = options; return JSON.stringify([{ original: 'SALE', location: 'top', x: 500, y: 100, proposed: 'NEW' }, { original: 'Shop now', location: 'bottom', x: 500, y: 900 }]) },
  })
  loadFunction('../server/agent/imageTextEditor.ts', 'detectTextSource', context)
  loadFunction('../server/agent/imageTextEditor.ts', 'detectImageText', context)
  const session = { images: [{ url: imageUrl, kind: 'upload', status: 'success' }], messages: [{ role: 'user', content: 'Change SALE to NEW' }] }
  const card = await context.detectImageText(JSON.stringify({ image_url: 'latest', instruction: 'Keep the rest' }), session)
  assert.equal(request.messages[1].content[0].image_url.url, imageUrl)
  assert.match(request.messages[1].content[1].text, /Change SALE to NEW\\nKeep the rest/)
  assert.match(request.messages[0].content, /proposed/)
  assert.equal(JSON.stringify(card.textEdit.lines.map(line => [line.original, line.text])), JSON.stringify([['SALE', 'NEW'], ['Shop now', 'Shop now']]))
  const bare = await context.detectImageText('{}', { images: session.images, messages: [] })
  assert.equal(request.messages[1].content.length, 1)
  assert.equal(bare.textEdit.lines.length, 2)
})
