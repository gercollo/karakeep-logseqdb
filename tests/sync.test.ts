import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookmarkUUID, insertBookmarks } from '../src/sync'
import { getSettings } from '../src/settings'
import { bookmark, testGraph, TAG_UUID, URL_IDENT, DATE_IDENT } from './graph'

test('backfills complete records without per-block property reads or writes', async () => {
  const graph = testGraph()
  graph.addExisting('one')
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.deepEqual(result, {
    inserted: 0,
    repaired: 0,
    skipped: 1,
    failed: 0,
    processed: 1,
    total: 1,
  })
  assert.equal(graph.counts.queries, 2)
  assert.equal(graph.counts.inserts + graph.counts.tags + graph.counts.urls + graph.counts.dates, 0)
  assert.deepEqual(graph.savedIds(), ['one'])
})

test('stale syncedIds do not suppress an import into an empty or different graph', async () => {
  const graph = testGraph({ syncedIds: ['one'] })
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(result.inserted, 1)
  assert.equal(graph.blockCount(), 1)
})

for (const failure of ['tag', 'url', 'date', 'journal'] as const) {
  test(`retry resumes the original block after a ${failure} failure, including after plugin reload`, async () => {
    const graph = testGraph({ failure })
    const blocks = [bookmark('one')]
    const first = await insertBookmarks(blocks, getSettings())
    assert.equal(first.failed, 1)
    assert.equal(first.inserted, 0)
    assert.deepEqual(graph.savedIds(), [])
    assert.equal(graph.blockCount(), 1)
    const result = await insertBookmarks(blocks, getSettings())
    assert.equal(result.repaired, 1)
    assert.equal(result.failed, 0)
    assert.equal(graph.counts.inserts, 1)
    assert.equal(graph.blockCount(), 1)
    assert.deepEqual(graph.savedIds(), ['one'])
  })
}

test('deduplicates both repeated IDs and different IDs with the same URL in one response', async () => {
  const graph = testGraph()
  const result = await insertBookmarks(
    [bookmark('one'), bookmark('one'), bookmark('two', 'https://example.test/one')],
    getSettings()
  )
  assert.equal(result.inserted, 1)
  assert.equal(result.skipped, 2)
  assert.equal(graph.blockCount(), 1)
  assert.deepEqual(graph.savedIds(), ['one', 'two'])
})

test('repairs an untagged old Markdown import in place without touching notes', async () => {
  const graph = testGraph()
  const uuid = graph.addExisting('one', { tagged: false, url: false, date: false })
  const eid = graph.query('[:find ?b . :in $ ?uuid :where [?b :block/uuid ?uuid]]', uuid)
  graph.transact([
    { ':db/id': eid, ':user.property/personal-note': 'Keep this note' },
    { ':db/id': 7000, ':block/parent': eid, ':block/title': 'User child note' },
  ])
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(result.repaired, 1)
  assert.equal(graph.counts.inserts, 0)
  assert.equal(
    graph.query('[:find ?v . :in $ ?b :where [?b :user.property/personal-note ?v]]', eid),
    'Keep this note'
  )
  assert.equal(
    graph.query('[:find ?v . :in $ ?b :where [?c :block/parent ?b] [?c :block/title ?v]]', eid),
    'User child note'
  )
})

test('legacy URL properties on page-reference bookmarks are resolved in the bulk projection', async () => {
  const graph = testGraph()
  graph.addExisting('one', { title: '[[Old title]]', url: false, legacyUrl: true })
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(result.repaired, 1)
  assert.equal(graph.counts.inserts, 0)
  assert.equal(graph.counts.urls, 1)
})

test('stops before inserting when the dedupe query fails', async () => {
  const graph = testGraph()
  graph.mock.DB.datascriptQuery = async () => {
    throw new Error('DB unavailable')
  }
  await assert.rejects(insertBookmarks([bookmark('one')], getSettings()), /DB unavailable/)
  assert.equal(graph.counts.inserts, 0)
})

test('does not report a null block-creation result as a successful import', async () => {
  const graph = testGraph({ failure: 'insert-null' })
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(result.failed, 1)
  assert.deepEqual(graph.savedIds(), [])
})

test('a checkpoint failure is visible and restarting cannot duplicate completed nodes', async () => {
  const graph = testGraph({ failure: 'checkpoint' })
  await assert.rejects(insertBookmarks([bookmark('one')], getSettings()), /checkpoint failure/)
  assert.equal(graph.blockCount(), 1)
  const result = await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(result.skipped, 1)
  assert.equal(graph.counts.inserts, 1)
  assert.deepEqual(graph.savedIds(), ['one'])
})

test('aborts remaining writes when the active graph changes during insertion', async () => {
  let changed = false
  const graph = testGraph({
    afterTag: () => {
      changed = true
    },
  })
  await assert.rejects(
    insertBookmarks([bookmark('one'), bookmark('two')], getSettings(), {
      assertActive: () => {
        if (changed) throw new Error('Graph changed')
      },
    }),
    /Graph changed/
  )
  assert.equal(graph.counts.inserts, 1)
  assert.equal(graph.counts.urls + graph.counts.dates + graph.counts.checkpoints, 0)
})

test('stable UUID separates instances and target pages, but ignores trailing URL slashes', async () => {
  const first = await bookmarkUUID(TAG_UUID, 'https://karakeep.test', 'one')
  assert.match(first, /^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  assert.equal(first, await bookmarkUUID(TAG_UUID, 'https://karakeep.test/', 'one'))
  assert.notEqual(first, await bookmarkUUID(TAG_UUID, 'https://other.test', 'one'))
  assert.notEqual(first, await bookmarkUUID('different-page', 'https://karakeep.test', 'one'))
})

test('same-day imports reuse one journal lookup without per-batch settings writes', async () => {
  const graph = testGraph()
  graph.addJournal('Jul 3rd, 2026')
  const blocks = Array.from({ length: 100 }, (_, i) => bookmark(String(i)))
  let progressUpdates = 0
  const result = await insertBookmarks(blocks, getSettings(), {
    onProgress: async () => {
      progressUpdates++
    },
  })
  assert.equal(result.inserted, 100)
  assert.equal(graph.counts.journalReads, 1)
  assert.equal(graph.counts.journalCreates, 0)
  assert.equal(graph.counts.checkpoints, 1)
  assert.equal(graph.counts.propertyReads, 2)
  assert.equal(graph.counts.propertyCreates, 0)
  assert.ok(progressUpdates <= 4)
})

test('different notes with the same source URL remain separate, including on retry', async () => {
  const graph = testGraph()
  const one = {
    ...bookmark('one', 'https://example.test/source'),
    content: 'First note from https://example.test/source',
    dedupeByUrl: false,
  }
  const two = {
    ...bookmark('two', 'https://example.test/source'),
    content: 'Second note from https://example.test/source',
    dedupeByUrl: false,
  }
  const result = await insertBookmarks([one, two], getSettings())
  assert.equal(result.inserted, 2)
  const retry = await insertBookmarks([one, two], getSettings())
  assert.equal(retry.skipped, 2)
  assert.equal(graph.blockCount(), 2)
})

test('4,816 completed bookmarks require two queries and zero per-bookmark RPCs', async () => {
  const blocks = Array.from({ length: 4816 }, (_, i) => bookmark(String(i)))
  const graph = testGraph({ syncedIds: blocks.map((block) => block.bookmarkId!) })
  for (const block of blocks) graph.addExisting(block.bookmarkId!)
  const result = await insertBookmarks(blocks, getSettings())
  assert.equal(result.skipped, 4816)
  assert.deepEqual(graph.counts, {
    queries: 2,
    propertyReads: 2,
    propertyCreates: 0,
    inserts: 0,
    tags: 0,
    urls: 0,
    dates: 0,
    journalReads: 0,
    journalCreates: 0,
    checkpoints: 0,
  })
})

test('complete imports store the actual journal reference and managed URL entity', async () => {
  const graph = testGraph()
  const journal = graph.addJournal('Jul 3rd, 2026')
  await insertBookmarks([bookmark('one')], getSettings())
  assert.equal(graph.query(`[:find ?date . :where [?b ${DATE_IDENT} ?date]]`), journal)
  assert.equal(
    graph.query(`[:find ?url . :where [?b ${URL_IDENT} ?v] [?v :block/title ?url]]`),
    'https://example.test/one'
  )
})
