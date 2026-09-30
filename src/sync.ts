import { ensureManagedPropertyIdents, initializeBookmarksTag } from './schema'
import { saveSyncedIds } from './settings'
import { PLUGIN_ID, type BookmarkBlock, type PluginSettings } from './types'

export interface SyncResult {
  inserted: number
  repaired: number
  skipped: number
  failed: number
  processed: number
  total: number
}

interface ExistingBookmark {
  uuid: string
  tagged: boolean
  url: string | null
  managedUrl: string | null
  dateId: number | null
}

type Entity = Record<string, unknown>

function entity(value: unknown): Entity {
  return value && typeof value === 'object' ? (value as Entity) : {}
}

function propertyText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  const record = entity(value)
  const text = record.title ?? record.value ?? record.content
  return typeof text === 'string' ? text.trim() || null : null
}

function contentUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.trim()
  const match = title.match(/\]\((https?:\/\/.*)\)$/)
  return match?.[1] || (title.startsWith('https://') || title.startsWith('http://') ? title : null)
}

function queryIdent(ident: string): string {
  // Property metadata is inserted into EDN; names and user input are bound separately.
  if (!/^:[\w.-]+\/[\w.-]+$/.test(ident)) throw new Error('Invalid managed property ident')
  return ident
}

/** A persistent identity without adding another managed property to the graph. */
export async function bookmarkUUID(
  pageUuid: string,
  instanceUrl: string,
  bookmarkId: string
): Promise<string> {
  const name = JSON.stringify([PLUGIN_ID, pageUuid, instanceUrl.replace(/\/+$/, ''), bookmarkId])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name))
  const bytes = new Uint8Array(digest).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80 // UUIDv8, application-defined identity
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Read a small projection once, including unfinished blocks under the bookmark page.
 * A failed read aborts the import rather than silently disabling deduplication.
 */
async function readBookmarkIndex(tagId: number, urlIdent: string, dateIdent: string) {
  const legacyRows: unknown = await logseq.DB.datascriptQuery(
    '[:find ?ident :where [?p :db/ident ?ident] [?p :block/title "url"]]'
  )
  if (!Array.isArray(legacyRows)) throw new Error('Could not read bookmark property metadata')
  const legacyIdents = legacyRows
    .map((row) => (Array.isArray(row) ? row[0] : null))
    .filter(
      (ident): ident is string => typeof ident === 'string' && ident.startsWith(':user.property/')
    )
  const urlIdents = [...new Set([urlIdent, ...legacyIdents])]
  const projection = urlIdents.map((ident) => `{${queryIdent(ident)} [:block/title]}`).join(' ')
  const rows: unknown = await logseq.DB.datascriptQuery(
    `[:find (pull ?b [:block/uuid :block/title {:block/tags [:db/id]}
                      ${projection} {${queryIdent(dateIdent)} [:db/id]}])
      :in $ ?tag
      :where (or [?b :block/tags ?tag] [?b :block/parent ?tag])]`,
    tagId
  )
  if (!Array.isArray(rows)) throw new Error('Could not read existing bookmarks')
  const byUuid = new Map<string, ExistingBookmark>()
  const byUrl = new Map<string, ExistingBookmark>()
  const byContent = new Map<string, ExistingBookmark>()
  for (const row of rows) {
    const block = entity(Array.isArray(row) ? row[0] : null)
    if (typeof block.uuid !== 'string') throw new Error('Invalid bookmark query result')
    const tags = Array.isArray(block.tags) ? block.tags : []
    const managedUrl = propertyText(block[urlIdent])
    const url =
      urlIdents.map((ident) => propertyText(block[ident])).find(Boolean) || contentUrl(block.title)
    const dateId = entity(block[dateIdent]).id
    const record: ExistingBookmark = {
      uuid: block.uuid,
      tagged: tags.some((tag) => entity(tag).id === tagId),
      url: url || null,
      managedUrl,
      dateId: typeof dateId === 'number' ? dateId : null,
    }
    byUuid.set(record.uuid, record)
    if (record.url && typeof block.title === 'string') {
      byContent.set(JSON.stringify([record.url, block.title]), record)
    }
    if (record.url) {
      const previous = byUrl.get(record.url)
      // Prefer a complete tagged record; never delete or merge other nodes here.
      const score = (value: ExistingBookmark) =>
        Number(value.tagged) + Number(!!value.managedUrl) + Number(!!value.dateId)
      if (!previous || score(record) > score(previous)) byUrl.set(record.url, record)
    }
  }
  return { byUuid, byUrl, byContent }
}

export async function insertBookmarks(
  blocks: BookmarkBlock[],
  settings: PluginSettings,
  options: {
    assertActive?: () => void
    onProgress?: (result: SyncResult) => Promise<void>
  } = {}
): Promise<SyncResult> {
  const assertActive = options.assertActive || (() => {})
  const result: SyncResult = {
    inserted: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
    processed: 0,
    total: blocks.length,
  }
  assertActive()
  if (!blocks.length) return result

  let tag = await logseq.Editor.getTag(settings.bookmarkTagName)
  assertActive()
  if (!tag) {
    await initializeBookmarksTag({ tagName: settings.bookmarkTagName, assertActive })
    tag = await logseq.Editor.getTag(settings.bookmarkTagName)
    assertActive()
  }
  if (!tag?.id || !tag.uuid) throw new Error('Could not resolve the Bookmarks tag')
  const managed = await ensureManagedPropertyIdents({ assertActive })
  assertActive()
  const index = await readBookmarkIndex(tag.id, managed.url, managed.date)
  assertActive()

  const syncedIds = new Set(settings.syncedIds)
  let checkpointSize = syncedIds.size
  const completedIds = new Set<string>()
  const journals = new Map<string, number>()
  let lastProgressTime = 0
  let lastCheckpointTime = Date.now()
  let lastYieldTime = Date.now()
  const write = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertActive()
    const value = await operation()
    assertActive()
    return value
  }
  const checkpoint = async () => {
    assertActive()
    if (syncedIds.size !== checkpointSize) {
      await saveSyncedIds([...syncedIds])
      assertActive()
      checkpointSize = syncedIds.size
    }
  }

  for (const block of blocks) {
    assertActive()
    const id = block.bookmarkId
    try {
      if (!id) throw new Error('Bookmark is missing its Karakeep ID')
      if (completedIds.has(id)) {
        result.skipped++
      } else {
        const url = typeof block.properties.url === 'string' ? block.properties.url.trim() : null
        // Two different notes/assets may share a source URL; they are not link duplicates.
        const urlDedupe = block.dedupeByUrl !== false
        let record = url
          ? urlDedupe
            ? index.byUrl.get(url)
            : index.byContent.get(JSON.stringify([url, block.content]))
          : undefined
        let created = false
        if (!record) {
          const uuid = await bookmarkUUID(tag.uuid, settings.karakeepInstanceUrl, id)
          assertActive()
          record = index.byUuid.get(uuid)
          if (!record) {
            // insertBlock appends at the end without appendBlockInPage's full-child scan.
            const newBlock = await write(() =>
              logseq.Editor.insertBlock(tag.uuid, block.content, {
                sibling: false,
                end: true,
                customUUID: uuid,
              })
            )
            if (!newBlock?.uuid) throw new Error('Logseq did not return the created bookmark')
            record = { uuid: newBlock.uuid, tagged: false, url, managedUrl: null, dateId: null }
            index.byUuid.set(record.uuid, record)
            if (url) {
              if (urlDedupe) index.byUrl.set(url, record)
              index.byContent.set(JSON.stringify([url, block.content]), record)
            }
            created = true
          }
        }
        const complete =
          record.tagged && (!url || !!record.managedUrl) && (!block.dateString || !!record.dateId)
        if (complete) {
          result.skipped++
        } else {
          // These writes remain separate and sequential to respect Logseq DB semantics.
          if (!record.tagged) {
            await write(() => logseq.Editor.addBlockTag(record!.uuid, tag!.uuid))
            record.tagged = true
          }
          if (url && !record.managedUrl) {
            await write(() =>
              logseq.Editor.upsertBlockProperty(record!.uuid, managed.urlWriteKey, url)
            )
            record.managedUrl = url
          }
          if (block.dateString && !record.dateId) {
            const dateString = block.dateString
            let journalId = journals.get(dateString)
            if (!journalId) {
              let journal = await logseq.Editor.getPage(dateString)
              assertActive()
              if (!journal) {
                await write(() =>
                  logseq.Editor.createPage(dateString, {}, { journal: true, redirect: false })
                )
                journal = await logseq.Editor.getPage(dateString)
                assertActive()
              }
              if (!journal?.id) throw new Error(`Could not resolve journal ${dateString}`)
              journalId = journal.id
              journals.set(dateString, journalId)
            }
            const value = journalId
            await write(() =>
              logseq.Editor.upsertBlockProperty(record!.uuid, managed.dateWriteKey, value)
            )
            record.dateId = value
          }
          if (created) result.inserted++
          else result.repaired++
        }
        // syncedIds is a checkpoint/hint, not evidence that this graph has the node.
        syncedIds.add(id)
        completedIds.add(id)
      }
    } catch (error) {
      assertActive() // Graph changes must abort, rather than count as individual failures.
      result.failed++
      console.error('[Karakeep] Bookmark import failed:', id, error)
    }
    result.processed++
    if (result.processed % 25 === 0 || result.processed === blocks.length) {
      const now = Date.now()
      if (now - lastCheckpointTime >= 5000 || result.processed === blocks.length) {
        await checkpoint()
        lastCheckpointTime = Date.now()
      }
      if (
        options.onProgress &&
        (now - lastProgressTime >= 500 || result.processed === blocks.length)
      ) {
        await options.onProgress({ ...result })
        lastProgressTime = now
      }
      if (result.processed < blocks.length && Date.now() - lastYieldTime >= 16) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        lastYieldTime = Date.now()
      }
    }
  }
  return result
}
