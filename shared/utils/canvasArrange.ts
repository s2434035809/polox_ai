import type { CanvasRect } from '../types/canvas'

export type CanvasArrangeOrder = 'oldest' | 'newest' | 'type'

export interface CanvasArrangeItem {
  id: string
  createdAt?: string
  taskId?: string
  resultIndex?: number
  url?: string
  sourceUrls?: string[]
  video?: boolean
  audio?: boolean
  document?: boolean
  rect: CanvasRect
}

export const ARRANGE_CELL_WIDTH = 280
export const ARRANGE_CELL_HEIGHT = 282
export const ARRANGE_COLUMN_GAP = 40
export const ARRANGE_ROW_GAP = 40
export const ARRANGE_GROUP_GAP = 80
export const ARRANGE_COLUMNS = 10

/** A stable reading order, independent of API pagination and input array order. */
export function arrangeCanvasItems(items: CanvasArrangeItem[], order: CanvasArrangeOrder = 'oldest'): Map<string, CanvasRect> {
  const visible = items.filter(item => !item.rect.hidden)
  const byUrl = new Map(visible.filter(item => item.url).map(item => [item.url!, item]))
  const time = (item: CanvasArrangeItem) => {
    const parsed = Date.parse(item.createdAt || '')
    return Number.isFinite(parsed) ? parsed : null
  }
  const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  const chronological = (a: CanvasArrangeItem, b: CanvasArrangeItem) => {
    const left = time(a)
    const right = time(b)
    if (left !== null && right !== null && left !== right)
      return (order === 'newest' ? -1 : 1) * (left - right)
    if (left === null && right !== null) return 1
    if (left !== null && right === null) return -1
    return compareId(a.id, b.id)
  }
  const groups = new Map<string, CanvasArrangeItem[]>()
  for (const item of visible) {
    const key = item.taskId ? `task:${item.taskId}` : `item:${item.id}`
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  }
  const keyOf = (item: CanvasArrangeItem) => item.taskId ? `task:${item.taskId}` : `item:${item.id}`
  const representative = (group: CanvasArrangeItem[]) => [...group].sort(chronological)[0]!
  const kind = (item: CanvasArrangeItem) => item.video ? 1 : item.audio || item.document ? 2 : 0
  const sorted = [...groups.entries()].sort((a, b) => {
    if (order === 'type') {
      const type = kind(representative(a[1])) - kind(representative(b[1]))
      if (type) return type
    }
    return chronological(representative(a[1]), representative(b[1])) || compareId(a[0], b[0])
  })
  const groupKinds = new Map(sorted.map(([key, group]) => [key, kind(representative(group))]))

  // Move a derived group immediately after its source group when the source is
  // also on this canvas. In type order, keep different kinds in their own sections.
  // Cycles and missing sources retain the primary order.
  const parent = new Map<string, string>()
  for (const [key, group] of sorted) {
    for (const item of [...group].sort(chronological)) {
      const source = item.sourceUrls?.map(url => byUrl.get(url)).find(candidate => candidate && keyOf(candidate) !== key
        && (order !== 'type' || groupKinds.get(key) === groupKinds.get(keyOf(candidate))))
      if (source) {
        parent.set(key, keyOf(source))
        break
      }
    }
  }
  const arrangedGroups: typeof sorted = []
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  const children = (key: string) => sorted.filter(([child]) => parent.get(child) === key)
  const emit = (entry: typeof sorted[number]) => {
    const [key] = entry
    if (emitted.has(key) || visiting.has(key)) return
    visiting.add(key)
    arrangedGroups.push(entry)
    emitted.add(key)
    for (const child of children(key)) emit(child)
    visiting.delete(key)
  }
  for (const entry of sorted) {
    const [key] = entry
    if (!parent.has(key) || !groups.has(parent.get(key)!)) emit(entry)
  }
  for (const entry of sorted) emit(entry)

  // Keep ten fixed columns so saved layouts reflow identically on every viewport.
  // A batch takes consecutive cells; a batch that cannot fit starts on a new row.
  const result = new Map<string, CanvasRect>()
  const rowStep = ARRANGE_CELL_HEIGHT + ARRANGE_ROW_GAP
  const columnStep = ARRANGE_CELL_WIDTH + ARRANGE_COLUMN_GAP
  let rowY = 0
  let column = 0
  for (const [, group] of arrangedGroups) {
    const ordered = [...group].sort((a, b) => {
      if (a.resultIndex !== undefined && b.resultIndex !== undefined && a.resultIndex !== b.resultIndex)
        return a.resultIndex - b.resultIndex
      return chronological(a, b)
    })
    if (column && ordered.length > ARRANGE_COLUMNS - column) {
      rowY += rowStep
      column = 0
    }
    for (const [index, item] of ordered.entries()) {
      result.set(item.id, {
        ...item.rect,
        x: ((column + index) % ARRANGE_COLUMNS) * columnStep,
        y: rowY + Math.floor((column + index) / ARRANGE_COLUMNS) * rowStep,
        width: ARRANGE_CELL_WIDTH,
        height: ARRANGE_CELL_HEIGHT,
      })
    }
    if (ordered.length > ARRANGE_COLUMNS) {
      rowY += Math.floor((ordered.length - 1) / ARRANGE_COLUMNS) * rowStep + ARRANGE_CELL_HEIGHT + ARRANGE_GROUP_GAP
      column = 0
    }
    else {
      column += ordered.length
      if (column === ARRANGE_COLUMNS) {
        rowY += rowStep
        column = 0
      }
    }
  }
  return result
}
