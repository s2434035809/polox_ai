/**
 * Canvas → agent chat drag hand-off.
 *
 * The infinite canvas owns its pointer drags (pan, marquee, move, resize) via pointer
 * capture. Moving a card inside the canvas keeps that behaviour; once the pointer leaves
 * the canvas bounds the card snaps back to where it started and a ghost follows the
 * cursor instead. Releasing over an element marked with CANVAS_ASSET_DROP_ATTR (the chat
 * panel, only while it can accept attachments) attaches the asset through the same
 * pipeline as the canvas "Use as reference" button.
 */

export const CANVAS_ASSET_DROP_ATTR = 'data-agent-asset-drop'
export const CANVAS_ASSET_DRAG_STATE_KEY = 'canvas-asset-drag'
/** Asset library folder drop target (canvas asset drawer); the value is the library id. */
export const ASSET_LIBRARY_DROP_ATTR = 'data-asset-library-drop'
/** The canvas surface: library assets dragged out of the drawer land here. */
export const CANVAS_SURFACE_DROP_ATTR = 'data-canvas-asset-surface'
/** UI floating over the canvas (the asset drawer): never counts as the canvas surface. */
export const CANVAS_OVERLAY_ATTR = 'data-canvas-overlay'

export type AssetDropTarget = { type: 'chat' } | { type: 'library', libraryId: string } | { type: 'canvas' }

interface ClosestLike {
  closest: (selector: string) => { getAttribute: (name: string) => string | null } | null
}

/**
 * Drop target under the pointer (pass `document.elementFromPoint(x, y)`). Chat and library
 * folders win over the canvas; anything inside a canvas overlay is never the canvas.
 */
export function resolveAssetDropTarget(element: ClosestLike | null | undefined): AssetDropTarget | null {
  if (!element)
    return null
  if (element.closest(`[${CANVAS_ASSET_DROP_ATTR}]`))
    return { type: 'chat' }
  const library = element.closest(`[${ASSET_LIBRARY_DROP_ATTR}]`)
  const libraryId = library?.getAttribute(ASSET_LIBRARY_DROP_ATTR)
  if (library && libraryId)
    return { type: 'library', libraryId }
  if (element.closest(`[${CANVAS_OVERLAY_ATTR}]`))
    return null
  if (element.closest(`[${CANVAS_SURFACE_DROP_ATTR}]`))
    return { type: 'canvas' }
  return null
}

/** Pointer sits on UI floating over the canvas (drawer), so a card drag must not move under it. */
export function isOverCanvasOverlay(element: ClosestLike | null | undefined): boolean {
  return Boolean(element?.closest(`[${CANVAS_OVERLAY_ATTR}]`))
}

export interface CanvasDragRect { left: number, top: number, right: number, bottom: number }
export interface CanvasDragPoint { x: number, y: number }

export type CanvasAssetDragPhase = 'canvas' | 'outside' | 'target'

export interface CanvasAssetDragState {
  /** Pointer is outside the canvas and a hand-off is possible. */
  phase: Exclude<CanvasAssetDragPhase, 'canvas'>
  x: number
  y: number
  name: string
  previewUrl: string
  kind: 'image' | 'video' | 'audio' | 'document'
  /** Where the drag came from; canvas card drags (PR #38) omit it. */
  source?: 'canvas' | 'library'
  /** Target under the pointer while phase === 'target' (omitted = chat, the original target). */
  target?: AssetDropTarget['type']
  /** Library folder under the pointer when target === 'library'. */
  libraryId?: string
}

/** The chat input should highlight as "release to attach". */
export function assetDragTargetsChat(state: CanvasAssetDragState | null | undefined): boolean {
  return Boolean(state && state.phase === 'target' && (state.target ?? 'chat') === 'chat')
}

/** Whether `target` accepts a drag of `kind` from `source`. */
export function acceptsAssetDrop(target: AssetDropTarget | null, options: { source: 'canvas' | 'library', kind: CanvasAssetDragState['kind'] }): target is AssetDropTarget {
  if (!target)
    return false
  if (target.type === 'chat')
    return true
  if (target.type === 'library')
    // Libraries store image / video / audio only, and never re-import their own assets.
    return options.source === 'canvas' && options.kind !== 'document'
  return options.source === 'library'
}

/** Ghost caption for the current drag phase / target. */
export function assetDragHint(state: Pick<CanvasAssetDragState, 'phase' | 'target' | 'source'>): string {
  if (state.phase === 'target') {
    if (state.target === 'library')
      return 'Release to save to this folder'
    if (state.target === 'canvas')
      return 'Release to place on the canvas'
    return 'Release to attach'
  }
  return state.source === 'library' ? 'Drop on the canvas or the chat' : 'Drop on the chat to attach'
}

export interface CanvasDragAssetLike {
  url: string
  state: string
  video?: boolean
  audio?: boolean
  document?: boolean
}

export function isOutsideRect(point: CanvasDragPoint, rect: CanvasDragRect): boolean {
  return point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom
}

/** Only finished, hosted assets can be attached (same rule as the "Use as reference" action). */
export function canDragAssetToChat(asset: CanvasDragAssetLike | undefined | null): boolean {
  return Boolean(asset && asset.state === 'success' && /^https?:\/\//i.test(asset.url.trim()))
}

export function canvasDragAssetKind(asset: CanvasDragAssetLike): CanvasAssetDragState['kind'] {
  return asset.audio ? 'audio' : asset.video ? 'video' : asset.document ? 'document' : 'image'
}

/**
 * Hand-off is opt-in (the canvas must offer attaching and be editable) and mouse/pen only:
 * touch drags on phones keep the pre-existing canvas behaviour untouched.
 */
export function canvasHandoffEnabled(options: { showAttach?: boolean, readOnly?: boolean, pointerType?: string }): boolean {
  return Boolean(options.showAttach && !options.readOnly && options.pointerType !== 'touch')
}

/** Drag phase for the current pointer position. */
export function canvasAssetDragPhase(options: { outside: boolean, overTarget: boolean }): CanvasAssetDragPhase {
  if (!options.outside)
    return 'canvas'
  return options.overTarget ? 'target' : 'outside'
}

/** OS file drags expose the "Files" type; in-page text/link drags do not. */
export function dataTransferHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Boolean(types && Array.from(types).includes('Files'))
}
