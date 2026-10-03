import type { GenerationProjectList, GenerationProjectPublic } from '~~/shared/types/project'
import { isSkillWorkspace, studioProjectSelection, studioProjectsOnly } from '~~/shared/utils/projectVisibility'

let inflight: Promise<void> | null = null
export function useProjects() {
  const projects = useState<GenerationProjectPublic[]>('generation-projects', () => [])
  const selectedProjectId = useState('generation-project-id', () => '')
  const loaded = useState('generation-projects-loaded', () => false)
  const loading = useState('generation-projects-loading', () => false)
  const route = useRoute()

  /** Project open on /projects/:id (may be a skill workspace that is not in `projects`). */
  function openProjectPageId() {
    const match = /^\/projects\/([^/]+)$/.exec(route?.path || '')
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }

  const selectedProject = computed(() => projects.value.find(project => project.id === selectedProjectId.value)
    || projects.value[0]
    || null)

  /** Studio/media projects only — skill workspaces live under Skills. */
  const studioProjects = computed(() => studioProjectsOnly(projects.value))

  /**
   * Pickers must point at a studio project. A skill workspace can stay selected
   * while its project page is open; otherwise move back to the default studio project.
   */
  function selectStudioProject() {
    const current = selectedProjectId.value
    if (current && current === openProjectPageId())
      return current
    const next = studioProjectSelection(projects.value, current)
    if (next && next !== current)
      selectedProjectId.value = next
    return next || current
  }

  async function createProject(input: {
    name?: string
    description?: string
    kind?: 'studio' | 'skill'
    skillId?: string
  } = {}) {
    const project = await $fetch<GenerationProjectPublic>('/api/projects', {
      method: 'POST',
      body: input,
    })
    if (!isSkillWorkspace(project))
      projects.value = [project, ...projects.value.filter(item => item.id !== project.id)]
    selectedProjectId.value = project.id
    return project
  }

  /** 1 skill ↔ 1 project. Creates or returns the bound skill workspace. */
  async function ensureSkillProject(input: {
    skillId?: string
    name?: string
    description?: string
    projectId?: string
  } = {}) {
    const project = await $fetch<GenerationProjectPublic>('/api/projects/skill', {
      method: 'POST',
      body: input,
    })
    // Skill workspaces stay out of the studio list; they are opened from My Skills by id.
    projects.value = projects.value.filter(item => item.id !== project.id)
    selectedProjectId.value = project.id
    return project
  }

  async function loadProjects() {
    if (!import.meta.client) {
      return
    }
    if (inflight)
      return inflight
    loading.value = true
    inflight = (async () => {
      try {
        const data = await $fetch<GenerationProjectList>('/api/projects')
        projects.value = studioProjectsOnly(data.items)
        const selected = projects.value.some(project => project.id === selectedProjectId.value)
        // Keep selection when the open page is a skill workspace (My Skills Edit/Test).
        if (!selected && !(selectedProjectId.value && selectedProjectId.value === openProjectPageId()))
          selectedProjectId.value = studioProjectSelection(projects.value, '')
      }
      catch (error) {
        console.error('[projects]', error)
      }
      finally {
        loading.value = false
        loaded.value = true
        inflight = null
      }
    })()
    return inflight
  }
  if (import.meta.client) {
    void loadProjects()
  }
  return {
    projects,
    studioProjects,
    selectedProjectId,
    selectedProject,
    loaded,
    loading,
    loadProjects,
    createProject,
    ensureSkillProject,
    selectStudioProject,
  }
}
