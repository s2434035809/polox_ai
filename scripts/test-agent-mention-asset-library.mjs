import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadTsModule } from './loadTsModule.mjs'

const lib = await loadTsModule('../app/utils/mentionAssetLibrary.ts', import.meta.url)
const chat = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')
const endpoint = readFileSync(new URL('../server/api/asset-libraries/assets.get.ts', import.meta.url), 'utf8')

function item(id, overrides = {}) {
  return {
    id,
    libraryId: 'lib1',
    libraryName: 'Brand Kit',
    name: `Asset ${id}`,
    kind: 'image',
    mimeType: 'image/png',
    url: `https://cdn.example.com/${id}.png`,
    thumbnailUrl: `https://cdn.example.com/thumbnails/v1/320/${id}.webp`,
    size: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

test('← → move across three columns and clamp at the edges', () => {
  assert.deepEqual([...lib.MENTION_COLUMNS], ['models', 'assets', 'library'])
  assert.equal(lib.nextMentionColumn('models', 'ArrowRight'), 'assets')
  assert.equal(lib.nextMentionColumn('assets', 'ArrowRight'), 'library')
  assert.equal(lib.nextMentionColumn('library', 'ArrowRight'), 'library')
  assert.equal(lib.nextMentionColumn('library', 'ArrowLeft'), 'assets')
  assert.equal(lib.nextMentionColumn('assets', 'ArrowLeft'), 'models')
  assert.equal(lib.nextMentionColumn('models', 'ArrowLeft'), 'models')
})

test('library rows carry type, title, library name; video/audio never get an <img> thumbnail', () => {
  const rows = lib.toMentionLibraryAssets([
    item('img'),
    // The API returns the raw video URL as thumbnailUrl for videos.
    item('vid', { kind: 'video', mimeType: 'video/mp4', url: 'https://cdn.example.com/vid.mp4', thumbnailUrl: 'https://cdn.example.com/vid.mp4' }),
    item('aud', { kind: 'audio', mimeType: 'audio/mpeg', url: 'https://cdn.example.com/aud.mp3', thumbnailUrl: 'https://cdn.example.com/aud.mp3' }),
    // Mislabelled kind but a video URL: still treated as video.
    item('odd', { url: 'https://cdn.example.com/odd.mov', thumbnailUrl: 'https://cdn.example.com/odd.mov' }),
    item('blank', { name: '  ' }),
    item('nourl', { url: '' }),
  ])
  assert.equal(rows.length, 5)
  const [img, vid, aud, odd, blank] = rows
  assert.equal(img.thumbnailUrl, 'https://cdn.example.com/thumbnails/v1/320/img.webp')
  assert.equal(img.video || img.audio, false)
  assert.equal(vid.video, true)
  assert.equal(vid.thumbnailUrl, '')
  assert.equal(aud.audio, true)
  assert.equal(aud.thumbnailUrl, '')
  assert.equal(odd.video, true)
  assert.equal(odd.thumbnailUrl, '')
  assert.equal(blank.name, 'Untitled asset')
  assert.equal(img.libraryName, 'Brand Kit')
  for (const row of rows)
    assert.doesNotMatch(row.thumbnailUrl, /\.(mp4|mov|webm|mp3)(\?|#|$)/)
})

test('duplicates collapse within the library column only (after URL normalization)', () => {
  const normalize = url => url.replace('https://legacy.example.com/', 'https://cdn.example.com/')
  const rows = lib.toMentionLibraryAssets(
    [item('a'), item('b'), item('b-copy', { url: 'https://legacy.example.com/b.png' }), item('c')],
    normalize,
  )
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c'])
})

test('library items that are also on the canvas still appear in the Asset library column', () => {
  // Regression: PR #49 dropped library items whose URL matched a Canvas (project) asset, so an asset
  // that had been @-mentioned (and placed on the canvas) vanished from the library column.
  assert.equal(lib.toMentionLibraryAssets.length, 1, 'only items (+ optional normalize); no canvas URLs parameter')
  const rows = lib.toMentionLibraryAssets([item('on-canvas'), item('library-only')], url => url)
  assert.deepEqual(rows.map(row => row.id), ['on-canvas', 'library-only'])
  const call = chat.slice(chat.indexOf('const libraryAssets = computed(() => toMentionLibraryAssets('))
  const args = call.slice(0, call.indexOf('))\n') + 2)
  assert.doesNotMatch(args, /projectAssets/, 'library column must not be filtered by Canvas assets')
  assert.match(args, /mergeLibraryItems\(libraryItems\.value, librarySearchItems\.value\)/)
  assert.match(chat, /Asset library<template v-if="libraryLoaded">\s*· \{\{ libraryAssets\.length \}\}/)
})

test('typed query filters by title and library name, every term must match', () => {
  const rows = lib.toMentionLibraryAssets([
    item('1', { name: 'Red duck logo' }),
    item('2', { name: 'Blue duck', libraryName: 'Campaign' }),
    item('3', { name: 'Hero shot' }),
  ])
  assert.equal(lib.filterMentionLibraryAssets(rows, '').length, 3)
  assert.deepEqual(lib.filterMentionLibraryAssets(rows, 'DUCK').map(row => row.id), ['1', '2'])
  assert.deepEqual(lib.filterMentionLibraryAssets(rows, 'duck campaign').map(row => row.id), ['2'])
  assert.equal(lib.filterMentionLibraryAssets(rows, 'missing').length, 0)
})

test('server search only when the capped first page is full and a query is typed', () => {
  assert.equal(lib.needsLibraryServerSearch(10, 'duck'), false)
  assert.equal(lib.needsLibraryServerSearch(lib.MENTION_LIBRARY_LIMIT, ''), false)
  assert.equal(lib.needsLibraryServerSearch(lib.MENTION_LIBRARY_LIMIT, 'duck'), true)
  assert.equal(lib.libraryServerSearchTerm('red  duckling'), 'duckling')
  assert.deepEqual(lib.mergeLibraryItems([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }, { id: 'c' }]).map(x => x.id), ['a', 'b', 'c'])
  assert.ok(lib.MENTION_LIBRARY_LIMIT <= 200, 'within the API cap')
  assert.match(endpoint, /searchLibraryAssets\(\{ q, limit \}\)/)
})

test('composer wires the third column: lazy load on @, loading/empty states, keyboard, same attach path', () => {
  assert.match(chat, /if \(trigger === '@'\) \{\s*emit\('browseAssets'\)\s*void loadLibraryAssets\(\)/)
  assert.match(chat, /\$fetch<AssetLibraryAssetSearchList>\('\/api\/asset-libraries\/assets', \{ query: \{ limit: MENTION_LIBRARY_LIMIT \} \}\)/)
  assert.match(chat, /Asset library<template v-if="libraryLoaded">/)
  assert.match(chat, /Loading asset library…/)
  assert.match(chat, /No items in your Asset Library yet/)
  assert.match(chat, /No matching library items/)
  assert.match(chat, /mentionColumn\.value = nextMentionColumn\(mentionColumn\.value, event\.key\)/)
  assert.match(chat, /const libraryAsset = mentionColumn\.value === 'library' \? libraryMatches\.value\[mentionIndex\.value\]/)
  assert.match(chat, /void selectAsset\(libraryAsset\)/)
  assert.match(chat, /v-for="\(asset, index\) in libraryMatches"[\s\S]*?@click="selectAsset\(asset\)"/)
  // Header still advertises column switching; mobile keeps columns usable via horizontal scroll.
  assert.match(chat, /← → Switch columns · ↑ ↓ Navigate · Enter Select/)
  assert.match(chat, /grid-cols-\[repeat\(3,minmax\(10rem,1fr\)\)\][^"]*overflow-x-auto/)
})

test('library column never binds a video URL to <img>', () => {
  const column = chat.slice(chat.indexOf('data-testid="mention-asset-library"'))
  const block = column.slice(0, column.indexOf('</button>'))
  assert.match(block, /<video\s+v-else-if="asset\.video"[\s\S]*?preload="metadata"/)
  assert.match(block, /<img v-else :src="asset\.thumbnailUrl \|\| thumbnailSrc\(asset\.url\)"/)
  assert.ok(block.indexOf('asset.video') < block.indexOf('<img'), 'video branch precedes the <img> fallback')
})
