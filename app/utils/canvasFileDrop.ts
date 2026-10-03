import type { CanvasRect } from '~~/shared/types/canvas'
import { CARD_HEIGHT, CARD_WIDTH, CELL_X, CELL_Y, findFreeRect } from '~/utils/infiniteCanvas'

export const CANVAS_DROP_COLUMNS = 3

/** Screen (client) coordinates → canvas world coordinates. */
export function canvasWorldPoint(client: { x: number, y: number }, surface: { left: number, top: number }, camera: { x: number, y: number, zoom: number }) {
  return {
    x: (client.x - surface.left - camera.x) / camera.zoom,
    y: (client.y - surface.top - camera.y) / camera.zoom,
  }
}

/**
 * Card slots for files dropped at `point` (world coordinates): the first card is centred
 * on the drop point, the rest fill a small grid to its right/below. Every slot is pushed
 * clear of existing cards and of the slots before it, so nothing overlaps.
 */
export function layoutDroppedFiles(point: { x: number, y: number }, count: number, occupied: CanvasRect[]): CanvasRect[] {
  const taken = [...occupied]
  const originX = Math.round(point.x - CARD_WIDTH / 2)
  const originY = Math.round(point.y - CARD_HEIGHT / 2)
  const slots: CanvasRect[] = []
  for (let index = 0; index < count; index++) {
    const preferred = {
      x: originX + (index % CANVAS_DROP_COLUMNS) * CELL_X,
      y: originY + Math.floor(index / CANVAS_DROP_COLUMNS) * CELL_Y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }
    const slot = findFreeRect(preferred, taken)
    slots.push(slot)
    taken.push(slot)
  }
  return slots
}

/**
 * Card slots for files picked with the toolbar upload button: the whole grid is centred on
 * `center` (the current viewport centre, in world coordinates) and every slot is pushed
 * clear of existing cards and of the slots before it, so nothing overlaps.
 */
export function layoutCenteredFiles(center: { x: number, y: number }, count: number, occupied: CanvasRect[]): CanvasRect[] {
  if (count <= 0)
    return []
  const columns = Math.min(count, CANVAS_DROP_COLUMNS)
  const rows = Math.ceil(count / CANVAS_DROP_COLUMNS)
  const gridWidth = (columns - 1) * CELL_X + CARD_WIDTH
  const gridHeight = (rows - 1) * CELL_Y + CARD_HEIGHT
  const originX = Math.round(center.x - gridWidth / 2)
  const originY = Math.round(center.y - gridHeight / 2)
  const taken = [...occupied]
  const slots: CanvasRect[] = []
  for (let index = 0; index < count; index++) {
    const slot = findFreeRect({
      x: originX + (index % CANVAS_DROP_COLUMNS) * CELL_X,
      y: originY + Math.floor(index / CANVAS_DROP_COLUMNS) * CELL_Y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }, taken)
    slots.push(slot)
    taken.push(slot)
  }
  return slots
}
