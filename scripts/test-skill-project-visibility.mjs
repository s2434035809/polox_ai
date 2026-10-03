import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  isSkillWorkspace,
  studioProjectSelection,
  studioProjectsOnly,
  userProjectListFilter,
  wantsSkillProjects,
} from '../shared/utils/projectVisibility.ts'

const studioDefault = { id: 'p-default', name: 'Default', isDefault: true, kind: 'studio' }
const studioNamedLikeSkill = { id: 'p-studio-untitled', name: 'Untitled Skill (abc12345)', isDefault: false, kind: 'studio' }
const legacyNoKind = { id: 'p-legacy', name: 'Old project', isDefault: false }
const skillRestyler = { id: 'p-skill-1', name: 'AI Room Restyler', isDefault: false, kind: 'skill', skillId: 'ai-room-restyler' }
const skillDraft = { id: 'p-skill-2', name: 'Untitled Skill (k882rj1m)', isDefault: false, kind: 'skill', skillId: 'untitled-k882rj1m' }
const skillUnbound = { id: 'p-skill-3', name: 'Project named Default', isDefault: false, kind: 'skill', skillId: '' }
const all = [studioDefault, skillRestyler, studioNamedLikeSkill, skillDraft, legacyNoKind, skillUnbound]

test('skill projects are identified structurally by kind, not by name', () => {
  assert.equal(isSkillWorkspace(skillRestyler), true)
  assert.equal(isSkillWorkspace(skillDraft), true)
  assert.equal(isSkillWorkspace(skillUnbound), true)
  assert.equal(isSkillWorkspace(studioNamedLikeSkill), false)
  assert.equal(isSkillWorkspace(legacyNoKind), false)
  assert.equal(isSkillWorkspace(null), false)
  assert.deepEqual(studioProjectsOnly(all).map(project => project.id), ['p-default', 'p-studio-untitled', 'p-legacy'])
})

test('sqlite list filter excludes kind=skill unless includeSkills is set', () => {
  assert.deepEqual(userProjectListFilter(), { kind: { $ne: 'skill' } })
  assert.deepEqual(userProjectListFilter({ includeSkills: false }), { kind: { $ne: 'skill' } })
  assert.deepEqual(userProjectListFilter({ includeSkills: true }), {})
})

test('includeSkills query parsing is opt-in only', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', ['1']])
    assert.equal(wantsSkillProjects({ includeSkills: value }), true, String(value))
  for (const value of [undefined, '', '0', 'false', 'no', null])
    assert.equal(wantsSkillProjects({ includeSkills: value }), false, String(value))
  assert.equal(wantsSkillProjects(undefined), false)
})

test('picker selection falls back from a skill workspace to the default studio project', () => {
  assert.equal(studioProjectSelection(all, 'p-skill-1'), 'p-default')
  assert.equal(studioProjectSelection(all, 'p-studio-untitled'), 'p-studio-untitled')
  assert.equal(studioProjectSelection(all, 'p-legacy'), 'p-legacy')
  assert.equal(studioProjectSelection(all, ''), 'p-default')
  assert.equal(studioProjectSelection([skillRestyler], 'p-skill-1'), '')
})

test('project list and client store keep skill workspaces out of pickers', () => {
  const api = readFileSync(new URL('../server/api/projects/index.get.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../app/composables/useProjects.ts', import.meta.url), 'utf8')
  assert.match(api, /wantsSkillProjects/)
  assert.match(api, /userProjectListFilter/)
  assert.match(client, /studioProjectsOnly\(data\.items\)/)
  assert.match(client, /if \(!isSkillWorkspace\(project\)\)/)
  assert.match(client, /projects\.value = projects\.value\.filter\(item => item\.id !== project\.id\)/)
  assert.match(client, /openProjectPageId/)
})
