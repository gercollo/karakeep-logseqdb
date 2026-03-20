/**
 * Logseq Karakeep Plugin
 * Main entry point
 *
 * Based on learnings from RCmerci/skills:
 * - Properties added to tag schema have :db/ident values like :user.property/date-xyz
 * - Must use the FULL :db/ident when setting property values with upsertBlockProperty
 * - Date properties are reference types to journal page entities
 */

import '@logseq/libs'

import { registerSettings, getSettings, saveSyncedIds } from './settings'
import { initializeSchema, ensureBookmarksPage, ensureManagedPropertyIdents } from './schema'
import { createAPIClient } from './api/karakeep'
import { buildBookmarkBlocks } from './logic'
import type { BookmarkBlock } from './types'
import { URL_PROPERTY, DATE_PROPERTY, DEFAULT_SETTINGS } from './types'

// ============================================================
// Auto Sync State
// ============================================================

let autoSyncTimer: ReturnType<typeof setInterval> | null = null
let lastAutoSyncTime: Date | null = null
let syncInProgress = false // Prevent concurrent syncs

async function migrateManagedPropertySettings(): Promise<void> {
  const current = (logseq.settings || {}) as Record<string, unknown>
  const next: Record<string, string> = {}

  if (
    current.urlPropertyName === 'url' ||
    current.urlPropertyName === 'karakeep_url' ||
    current.urlPropertyName === 'karakeep_url_clean' ||
    current.urlPropertyName === 'test124_url'
  ) {
    next.urlPropertyName = DEFAULT_SETTINGS.urlPropertyName
  }

  if (
    current.datePropertyName === 'date' ||
    current.datePropertyName === 'karakeep_date' ||
    current.datePropertyName === 'karakeep_date_clean' ||
    current.datePropertyName === 'test124_date'
  ) {
    next.datePropertyName = DEFAULT_SETTINGS.datePropertyName
  }

  if (Object.keys(next).length > 0) {
    await logseq.updateSettings(next)
    console.log('[Karakeep] Migrated property settings:', next)
  }
}

function getLegacyPropertyKey(
  props: Record<string, any> | null | undefined,
  propertyName: string
): string | null {
  if (!props) return null
  for (const key of Object.keys(props)) {
    if (key.startsWith(':user.property/')) {
      const tail = key.split('/').pop() || ''
      if (tail.toLowerCase().startsWith(propertyName.toLowerCase())) {
        return key
      }
    }
  }
  return null
}

async function getBookmarksPageBlocks(pageName: string): Promise<any[]> {
  const blocks = await logseq.DB.datascriptQuery(
    `[:find (pull ?b [*])
      :where
      [?b :block/tags ?t]
      [?t :block/name "${pageName.toLowerCase()}"]]`
  )
  return Array.isArray(blocks) ? blocks.map((row: any) => row?.[0]).filter(Boolean) : []
}

async function migrateBookmarkBlock(
  blockUuid: string,
  managedKeys: { url: string; date: string; urlWriteKey: string; dateWriteKey: string }
): Promise<{ migratedUrl: boolean; migratedDate: boolean }> {
  const props = await logseq.Editor.getBlockProperties(blockUuid)
  const legacyUrlKey = getLegacyPropertyKey(props, 'url')
  const legacyDateKey = getLegacyPropertyKey(props, 'date')
  const migratedUrl = !!(await logseq.Editor.getBlockProperty(blockUuid, managedKeys.urlWriteKey))
  const migratedDate = !!(await logseq.Editor.getBlockProperty(blockUuid, managedKeys.dateWriteKey))

  if (legacyUrlKey && !migratedUrl) {
    const legacyUrl = await logseq.Editor.getBlockProperty(blockUuid, legacyUrlKey)
    const urlValue =
      legacyUrl && typeof legacyUrl === 'object'
        ? (legacyUrl as any).value || (legacyUrl as any).title || (legacyUrl as any).content
        : null
    if (urlValue) {
      await logseq.Editor.upsertBlockProperty(blockUuid, managedKeys.urlWriteKey, urlValue)
    }
  }

  if (legacyDateKey && !migratedDate) {
    const legacyDate = await logseq.Editor.getBlockProperty(blockUuid, legacyDateKey)
    const dateEntityId =
      legacyDate && typeof legacyDate === 'object' ? (legacyDate as any).id : null
    if (typeof dateEntityId === 'number') {
      await logseq.Editor.upsertBlockProperty(blockUuid, managedKeys.dateWriteKey, dateEntityId)
    }
  }

  const updatedProps = await logseq.Editor.getBlockProperties(blockUuid)
  return {
    migratedUrl:
      !!updatedProps?.[managedKeys.url] ||
      !!(await logseq.Editor.getBlockProperty(blockUuid, managedKeys.urlWriteKey)),
    migratedDate:
      !!updatedProps?.[managedKeys.date] ||
      !!(await logseq.Editor.getBlockProperty(blockUuid, managedKeys.dateWriteKey)),
  }
}

async function migrateCurrentBookmark(): Promise<void> {
  const currentBlock = await logseq.Editor.getCurrentBlock()
  if (!currentBlock?.uuid) {
    await logseq.UI.showMsg('No current block selected', 'warning')
    return
  }

  const settings = getSettings()
  const managedKeys = await ensureManagedPropertyIdents({
    urlPropertyName: settings.urlPropertyName,
    datePropertyName: settings.datePropertyName,
    urlPropertyIdentOverride: settings.urlPropertyIdentOverride,
    datePropertyIdentOverride: settings.datePropertyIdentOverride,
  })
  const result = await migrateBookmarkBlock(currentBlock.uuid, managedKeys)
  await logseq.UI.showMsg(
    `Migrated current bookmark: url=${result.migratedUrl ? 'yes' : 'no'}, date=${result.migratedDate ? 'yes' : 'no'}`,
    'success'
  )
}

async function migrateLegacyBookmarks(limit: number): Promise<void> {
  const settings = getSettings()
  const blocks = await getBookmarksPageBlocks(settings.bookmarkTagName)
  const managedKeys = await ensureManagedPropertyIdents({
    urlPropertyName: settings.urlPropertyName,
    datePropertyName: settings.datePropertyName,
    urlPropertyIdentOverride: settings.urlPropertyIdentOverride,
    datePropertyIdentOverride: settings.datePropertyIdentOverride,
  })

  const candidates = blocks
    .filter((block) => getLegacyPropertyKey(block, 'url') || getLegacyPropertyKey(block, 'date'))
    .filter((block) => !block[managedKeys.url] || !block[managedKeys.date])
    .slice(0, limit)

  let migrated = 0
  for (const block of candidates) {
    const result = await migrateBookmarkBlock(block.uuid, managedKeys)
    if (result.migratedUrl || result.migratedDate) {
      migrated += 1
    }
  }

  await logseq.UI.showMsg(`Migrated ${migrated} legacy bookmarks`, 'success')
}

async function removeBlockPropertyIfPresent(blockUuid: string, key: string): Promise<boolean> {
  try {
    const props = await logseq.Editor.getBlockProperties(blockUuid)
    if (!props || !(key in props)) {
      return false
    }
    await logseq.Editor.removeBlockProperty(blockUuid, key)
    return true
  } catch (error) {
    console.error(`[Karakeep] Failed removing property ${key} from ${blockUuid}:`, error)
    return false
  }
}

async function cleanupInvalidBookmarkProperties(): Promise<void> {
  const settings = getSettings()
  const blocks = await getBookmarksPageBlocks(settings.bookmarkTagName)
  const badBlockKeys = [
    ':plugin.property.logseq-karakeep-plugin/date',
    ':plugin.property.logseq-karakeep-plugin/karakeep_date',
    ':plugin.property.logseq-karakeep-plugin/url',
    ':plugin.property._test_plugin/date',
    ':plugin.property._test_plugin/url',
  ]
  let cleanedBlocks = 0
  let removedValues = 0

  for (const block of blocks) {
    let cleanedThisBlock = false
    for (const key of badBlockKeys) {
      const removed = await removeBlockPropertyIfPresent(block.uuid, key)
      if (removed) {
        removedValues += 1
        cleanedThisBlock = true
      }
    }
    if (cleanedThisBlock) {
      cleanedBlocks += 1
    }
  }

  for (const propertyName of ['url', 'date', 'karakeep_url', 'karakeep_date']) {
    try {
      await logseq.Editor.removeProperty(propertyName)
    } catch (error) {
      console.log(`[Karakeep] Property ${propertyName} not removed:`, error)
    }
  }

  await logseq.UI.showMsg(
    `Cleaned ${removedValues} invalid properties across ${cleanedBlocks} bookmarks`,
    'success'
  )
}

/**
 * Perform auto-sync (background sync without block context)
 * Silent operation, only shows UI on errors
 */
async function performAutoSync(): Promise<void> {
  // Prevent concurrent syncs
  if (syncInProgress) {
    console.log('[Karakeep] Auto-sync skipped: Sync already in progress')
    return
  }

  const settings = getSettings()

  // Validate API token
  if (!settings.karakeepApiToken) {
    console.log('[Karakeep] Auto-sync skipped: No API token configured')
    return
  }

  const api = createAPIClient()
  if (!api) {
    console.error('[Karakeep] Auto-sync failed: Could not create API client')
    return
  }

  try {
    syncInProgress = true
    console.log('[Karakeep] Auto-sync started...')

    // Fetch from API
    const bookmarks = await api.fetchAllBookmarks({
      archived: settings.includeArchived,
      favourited: settings.includeFavourited,
    })

    if (bookmarks.length === 0) {
      console.log('[Karakeep] Auto-sync: No bookmarks found')
      return
    }

    console.log('[Karakeep] Processing', bookmarks.length, 'bookmarks')

    // Build blocks
    const blocks = await buildBookmarkBlocks(bookmarks, settings)

    // Insert with tags and properties
    await insertBookmarksWithTags(blocks, '')

    lastAutoSyncTime = new Date()
    console.log('[Karakeep] Auto-sync completed at', lastAutoSyncTime.toISOString())
  } catch (error) {
    console.error('[Karakeep] Auto-sync error:', error)
    await logseq.UI.showMsg(`Auto-sync failed: ${(error as Error).message}`, 'error')
  } finally {
    syncInProgress = false
    console.log('[Karakeep] Sync lock released')
  }
}

/**
 * Start auto-sync timer
 */
function startAutoSync(intervalMinutes: number): void {
  // Clear existing timer if any
  stopAutoSync()

  // Ensure minimum 1 minute interval
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000

  console.log(`[Karakeep] Starting auto-sync: every ${intervalMinutes} minutes (${intervalMs}ms)`)

  // Set up recurring sync that reschedules after each completion
  const scheduleNext = () => {
    autoSyncTimer = setTimeout(() => {
      console.log('[Karakeep] Triggering scheduled auto-sync...')
      performAutoSync().finally(() => {
        // Only schedule next if timer hasn't been cleared
        if (autoSyncTimer) {
          scheduleNext()
        }
      })
    }, intervalMs)
  }

  // Start the recurring schedule
  console.log(
    `[Karakeep] First auto-sync will run in ${Math.max(intervalMinutes, 1)} minute(s). Use slash command for immediate first sync.`
  )
  scheduleNext()
}

/**
 * Stop auto-sync timer
 */
function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer)
    autoSyncTimer = null
    console.log('[Karakeep] Auto-sync stopped')
  }
}

/**
 * Update auto-sync based on current settings
 */
function updateAutoSync(): void {
  const settings = getSettings()

  if (settings.autoSyncEnabled) {
    startAutoSync(settings.autoSyncInterval)
  } else {
    stopAutoSync()
  }
}

/**
 * Insert bookmarks with proper tagging and properties
 * Processes in batches to avoid overwhelming the UI
 *
 * @param blocks - The bookmark blocks to insert
 * @param _blockUuid - UUID of the block where command was invoked (unused)
 */
async function insertBookmarksWithTags(blocks: BookmarkBlock[], _blockUuid: string): Promise<void> {
  const msgKey = await logseq.UI.showMsg(`Inserting ${blocks.length} bookmarks...`)

  try {
    const settings = getSettings()
    const tagName = settings.bookmarkTagName || DEFAULT_SETTINGS.bookmarkTagName
    const pageName = tagName
    console.log('[Karakeep] ===== INSERTING BOOKMARKS =====')
    console.log('[Karakeep] Number of blocks:', blocks.length)

    // Ensure Bookmarks page exists
    await ensureBookmarksPage(pageName)

    // Always use the configured bookmarks page
    let page = await logseq.Editor.getPage(pageName)

    if (!page) {
      console.log(`[Karakeep] Creating ${pageName} page...`)
      await logseq.Editor.createPage(pageName)
      page = await logseq.Editor.getPage(pageName)
    }

    if (!page) {
      throw new Error(`Failed to get or create ${pageName} page`)
    }

    console.log('[Karakeep] Bookmarks page:', page.uuid)
    console.log('[Karakeep] Bookmarks page ID:', page.id)

    // Get or create the bookmarks tag for organization
    let tag = await logseq.Editor.getTag(tagName)
    if (!tag) {
      console.log(`[Karakeep] Creating #${tagName} tag...`)
      await logseq.Editor.createTag(tagName)
      tag = await logseq.Editor.getTag(tagName)
    }

    if (!tag) {
      console.warn(`[Karakeep] Could not create #${tagName} tag, continuing without tagging`)
      await logseq.UI.closeMsg(msgKey)
      await logseq.UI.showMsg(`Could not create #${tagName} tag`, 'error')
      return
    }

    console.log('[Karakeep] Tag:', `${tag.uuid} (ID: ${tag.id})`)

    const managedKeys = await ensureManagedPropertyIdents({
      urlPropertyName: settings.urlPropertyName || URL_PROPERTY,
      datePropertyName: settings.datePropertyName || DATE_PROPERTY,
      urlPropertyIdentOverride: settings.urlPropertyIdentOverride,
      datePropertyIdentOverride: settings.datePropertyIdentOverride,
    })

    console.log('[Karakeep] Discovered property idents:', {
      date: managedKeys.date,
      url: managedKeys.url,
    })

    console.log('[Karakeep] Tag UUID:', tag.uuid)
    console.log('[Karakeep] Tag ID:', tag.id)

    const insertedUuids: string[] = []
    const skippedDuplicates: string[] = []
    let failedInserts = 0

    // Fast deduplication using syncedIds from settings (O(1) Set lookup)
    let syncedIds = new Set(settings.syncedIds || [])
    console.log('[Karakeep] Existing synced IDs:', syncedIds.size)

    // Fallback: If syncedIds is empty, perform one-time URL query to backfill
    // This handles existing bookmarks from before bookmarkId tracking
    if (syncedIds.size === 0) {
      console.log('[Karakeep] No synced IDs found, performing one-time backfill...')
      try {
        const existingBlocks = await getBookmarksPageBlocks(pageName)
        const existingUrls = new Set<string>()
        for (const existingBlock of existingBlocks) {
          const props = await logseq.Editor.getBlockProperties(existingBlock.uuid)
          const pluginUrl =
            (await logseq.Editor.getBlockProperty(existingBlock.uuid, managedKeys.urlWriteKey)) ||
            props?.[managedKeys.url]
          const legacyUrlKey = getLegacyPropertyKey(props, 'url')
          const legacyUrl =
            legacyUrlKey && (await logseq.Editor.getBlockProperty(existingBlock.uuid, legacyUrlKey))

          const urlValue =
            pluginUrl ||
            (legacyUrl && typeof legacyUrl === 'object'
              ? (legacyUrl as any).value || (legacyUrl as any).title || (legacyUrl as any).content
              : null) ||
            null

          if (typeof urlValue === 'string' && urlValue.trim()) {
            existingUrls.add(urlValue.trim())
          }
        }

        console.log('[Karakeep] Backfill: Found', existingUrls.size, 'existing bookmarks by URL')

        // Build URL -> bookmarkId mapping from incoming blocks
        const urlToBookmarkId = new Map<string, string>()
        for (const block of blocks) {
          const url = block.properties.url
          if (url) {
            urlToBookmarkId.set(url.trim(), (block as any).bookmarkId)
          }
        }

        // Populate syncedIds from existing URLs
        for (const url of existingUrls) {
          const bookmarkId = urlToBookmarkId.get((url as string).trim())
          if (bookmarkId) {
            syncedIds.add(bookmarkId)
          }
        }

        console.log('[Karakeep] Backfill: Populated syncedIds with', syncedIds.size, 'IDs')
      } catch (err) {
        console.warn('[Karakeep] Backfill query failed, continuing without backfill:', err)
      }
    }

    // Filter out duplicates using bookmarkId (O(n) instead of O(n*m))
    const blocksToInsert = blocks.filter((block: any) => {
      const bookmarkId = block.bookmarkId

      if (!bookmarkId) {
        console.log('[Karakeep] Skipping block without bookmarkId:', block.content)
        return false
      }

      if (syncedIds.has(bookmarkId)) {
        console.log('[Karakeep] Skipping already synced bookmark:', bookmarkId)
        skippedDuplicates.push(bookmarkId)
        return false
      }

      return true
    })

    console.log('[Karakeep] Blocks to insert:', blocksToInsert.length)
    console.log('[Karakeep] Duplicates to skip:', skippedDuplicates.length)

    // Track new bookmark IDs for settings update
    const newSyncedIds = new Set(syncedIds)

    // Process in batches to avoid overwhelming the UI
    const BATCH_SIZE = 100 // Increased for faster syncing
    const totalBatches = Math.ceil(blocksToInsert.length / BATCH_SIZE)

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const startIdx = batchNum * BATCH_SIZE
      const endIdx = Math.min(startIdx + BATCH_SIZE, blocksToInsert.length)
      const batch = blocksToInsert.slice(startIdx, endIdx)

      console.log(
        `[Karakeep] Processing batch ${batchNum + 1}/${totalBatches} (${batch.length} blocks)`
      )

      // Update progress (only every 10 batches to reduce UI updates)
      if (batchNum % 10 === 0 || batchNum === totalBatches - 1) {
        await logseq.UI.showMsg(
          `Inserting bookmarks... ${Math.round((endIdx / blocksToInsert.length) * 100)}% (${insertedUuids.length} inserted, ${skippedDuplicates.length} skipped)`,
          'info'
        )
      }

      for (const block of batch) {
        try {
          const url = block.properties.url
          const dateString = (block as any).dateString

          // Build properties object for batch setting
          const blockProperties: Record<string, any> = {}
          if (url) {
            blockProperties[managedKeys.urlWriteKey] = url
          }
          if (dateString) {
            let journalPage = await logseq.Editor.getPage(dateString)
            if (!journalPage) {
              await logseq.Editor.createPage(dateString, {}, { journal: true })
              journalPage = await logseq.Editor.getPage(dateString)
            }
            if (journalPage?.id) {
              blockProperties[managedKeys.dateWriteKey] = journalPage.id
            }
          }

          const newBlock = await logseq.Editor.appendBlockInPage(page.uuid, block.content, {
            properties: blockProperties,
          })

          if (!newBlock) {
            console.warn('[Karakeep] Failed to create block for:', block.content)
            continue
          }

          if (tag) {
            try {
              await logseq.Editor.addBlockTag(newBlock.uuid, tag.uuid)
            } catch (err) {
              console.error('[Karakeep] Error tagging block:', err)
            }
          }

          // Track bookmark ID for settings
          if ((block as any).bookmarkId) {
            newSyncedIds.add((block as any).bookmarkId)
          }

          insertedUuids.push(newBlock.uuid)
        } catch (blockError) {
          failedInserts += 1
          console.error('[Karakeep] Error processing block:', blockError)
          // Continue with next block
        }
      }

      // Small delay between batches to let Logseq process
      if (batchNum < totalBatches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50)) // 50ms between batches
      }
    }

    await logseq.UI.closeMsg(msgKey)

    // Save updated synced IDs to settings
    if (insertedUuids.length > 0) {
      await saveSyncedIds(Array.from(newSyncedIds))
      console.log('[Karakeep] Saved synced IDs:', newSyncedIds.size)
    } else {
      console.log('[Karakeep] No successful inserts, synced IDs unchanged')
    }

    // Show appropriate message based on results
    if (failedInserts > 0) {
      await logseq.UI.showMsg(
        `Inserted ${insertedUuids.length} bookmarks, skipped ${skippedDuplicates.length} duplicates, failed ${failedInserts}`,
        'warning'
      )
    } else if (skippedDuplicates.length > 0) {
      await logseq.UI.showMsg(
        `Inserted ${insertedUuids.length} bookmarks, skipped ${skippedDuplicates.length} duplicates`,
        'success'
      )
    } else {
      await logseq.UI.showMsg(`Inserted ${insertedUuids.length} bookmarks`, 'success')
    }

    // Debug: Check first block properties
    if (insertedUuids.length > 0) {
      const firstBlockData = await logseq.DB.datascriptQuery(
        `[:find (pull ?b [*]) :where [?b :block/uuid "${insertedUuids[0]}"]]`
      )
      if (firstBlockData.length > 0) {
        console.log('[Karakeep] First block entity:', firstBlockData[0]['?b'])
      }
    }
  } catch (error) {
    await logseq.UI.closeMsg(msgKey)
    console.error('[Karakeep] Error inserting bookmarks:', error)
    await logseq.UI.showMsg(`Error: ${(error as Error).message}`, 'error')
  }
}

/**
 * Retrieve and insert bookmarks
 * Main workflow function
 * @param blockUuid - UUID of the block where command was invoked
 */
async function retrieveAndInsert(blockUuid: string): Promise<void> {
  // Prevent concurrent syncs (shared with auto-sync)
  if (syncInProgress) {
    await logseq.UI.showMsg('Sync already in progress, please wait', 'warning')
    return
  }

  const settings = getSettings()

  // Validate API token
  if (!settings.karakeepApiToken) {
    await logseq.UI.showMsg('Please configure API token in settings', 'error')
    return
  }

  const api = createAPIClient()
  if (!api) {
    await logseq.UI.showMsg('Failed to create API client', 'error')
    return
  }

  try {
    syncInProgress = true
    console.log('[Karakeep] Manual sync started...')

    const msgKey = await logseq.UI.showMsg('Fetching bookmarks from Karakeep...')

    // Fetch from API
    const bookmarks = await api.fetchAllBookmarks({
      archived: settings.includeArchived,
      favourited: settings.includeFavourited,
    })

    await logseq.UI.closeMsg(msgKey)

    if (bookmarks.length === 0) {
      await logseq.UI.showMsg('No bookmarks found', 'success')
      syncInProgress = false
      return
    }

    // Show progress
    await logseq.UI.showMsg(`Processing ${bookmarks.length} bookmarks...`, 'success')

    // Build blocks
    const blocks = await buildBookmarkBlocks(bookmarks, settings)

    // Insert with tags and properties
    await insertBookmarksWithTags(blocks, blockUuid)

    console.log('[Karakeep] Manual sync completed')
  } catch (error) {
    console.error('[Karakeep] Error retrieving bookmarks:', error)
    await logseq.UI.showMsg(`Error: ${(error as Error).message}`, 'error')
  } finally {
    syncInProgress = false
    console.log('[Karakeep] Sync lock released')
  }
}

/**
 * Main plugin initialization
 */
async function main() {
  console.log('[Karakeep] ==================================================')
  console.log('[Karakeep] PLUGIN LOADING STARTED')
  console.log('[Karakeep] ==================================================')

  try {
    console.log('[Karakeep] Step 1: Registering settings...')
    // 1. Register settings
    registerSettings()
    await migrateManagedPropertySettings()
    console.log('[Karakeep] ✓ Settings registered')

    console.log('[Karakeep] Step 2: Initializing schema...')
    const settings = getSettings()
    // 2. Initialize schema (properties and tag)
    await initializeSchema({
      tagName: settings.bookmarkTagName,
      urlPropertyName: settings.urlPropertyName,
      datePropertyName: settings.datePropertyName,
      urlPropertyIdentOverride: settings.urlPropertyIdentOverride,
      datePropertyIdentOverride: settings.datePropertyIdentOverride,
    })
    await ensureBookmarksPage(settings.bookmarkTagName)
    console.log('[Karakeep] ✓ Schema initialized')

    console.log('[Karakeep] Step 3: Registering slash commands...')
    // 3. Register slash commands
    logseq.Editor.registerSlashCommand('Karakeep: Retrieve Bookmarks', async (e) => {
      await retrieveAndInsert(e.uuid)
    })
    logseq.Editor.registerSlashCommand('Karakeep: Migrate Current Bookmark', async () => {
      await migrateCurrentBookmark()
    })
    logseq.Editor.registerSlashCommand('Karakeep: Migrate 3 Bookmarks', async () => {
      await migrateLegacyBookmarks(3)
    })
    logseq.Editor.registerSlashCommand('Karakeep: Migrate 10 Bookmarks', async () => {
      await migrateLegacyBookmarks(10)
    })
    logseq.Editor.registerSlashCommand(
      'Karakeep: Cleanup Invalid Bookmark Properties',
      async () => {
        await cleanupInvalidBookmarkProperties()
      }
    )
    logseq.App.registerCommandPalette(
      {
        key: 'karakeep-migrate-current-bookmark',
        label: 'Karakeep: Migrate Current Bookmark',
      },
      async () => {
        await migrateCurrentBookmark()
      }
    )
    logseq.App.registerCommandPalette(
      {
        key: 'karakeep-migrate-3-bookmarks',
        label: 'Karakeep: Migrate 3 Bookmarks',
      },
      async () => {
        await migrateLegacyBookmarks(3)
      }
    )
    logseq.App.registerCommandPalette(
      {
        key: 'karakeep-migrate-10-bookmarks',
        label: 'Karakeep: Migrate 10 Bookmarks',
      },
      async () => {
        await migrateLegacyBookmarks(10)
      }
    )
    logseq.App.registerCommandPalette(
      {
        key: 'karakeep-cleanup-invalid-bookmark-properties',
        label: 'Karakeep: Cleanup Invalid Bookmark Properties',
      },
      async () => {
        await cleanupInvalidBookmarkProperties()
      }
    )

    console.log('[Karakeep] ✓ Slash commands registered')

    console.log('[Karakeep] Step 4: Setting up auto-sync...')
    // 4. Set up auto-sync if enabled
    updateAutoSync()

    // Listen for settings changes to update auto-sync
    logseq.onSettingsChanged((newSettings) => {
      console.log('[Karakeep] Settings changed, updating auto-sync...')
      const wasEnabled = getSettings().autoSyncEnabled
      const isNowEnabled = newSettings.autoSyncEnabled ?? false
      const interval = newSettings.autoSyncInterval ?? 60

      if (wasEnabled !== isNowEnabled || getSettings().autoSyncInterval !== interval) {
        updateAutoSync()
      }
    })

    console.log('[Karakeep] ✓ Auto-sync configured')
    console.log('[Karakeep] ==================================================')
    console.log('[Karakeep] PLUGIN LOADED SUCCESSFULLY')
    console.log('[Karakeep] ==================================================')
  } catch (error) {
    console.error('[Karakeep] Initialization error:', error)
    await logseq.UI.showMsg('Plugin initialization failed', 'error')
  }

  // Cleanup when plugin is unloaded
  // Use try-catch since beforeUnload may not be available in all Logseq versions
  try {
    // @ts-ignore - beforeUnload may not be in all versions of @logseq/libs
    if (typeof logseq.beforeUnload === 'function') {
      // @ts-ignore
      logseq.beforeUnload(() => {
        console.log('[Karakeep] Plugin unloading, stopping auto-sync...')
        stopAutoSync()
      })
      console.log('[Karakeep] Registered cleanup handler')
    } else {
      console.log('[Karakeep] beforeUnload not available, cleanup will happen on reload')
    }
  } catch (e) {
    console.log('[Karakeep] Could not register beforeUnload:', e)
  }
}

logseq.ready(main).catch(console.error)
