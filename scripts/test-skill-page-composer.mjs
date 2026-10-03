import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { enforceFirstTurnLockedSkill } from '../server/agent/lockedSkill.ts'

const root = resolve(import.meta.dirname, '..')
const source = path => readFileSync(resolve(root, path), 'utf8')

test('first turn keeps only the authorized locked skill; later turns are normal', async () => {
  const access = async id => id === 'chosen-skill'
  assert.equal(await enforceFirstTurnLockedSkill('/other-skill make art /chosen-skill', 'chosen-skill', true, access), '/chosen-skill make art')
  assert.equal(await enforceFirstTurnLockedSkill('/other-skill next', 'chosen-skill', false, access), '/other-skill next')
  await assert.rejects(enforceFirstTurnLockedSkill('/other-skill', 'private-skill', true, access), /unavailable/)
  await assert.rejects(enforceFirstTurnLockedSkill('hello', '../bad', true, access), /unavailable/)
})

test('skill page locks the home composer and does not add SEO, author, or related skills', () => {
  const page = source('app/pages/skills/[id].vue')
  const home = source('app/components/home/HomeAgentComposer.vue')
  const chat = source('app/components/agent-lab/AgentLabChat.vue')
  const creator = source('server/agent/skills/skill-creator.md')
  assert.match(page, /<HomeAgentComposer[\s\S]*:locked-skill=/)
  assert.doesNotMatch(page, /RelatedSkills|SkillAuthorBadge|seoTitle|useSeoMeta/)
  assert.match(home, /enforceLockedSkill: Boolean\(props\.lockedSkill\)/)
  assert.match(home, /seedLockedDraft/)
  assert.match(chat, /locked\.placeholder/)
  assert.match(creator, /WIP save does \*\*not\*\* finish the flow/)
  assert.match(creator, /including a rename of a draft/)
  assert.doesNotMatch(creator, /skill_seo_title|seoTitle/)
})
