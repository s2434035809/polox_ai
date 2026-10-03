export const MY_SKILLS_PAGE_SIZE = 24
export const MY_SKILLS_SEARCH_MAX_LENGTH = 100

export type MySkillVisibility = 'all' | 'public' | 'private'

export function mySkillVisibility(value: unknown): MySkillVisibility {
  const first = Array.isArray(value) ? value[0] : value
  return first === 'public' || first === 'private' ? first : 'all'
}

/**
 * Shape kept for parity with the commercial helper. The local My Skills page
 * filters in memory; this is not sent to SQLite.
 */
export function mySkillVisibilityMongoQuery(visibility: MySkillVisibility) {
  return visibility === 'public'
    ? { visibility: 'public' as const }
    : visibility === 'private' ? { visibility: { $ne: 'public' as const } } : {}
}

export function mySkillSearchTerm(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first.trim().slice(0, MY_SKILLS_SEARCH_MAX_LENGTH) : ''
}

export function escapeMySkillSearchRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Unused by the SQLite list. Client search uses `mySkillMatchesSearch`. */
export function mySkillSearchMongoQuery(q: string) {
  if (!q)
    return {}
  const pattern = { $regex: escapeMySkillSearchRegex(q), $options: 'i' }
  return { $or: ['name', 'description', 'skillId', 'keywords', 'triggers'].map(field => ({ [field]: pattern })) }
}

export function mySkillMatchesSearch(skill: {
  name?: unknown
  description?: unknown
  id?: unknown
  skillId?: unknown
  keywords?: unknown
  triggers?: unknown
}, value: unknown) {
  const q = mySkillSearchTerm(value)
  if (!q)
    return true
  const regex = new RegExp(escapeMySkillSearchRegex(q), 'i')
  return [skill.name, skill.description, skill.id, skill.skillId, skill.keywords, skill.triggers]
    .some(field => Array.isArray(field) ? field.some(item => typeof item === 'string' && regex.test(item)) : typeof field === 'string' && regex.test(field))
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first !== 'string' && typeof first !== 'number')
    return fallback
  const number = Number(first)
  return Number.isSafeInteger(number) && number >= 1 ? Math.min(number, max) : fallback
}

export function mySkillPaginationQuery(query: { page?: unknown, limit?: unknown, q?: unknown }) {
  const enabled = query.page !== undefined || query.limit !== undefined || query.q !== undefined
  return {
    enabled,
    page: positiveInteger(query.page, 1, 100000),
    limit: positiveInteger(query.limit, MY_SKILLS_PAGE_SIZE, 48),
    q: mySkillSearchTerm(query.q),
  }
}

export function mySkillPageSlice(page: number, limit: number, total: number) {
  const actualPage = Math.min(page, Math.max(1, Math.ceil(total / limit)))
  return { page: actualPage, limit, total, skip: (actualPage - 1) * limit }
}

export function mySkillPageAfterRemoval(page: number, remaining: number) {
  return remaining === 0 && page > 1 ? page - 1 : page
}
