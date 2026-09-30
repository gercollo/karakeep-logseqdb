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
  content: string
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
  // Only validated property idents are interpolated into EDN.
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
  if (!Number.isSafeInteger(tagId) || tagId <= 0) throw new Error('Invalid Bookmarks tag entity ID')
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
  // @logseq/libs 0.2.9 drops the last extra query input. Use the validated
  // numeric entity ID directly so this read works through that SDK as well.
  const rows: unknown = await logseq.DB.datascriptQuery(
    `[:find (pull ?b [:block/uuid :block/title :block/order {:block/parent [:db/id]} {:block/tags [:db/id]}
                      ${projection} {${queryIdent(dateIdent)} [:db/id]}])
      :where (or [?b :block/tags ${tagId}] [?b :block/parent ${tagId}])]`
  )
  if (!Array.isArray(rows)) throw new Error('Could not read existing bookmarks')
  const byUuid = new Map<string, ExistingBookmark>()
  const byUrl = new Map<string, ExistingBookmark>()
  const byContent = new Map<string, ExistingBookmark>()
  let lastChild: { uuid: string; order: string } | undefined
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
      content: typeof block.title === 'string' ? block.title : '',
      tagged: tags.some((tag) => entity(tag).id === tagId),
      url: url || null,
      managedUrl,
      dateId: typeof dateId === 'number' ? dateId : null,
    }
    if (
      entity(block.parent).id === tagId &&
      typeof block.order === 'string' &&
      (!lastChild || block.order > lastChild.order)
    )
      lastChild = { uuid: record.uuid, order: block.order }
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
  return { byUuid, byUrl, byContent, lastChildUuid: lastChild?.uuid }
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
  let insertionAnchor = index.lastChildUuid
  const resolveJournal = async (dateString: string): Promise<number> => {
    const cached = journals.get(dateString)
    if (cached) return cached
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
    journals.set(dateString, journal.id)
    return journal.id
  }
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
        let newUuid: string | undefined
        if (!record) {
          const uuid = await bookmarkUUID(tag.uuid, settings.karakeepInstanceUrl, id)
          assertActive()
          record = index.byUuid.get(uuid)
          if (!record) newUuid = uuid
        }
        const complete =
          record?.tagged && (!url || !!record.managedUrl) && (!block.dateString || !!record.dateId)
        if (complete) {
          result.skipped++
        } else {
          // Resolve the date before creation so a journal failure cannot leave a bare link.
          const dateId =
            record?.dateId || (block.dateString ? await resolveJournal(block.dateString) : null)
          if (!record) {
            // The page-target API loads every child before inserting. Once a last
            // child exists, insert after that block and advance the anchor instead.
            const newBlock = await write(() =>
              logseq.Editor.insertBlock(insertionAnchor || tag!.uuid, block.content, {
                sibling: !!insertionAnchor,
                end: true,
                customUUID: newUuid!,
              })
            )
            if (!newBlock?.uuid) throw new Error('Logseq did not return the created bookmark')
            insertionAnchor = newBlock.uuid
            record = {
              uuid: newBlock.uuid,
              content: typeof newBlock.title === 'string' ? newBlock.title : block.content,
              tagged: false,
              url,
              managedUrl: null,
              dateId: null,
            }
            index.byUuid.set(record.uuid, record)
            if (url) {
              if (urlDedupe) index.byUrl.set(url, record)
              index.byContent.set(JSON.stringify([url, block.content]), record)
            }
          }
          const properties: Record<string, unknown> = {}
          if (!record.tagged) properties['block/tags'] = [tag!.id]
          if (url && !record.managedUrl) properties[managed.url.slice(1)] = url
          if (dateId && !record.dateId) properties[managed.date.slice(1)] = dateId
          // updateBlock's properties are one awaited set-block-properties transaction.
          // Keep the original title, so Logseq's unchanged-title save is a no-op.
          await write(() =>
            logseq.Editor.updateBlock(record!.uuid, record!.content, { properties })
          )
          record.tagged = true
          if (url && !record.managedUrl) record.managedUrl = url
          if (dateId && !record.dateId) record.dateId = dateId
          if (newUuid) result.inserted++
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
