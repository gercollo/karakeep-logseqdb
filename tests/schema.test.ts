import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensureManagedPropertyIdents, initializeBookmarksTag } from '../src/schema'
import { testGraph } from './graph'

test('schema lookup reuses existing properties without rewriting their definitions', async () => {
  const graph = testGraph()
  const props = await ensureManagedPropertyIdents()
  assert.equal(props.urlWriteKey, 'bookmark_url')
  assert.equal(props.dateWriteKey, 'bookmark_date')
  assert.equal(graph.counts.propertyReads, 2)
  assert.equal(graph.counts.propertyCreates, 0)
})

test('an incompatible property type fails instead of silently changing existing data', async () => {
  const graph = testGraph()
  graph.mock.Editor.getProperty = async (name) => ({
    name,
    ident: ':plugin.property.example/wrong',
    type: 'string',
    uuid: '00000000-0000-4000-8000-000000000001',
  })
  await assert.rejects(ensureManagedPropertyIdents(), /must be a url property/)
  assert.equal(graph.counts.propertyCreates, 0)
})

test('property setup errors propagate instead of starting an import with unresolved fields', async () => {
  const graph = testGraph()
  graph.mock.Editor.getProperty = async () => null as never
  await assert.rejects(ensureManagedPropertyIdents(), /Existing schema must be reused/)
  assert.equal(graph.counts.propertyCreates, 1)
})

test('schema initialization also stops after a graph change', async () => {
  const graph = testGraph()
  let changed = false
  const getTag = graph.mock.Editor.getTag
  graph.mock.Editor.getTag = async () => {
    changed = true
    return getTag()
  }
  await assert.rejects(
    initializeBookmarksTag({
      tagName: 'Bookmarks',
      assertActive: () => {
        if (changed) throw new Error('Graph changed during setup')
      },
    }),
    /Graph changed during setup/
  )
  assert.equal(graph.counts.propertyReads + graph.counts.propertyCreates, 0)
})

test('an existing class schema is reused without any property attachment writes', async () => {
  const graph = testGraph()
  const getTag = graph.mock.Editor.getTag
  const getProperty = graph.mock.Editor.getProperty
  graph.mock.Editor.getTag = async () => ({
    ...(await getTag()),
    ':logseq.property.class/properties': [84990, 84991, 72],
  })
  graph.mock.Editor.getProperty = async (name) => ({
    ...(await getProperty(name)),
    id: name === 'bookmark_url' ? 84991 : 84990,
  })
  Object.assign(graph.mock.Editor, {
    addTagProperty: async () => {
      throw new Error('Existing schema must not be rewritten')
    },
  })
  await initializeBookmarksTag()
  assert.equal(graph.counts.propertyReads, 2)
  assert.equal(graph.counts.propertyCreates, 0)
})

test('only a missing class property is attached using its qualified ident', async () => {
  const graph = testGraph()
  const getTag = graph.mock.Editor.getTag
  const getProperty = graph.mock.Editor.getProperty
  graph.mock.Editor.getTag = async () => ({
    ...(await getTag()),
    ':logseq.property.class/properties': [84990, 72],
  })
  graph.mock.Editor.getProperty = async (name) => ({
    ...(await getProperty(name)),
    id: name === 'bookmark_url' ? 84991 : 84990,
  })
  const attached: unknown[][] = []
  Object.assign(graph.mock.Editor, {
    addTagProperty: async (...args: unknown[]) => {
      attached.push(args)
    },
  })
  await initializeBookmarksTag()
  assert.deepEqual(attached, [[(await getTag()).uuid, (await getProperty('bookmark_url')).ident]])
  assert.equal(graph.counts.propertyCreates, 0)
})
