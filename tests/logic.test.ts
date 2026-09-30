import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBookmarkBlocks } from '../src/logic'
import { getSettings } from '../src/settings'
import type { KarakeepBookmark } from '../src/types'
import { testGraph } from './graph'

function raw(id: string, extras: Partial<KarakeepBookmark> = {}): KarakeepBookmark {
  return {
    id,
    title: `Bookmark ${id}`,
    createdAt: '2026-07-03T12:00:00Z',
    archived: false,
    favourited: false,
    content: { type: 'link', url: `https://example.test/${id}` },
    ...extras,
  } as KarakeepBookmark
}

test('uses the graph preferred date format instead of a hardcoded journal title', async () => {
  const graph = testGraph()
  graph.mock.App.getUserConfigs = async () => ({ preferredDateFormat: 'yyyy-MM-dd' })
  const blocks = await buildBookmarkBlocks([raw('one'), raw('two')], getSettings())
  assert.deepEqual(
    blocks.map((block) => block.dateString),
    ['2026-07-03', '2026-07-03']
  )
})

test('invalid creation dates fail before any block insertion', async () => {
  const graph = testGraph()
  await assert.rejects(
    buildBookmarkBlocks([raw('one', { createdAt: 'invalid' })], getSettings()),
    /Invalid creation date/
  )
  assert.equal(graph.counts.inserts, 0)
})

test('applies archive/favourite filters without changing bookmark identity or content mode', async () => {
  testGraph()
  const blocks = await buildBookmarkBlocks(
    [
      raw('one'),
      raw('two', { favourited: true }),
      raw('three', { favourited: true, archived: true }),
    ],
    { ...getSettings(), includeFavourited: true }
  )
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].bookmarkId, 'two')
  assert.equal(blocks[0].content, '[[Bookmark two]]')
})

test('malformed synced ID settings do not break an import or require resetting login', () => {
  const graph = testGraph()
  for (const value of ['null', '{}', 'not-json']) {
    graph.settings.syncedIds = value
    assert.deepEqual(getSettings().syncedIds, [])
    assert.equal(getSettings().karakeepApiToken, 'test-token')
  }
  graph.settings.syncedIds = '["one",null,123,"two"]'
  assert.deepEqual(getSettings().syncedIds, ['one', 'two'])
})
