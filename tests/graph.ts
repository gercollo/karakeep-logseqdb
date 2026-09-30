import { createRequire } from 'node:module'
import { DEFAULT_SETTINGS, getPluginPropertyIdent, type BookmarkBlock } from '../src/types'

const ds = createRequire(import.meta.url)('datascript')
export const URL_IDENT = getPluginPropertyIdent('bookmark_url')
export const DATE_IDENT = getPluginPropertyIdent('bookmark_date')
export const TAG_ID = 74499
export const TAG_UUID = '69886723-4c64-4b10-be3c-9c79867c7a5f'
const LEGACY_URL = ':user.property/url-legacy'

// The JS DataScript distribution stores string attributes; Logseq's ClojureScript
// DB uses keyword attributes. Keep the query structure intact for the real engine.
const queryForJS = (query: string) =>
  query.replace(/:[\w.-]+\/[\w.-]+/g, (attr) => (attr === ':db/id' ? attr : JSON.stringify(attr)))

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        /^:(block|db)\//.test(key) ? key.split('/')[1] : key,
        normalize(item),
      ])
    )
  }
  return value
}

export function bookmark(
  id: string,
  url = `https://example.test/${id}`,
  dateString = 'Jul 3rd, 2026'
): BookmarkBlock {
  return { bookmarkId: id, content: `[Bookmark ${id}](${url})`, properties: { url }, dateString }
}

export function testGraph(
  options: {
    syncedIds?: string[]
    failure?: 'tag' | 'url' | 'date' | 'journal' | 'checkpoint' | 'insert-null'
    afterTag?: () => void
  } = {}
) {
  let db = ds.empty_db({
    ':block/uuid': { ':db/unique': ':db.unique/identity' },
    ':block/tags': { ':db/valueType': ':db.type/ref', ':db/cardinality': ':db.cardinality/many' },
    ':block/parent': { ':db/valueType': ':db.type/ref' },
    [URL_IDENT]: { ':db/valueType': ':db.type/ref' },
    [DATE_IDENT]: { ':db/valueType': ':db.type/ref' },
    [LEGACY_URL]: { ':db/valueType': ':db.type/ref' },
  })
  let nextId = 100000
  const journals = new Map<string, number>()
  const counts = {
    queries: 0,
    propertyReads: 0,
    propertyCreates: 0,
    inserts: 0,
    tags: 0,
    urls: 0,
    dates: 0,
    journalReads: 0,
    journalCreates: 0,
    checkpoints: 0,
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    karakeepApiToken: 'test-token',
    karakeepInstanceUrl: 'https://karakeep.test',
    syncedIds: JSON.stringify(options.syncedIds || []),
  }
  let failed = false
  function transact(tx: unknown[]) {
    db = ds.db_with(db, tx)
  }
  function eid(uuid: string): number {
    const result = ds.q(
      queryForJS('[:find ?b . :in $ ?uuid :where [?b :block/uuid ?uuid]]'),
      db,
      uuid
    )
    if (!result) throw new Error('No such test block')
    return result
  }
  function fail(operation: typeof options.failure) {
    if (!failed && options.failure === operation) {
      failed = true
      throw new Error(`Simulated ${operation} failure`)
    }
  }
  transact([
    {
      ':db/id': TAG_ID,
      ':block/uuid': TAG_UUID,
      ':block/title': 'Bookmarks',
      ':block/name': 'bookmarks',
    },
    { ':db/id': 1, ':db/ident': LEGACY_URL, ':block/title': 'url' },
  ])
  function addJournal(name: string) {
    const id = nextId++
    journals.set(name, id)
    transact([{ ':db/id': id, ':block/title': name }])
    return id
  }
  function addExisting(
    id: string,
    options: {
      tagged?: boolean
      url?: boolean
      date?: boolean
      title?: string
      uuid?: string
      legacyUrl?: boolean
      parent?: number
    } = {}
  ) {
    const block = bookmark(id)
    const uuid = options.uuid || `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`
    const blockId = nextId++
    const valueId = nextId++
    const dateId = journals.get(block.dateString!) || addJournal(block.dateString!)
    transact([
      { ':db/id': valueId, ':block/title': block.properties.url },
      {
        ':db/id': blockId,
        ':block/uuid': uuid,
        ':block/title': options.title || block.content,
        ':block/parent': options.parent || TAG_ID,
        ...(options.tagged !== false ? { ':block/tags': TAG_ID } : {}),
        ...(options.url !== false ? { [URL_IDENT]: valueId } : {}),
        ...(options.date !== false ? { [DATE_IDENT]: dateId } : {}),
        ...(options.legacyUrl ? { [LEGACY_URL]: valueId } : {}),
      },
    ])
    return uuid
  }
  const mock = {
    settings,
    updateSettings: async (next: Record<string, unknown>) => {
      counts.checkpoints++
      fail('checkpoint')
      Object.assign(settings, next)
    },
    DB: {
      datascriptQuery: async (query: string, ...inputs: unknown[]) => {
        counts.queries++
        return normalize(ds.q(queryForJS(query), db, ...inputs))
      },
    },
    Editor: {
      getTag: async () => ({ id: TAG_ID, uuid: TAG_UUID }),
      createTag: async () => {
        throw new Error('Existing tag must be reused')
      },
      getProperty: async (name: string) => {
        counts.propertyReads++
        return {
          name,
          ident: getPluginPropertyIdent(name),
          type: name.endsWith('date') ? 'date' : 'url',
          uuid: '00000000-0000-4000-8000-000000000001',
        }
      },
      upsertProperty: async () => {
        counts.propertyCreates++
        throw new Error('Existing schema must be reused')
      },
      appendBlockInPage: async () => {
        throw new Error('Do not scan the entire bookmark page for every insert')
      },
      insertBlock: async (
        page: string,
        content: string,
        opts: { customUUID: string; end: boolean; sibling: boolean }
      ) => {
        counts.inserts++
        if (page !== TAG_UUID || !opts.end || opts.sibling)
          throw new Error('Incorrect insertion target')
        if (options.failure === 'insert-null' && !failed) {
          failed = true
          return null
        }
        const blockId = nextId++
        // Production insertBlock rejects a UUID that already exists.
        if (
          ds.q(
            queryForJS('[:find ?b . :in $ ?uuid :where [?b :block/uuid ?uuid]]'),
            db,
            opts.customUUID
          )
        )
          throw new Error('Duplicate UUID')
        transact([
          {
            ':db/id': blockId,
            ':block/uuid': opts.customUUID,
            ':block/title': content,
            ':block/parent': TAG_ID,
          },
        ])
        return { id: blockId, uuid: opts.customUUID }
      },
      addBlockTag: async (uuid: string, tagUuid: string) => {
        counts.tags++
        fail('tag')
        if (tagUuid !== TAG_UUID) throw new Error('Incorrect tag')
        transact([[':db/add', eid(uuid), ':block/tags', TAG_ID]])
        options.afterTag?.()
      },
      upsertBlockProperty: async (uuid: string, key: string, value: unknown) => {
        if (key === 'bookmark_url') {
          counts.urls++
          fail('url')
          const valueId = nextId++
          transact([
            { ':db/id': valueId, ':block/title': value },
            [':db/add', eid(uuid), URL_IDENT, valueId],
          ])
        } else if (key === 'bookmark_date') {
          counts.dates++
          fail('date')
          transact([[':db/add', eid(uuid), DATE_IDENT, value]])
        } else throw new Error(`Unexpected property ${key}`)
      },
      getPage: async (name: string) => {
        counts.journalReads++
        const id = journals.get(name)
        return id ? { id } : null
      },
      createPage: async (
        name: string,
        _props: unknown,
        opts: { journal: boolean; redirect: boolean }
      ) => {
        counts.journalCreates++
        fail('journal')
        if (!opts.journal || opts.redirect)
          throw new Error('Journal creation must not change navigation')
        addJournal(name)
      },
    },
    App: { getUserConfigs: async () => ({ preferredDateFormat: 'MMM do, yyyy' }) },
  }
  globalThis.logseq = mock as unknown as typeof logseq
  return {
    mock,
    counts,
    settings,
    addExisting,
    addJournal,
    transact,
    query: (query: string, ...inputs: unknown[]) => ds.q(queryForJS(query), db, ...inputs),
    blockCount: () => ds.q(queryForJS('[:find (count ?b) . :where [?b :block/parent 74499]]'), db),
    savedIds: () => JSON.parse(settings.syncedIds) as string[],
  }
}
