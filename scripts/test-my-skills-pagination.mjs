import assert from 'node:assert/strict'
import test from 'node:test'
import { MY_SKILLS_PAGE_SIZE, MY_SKILLS_SEARCH_MAX_LENGTH, escapeMySkillSearchRegex, mySkillMatchesSearch, mySkillPageAfterRemoval, mySkillPageSlice, mySkillPaginationQuery, mySkillSearchMongoQuery, mySkillSearchTerm, mySkillVisibility, mySkillVisibilityMongoQuery } from '../shared/utils/mySkillPagination.ts'

test('visibility filter accepts public and private, including legacy private skills', () => {
  assert.equal(mySkillVisibility('public'), 'public')
  assert.equal(mySkillVisibility(['private', 'public']), 'private')
  assert.equal(mySkillVisibility('invalid'), 'all')
  assert.deepEqual(mySkillVisibilityMongoQuery('all'), {})
  assert.deepEqual(mySkillVisibilityMongoQuery('public'), { visibility: 'public' })
  assert.deepEqual(mySkillVisibilityMongoQuery('private'), { visibility: { $ne: 'public' } })
})

test('pagination is opt-in and defaults to 24 items', () => {
  assert.deepEqual(mySkillPaginationQuery({}), { enabled: false, page: 1, limit: MY_SKILLS_PAGE_SIZE, q: '' })
  assert.deepEqual(mySkillPaginationQuery({ category: 'fun' }), { enabled: false, page: 1, limit: MY_SKILLS_PAGE_SIZE, q: '' })
  assert.deepEqual(mySkillPaginationQuery({ page: '2' }), { enabled: true, page: 2, limit: 24, q: '' })
  assert.deepEqual(mySkillPaginationQuery({ limit: '12' }), { enabled: true, page: 1, limit: 12, q: '' })
  assert.deepEqual(mySkillPaginationQuery({ q: '  ' }), { enabled: true, page: 1, limit: 24, q: '' })
})

test('invalid page and limit values fall back; large numbers stay bounded', () => {
  for (const page of ['0', '-1', '1.5', 'NaN', '', undefined])
    assert.equal(mySkillPaginationQuery({ page }).page, 1)
  assert.deepEqual(mySkillPaginationQuery({ page: ['3', '4'], limit: ['8', '9'] }), { enabled: true, page: 3, limit: 8, q: '' })
  assert.deepEqual(mySkillPaginationQuery({ page: '999999', limit: '999' }), { enabled: true, page: 100000, limit: 48, q: '' })
})

test('search query trims, caps, and treats empty input as no filter', () => {
  assert.equal(mySkillSearchTerm(['  CaT  ', 'ignored']), 'CaT')
  assert.equal(mySkillSearchTerm(' x'.repeat(80)).length, MY_SKILLS_SEARCH_MAX_LENGTH)
  assert.equal(mySkillSearchTerm(42), '')
  assert.equal(mySkillPaginationQuery({ page: '3', q: '  Tools  ' }).q, 'Tools')
  assert.equal(mySkillPaginationQuery({ q: '  Tools  ' }).enabled, true)
  assert.deepEqual(mySkillSearchMongoQuery(''), {})
  assert.equal(mySkillMatchesSearch({ name: 'Any skill' }, ''), true)
})

test('search escapes regex punctuation and matches skill fields case insensitively', () => {
  assert.equal(escapeMySkillSearchRegex('a+b(c'), 'a\\+b\\(c')
  assert.equal(mySkillMatchesSearch({ name: 'Use a+b(c literally' }, 'A+B(C'), true)
  assert.equal(mySkillMatchesSearch({ name: 'Use aaabc literally' }, 'a+b(c'), false)
  assert.equal(mySkillMatchesSearch({ description: 'Create a PHOTO' }, 'photo'), true)
  assert.equal(mySkillMatchesSearch({ id: 'frame-maker' }, 'FRAME'), true)
  assert.equal(mySkillMatchesSearch({ skillId: 'frame-maker' }, 'maker'), true)
  assert.equal(mySkillMatchesSearch({ keywords: 'portrait, studio' }, 'STUDIO'), true)
  assert.equal(mySkillMatchesSearch({ triggers: ['snap', 'render'] }, 'RENDER'), true)
  assert.equal(mySkillMatchesSearch({ name: 'Other' }, 'studio'), false)
  const filter = mySkillSearchMongoQuery('a+b(c')
  assert.deepEqual(filter.$or.map(row => Object.keys(row)[0]), ['name', 'description', 'skillId', 'keywords', 'triggers'])
  assert.deepEqual(filter.$or[0].name, { $regex: 'a\\+b\\(c', $options: 'i' })
})

test('slice clamps to last page and steps back after the last card is removed', () => {
  assert.deepEqual(mySkillPageSlice(1, 24, 49), { page: 1, limit: 24, total: 49, skip: 0 })
  assert.deepEqual(mySkillPageSlice(9, 24, 49), { page: 3, limit: 24, total: 49, skip: 48 })
  assert.deepEqual(mySkillPageSlice(9, 24, 0), { page: 1, limit: 24, total: 0, skip: 0 })
  assert.equal(mySkillPageAfterRemoval(3, 0), 2)
  assert.equal(mySkillPageAfterRemoval(3, 1), 3)
  assert.equal(mySkillPageAfterRemoval(1, 0), 1)
})
