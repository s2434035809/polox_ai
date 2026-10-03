/** Canvas asset drawer sizing: the sheet never exceeds half the viewport (or its container). */
export const ASSET_SHEET_MIN_HEIGHT = 160
export const ASSET_SHEET_MAX_VIEWPORT_RATIO = 0.5
export const ASSET_SHEET_DEFAULT_VIEWPORT_RATIO = 0.36
/** Room kept above the sheet inside the canvas for the tool toolbar that rides on top of it. */
export const ASSET_SHEET_TOOLBAR_CLEARANCE = 64

export function maxSheetHeight(viewportHeight: number, containerHeight = 0) {
  const byViewport = Math.floor(Math.max(0, viewportHeight) * ASSET_SHEET_MAX_VIEWPORT_RATIO)
  if (containerHeight > 0)
    return Math.max(0, Math.min(byViewport, containerHeight - ASSET_SHEET_TOOLBAR_CLEARANCE))
  return byViewport
}

export function clampSheetHeight(height: number, viewportHeight: number, containerHeight = 0) {
  const max = maxSheetHeight(viewportHeight, containerHeight)
  const min = Math.min(ASSET_SHEET_MIN_HEIGHT, max)
  const value = Number.isFinite(height) ? height : min
  return Math.round(Math.min(max, Math.max(min, value)))
}

export function defaultSheetHeight(viewportHeight: number) {
  return Math.round(Math.max(0, viewportHeight) * ASSET_SHEET_DEFAULT_VIEWPORT_RATIO)
}
