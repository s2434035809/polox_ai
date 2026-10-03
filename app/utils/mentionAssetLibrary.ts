import type { AssetLibraryAssetSearchItem } from '~~/shared/types/assetLibrary'

/** Columns of the composer "@" menu, left to right. */
export const MENTION_COLUMNS = ['models', 'assets', 'library'] as const
export type MentionColumn = typeof MENTION_COLUMNS[number]

/** How many Asset Library items the "@" menu loads at once (the API caps at 200). */
export const MENTION_LIBRARY_LIMIT = 60

export interface MentionLibraryAsset {
  id: string
  url: string
  /** Image thumbnail only. Never set for video/audio so a video URL never lands in an <img>. */
  thumbnailUrl: string
  name: string
  libraryName: string
  video: boolean
  audio: boolean
  document: false
}

const VIDEO_URL_RE = /\.(?:mp4|webm|mov|mkv|m4v)(?:[?#]|$)/i

/** ← / → move one column, clamped at the edges (no wrap, matching the two-column behavior). */
export function nextMentionColumn(current: MentionColumn, key: 'ArrowLeft' | 'ArrowRight'): MentionColumn {
  const index = Math.max(0, MENTION_COLUMNS.indexOf(current))
  const next = key === 'ArrowLeft' ? Math.max(0, index - 1) : Math.min(MENTION_COLUMNS.length - 1, index + 1)
  return MENTION_COLUMNS[next]!
}

export function mentionQueryTerms(query: string | undefined) {
  return String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
}

/**
 * Asset Library API items -> "@" menu rows. Drops items without a usable URL and collapses duplicates
 * within the library column (compared after `normalize`, e.g. renderedMediaUrl).
 *
 * Deliberately NOT deduped against the Canvas column: the Asset library column always lists every
 * library item, even when the same asset is also on the canvas (e.g. it was @-mentioned before).
 */
export function toMentionLibraryAssets(
  items: AssetLibraryAssetSearchItem[] | undefined | null,
  normalize: (url: string) => string = url => url,
): MentionLibraryAsset[] {
  const seen = new Set<string>()
  const result: MentionLibraryAsset[] = []
  for (const item of items || []) {
    const url = String(item?.url || '').trim()
    if (!url)
      continue
    const key = normalize(url)
    if (seen.has(key))
      continue
    seen.add(key)
    const audio = item.kind === 'audio'
    const video = !audio && (item.kind === 'video' || VIDEO_URL_RE.test(url))
    const thumb = !audio && !video ? String(item.thumbnailUrl || '').trim() : ''
    result.push({
      id: String(item.id || url),
      url,
      thumbnailUrl: VIDEO_URL_RE.test(thumb) ? '' : thumb,
      name: String(item.name || '').trim() || 'Untitled asset',
      libraryName: String(item.libraryName || '').trim(),
      video,
      audio,
      document: false,
    })
  }
  return result
}

/** Every typed term must appear in the asset or library name. */
export function filterMentionLibraryAssets(assets: MentionLibraryAsset[], query: string | undefined) {
  const terms = mentionQueryTerms(query)
  if (!terms.length)
    return assets
  return assets.filter((asset) => {
    const haystack = `${asset.name} ${asset.libraryName}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
}

/**
 * Whether a typed query needs a server search: the first page was full (there may be more items
 * than were loaded), so matches beyond the cap are fetched with `q`.
 */
export function needsLibraryServerSearch(loadedCount: number, query: string | undefined, limit = MENTION_LIBRARY_LIMIT) {
  return loadedCount >= limit && mentionQueryTerms(query).length > 0
}

/** Server search matches one contiguous name substring: send the longest typed term, filter the rest locally. */
export function libraryServerSearchTerm(query: string | undefined) {
  return mentionQueryTerms(query).sort((a, b) => b.length - a.length)[0] || ''
}

/** Append items not already present (by id), keeping the original order first. */
export function mergeLibraryItems<T extends { id: string }>(base: T[], extra: T[]) {
  const ids = new Set(base.map(item => item.id))
  return [...base, ...extra.filter(item => !ids.has(item.id) && ids.add(item.id))]
}
