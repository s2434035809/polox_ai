import type { ProjectKind } from '../types/project'

/**
 * Skill-editing workspaces (Skill Creator / My Skills Edit) are `kind === 'skill'`.
 * They stay reachable from My Skills and must not appear in studio lists or pickers.
 * Never identify them by name.
 */
export function isSkillWorkspace(project: { kind?: ProjectKind | string | null } | null | undefined) {
  return project?.kind === 'skill'
}

export function studioProjectsOnly<T extends { kind?: ProjectKind | string | null }>(projects: readonly T[]) {
  return projects.filter(project => !isSkillWorkspace(project))
}

/** `GET /api/projects?includeSkills=1` opts in to skill workspaces; default is studio only. */
export function wantsSkillProjects(query: Record<string, unknown> | null | undefined) {
  const raw = query?.includeSkills
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * SQLite list filter. Legacy rows without `kind` count as studio projects,
 * so the default excludes `kind: 'skill'` instead of requiring `kind: 'studio'`.
 * There is no user id — this install has no accounts.
 */
export function userProjectListFilter(options: { includeSkills?: boolean } = {}) {
  return options.includeSkills
    ? {}
    : { kind: { $ne: 'skill' as const } }
}

/**
 * Pick the studio project a picker should show. Keeps the current selection
 * when it is a studio project, otherwise the default (then first) studio project.
 */
export function studioProjectSelection(
  projects: readonly { id: string, isDefault?: boolean, kind?: ProjectKind | string | null }[],
  selectedId: string,
) {
  const studio = studioProjectsOnly(projects)
  if (selectedId && studio.some(project => project.id === selectedId))
    return selectedId
  return studio.find(project => project.isDefault)?.id || studio[0]?.id || ''
}
