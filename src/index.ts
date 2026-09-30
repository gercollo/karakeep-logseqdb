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

import { registerSettings, getSettings } from './settings'
import { initializeSchema } from './schema'
import { createAPIClient, bookmarkFilters } from './api/karakeep'
import { buildBookmarkBlocks } from './logic'
import type { BookmarkBlock } from './types'
import type { PluginSettings } from './types'
import { insertBookmarks, type SyncResult } from './sync'
import { AutoSyncScheduler } from './scheduler'

// ============================================================
// Auto Sync State
// ============================================================

let syncInProgress = false
let graphEpoch = 0
let unloaded = false
const autoSync = new AutoSyncScheduler(() => retrieveAndInsert('', true))

function updateAutoSync(): void {
  const settings = getSettings()
  if (settings.autoSyncEnabled) autoSync.start(settings.autoSyncInterval)
  else autoSync.stop()
}

function summary(result: SyncResult): string {
  return `Inserted ${result.inserted} bookmarks, repaired ${result.repaired}, skipped ${result.skipped} duplicates${result.failed ? `, failed ${result.failed}` : ''}`
}

async function insertBookmarksWithTags(
  blocks: BookmarkBlock[],
  settings: PluginSettings,
  assertActive: () => void,
  silent: boolean
): Promise<SyncResult> {
  const msgKey = silent ? null : await logseq.UI.showMsg(`Processing ${blocks.length} bookmarks...`)
  try {
    return await insertBookmarks(blocks, settings, {
      assertActive,
      onProgress: silent
        ? undefined
        : async (result) => {
            assertActive()
            await logseq.UI.showMsg(
              `Processing bookmarks... ${Math.round((result.processed / result.total) * 100)}% (${result.inserted} inserted, ${result.repaired} repaired, ${result.skipped} skipped)`,
              'info',
              { key: msgKey! }
            )
          },
    })
  } finally {
    if (msgKey !== null) logseq.UI.closeMsg(msgKey)
  }
}

/** Manual and scheduled syncs share one lock and one settings snapshot. */
async function retrieveAndInsert(_blockUuid: string, silent = false): Promise<void> {
  if (unloaded) return
  if (syncInProgress) {
    if (!silent) await logseq.UI.showMsg('Sync already in progress, please wait', 'warning')
    return
  }
  const settings = getSettings()
  if (!settings.karakeepApiToken) {
    if (!silent) await logseq.UI.showMsg('Please configure API token in settings', 'error')
    return
  }
  const api = createAPIClient()
  if (!api) {
    if (!silent) await logseq.UI.showMsg('Failed to create API client', 'error')
    return
  }
  const epoch = graphEpoch
  const assertActive = () => {
    if (unloaded || epoch !== graphEpoch)
      throw new Error('Sync stopped because the active graph changed or the plugin unloaded')
  }
  syncInProgress = true
  let fetchingMessage: Awaited<ReturnType<typeof logseq.UI.showMsg>> | null = null
  try {
    if (!silent) fetchingMessage = await logseq.UI.showMsg('Fetching bookmarks from Karakeep...')
    const bookmarks = await api.fetchAllBookmarks(bookmarkFilters(settings), assertActive)
    assertActive()
    if (fetchingMessage !== null) {
      logseq.UI.closeMsg(fetchingMessage)
      fetchingMessage = null
    }
    if (!bookmarks.length) {
      if (!silent) await logseq.UI.showMsg('No bookmarks found', 'success')
      return
    }
    const blocks = await buildBookmarkBlocks(bookmarks, settings)
    assertActive()
    const result = await insertBookmarksWithTags(blocks, settings, assertActive, silent)
    assertActive()
    if (!silent || result.failed) {
      await logseq.UI.showMsg(summary(result), result.failed ? 'warning' : 'success')
    }
    console.log('[Karakeep] Sync completed:', summary(result))
  } catch (error) {
    console.error('[Karakeep] Sync failed:', error)
    if (!unloaded) await logseq.UI.showMsg(`Sync failed: ${(error as Error).message}`, 'error')
  } finally {
    if (fetchingMessage !== null) logseq.UI.closeMsg(fetchingMessage)
    syncInProgress = false
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
    // Register graph changes before any asynchronous work.
    logseq.App.onCurrentGraphChanged(() => {
      graphEpoch++
    })
    // 1. Register settings
    registerSettings()
    console.log('[Karakeep] ✓ Settings registered')

    console.log('[Karakeep] Step 2: Initializing schema...')
    const settings = getSettings()
    const epoch = graphEpoch
    // 2. Initialize schema (properties and tag)
    await initializeSchema({
      tagName: settings.bookmarkTagName,
      assertActive: () => {
        if (unloaded || epoch !== graphEpoch)
          throw new Error('Graph changed during schema initialization')
      },
    })
    console.log('[Karakeep] ✓ Schema initialized')

    console.log('[Karakeep] Step 3: Registering slash commands...')
    // 3. Register slash commands
    logseq.Editor.registerSlashCommand('Karakeep: Retrieve Bookmarks', async (e) => {
      await retrieveAndInsert(e.uuid)
    })
    logseq.App.registerCommandPalette(
      {
        key: 'karakeep-retrieve-bookmarks',
        label: 'Karakeep: Retrieve Bookmarks',
      },
      async () => {
        await retrieveAndInsert('')
      }
    )

    console.log('[Karakeep] ✓ Slash commands registered')

    console.log('[Karakeep] Step 4: Setting up auto-sync...')
    // 4. Set up auto-sync if enabled
    updateAutoSync()

    // Listen for settings changes to update auto-sync
    logseq.onSettingsChanged((next, previous) => {
      if (
        next.autoSyncEnabled !== previous.autoSyncEnabled ||
        next.autoSyncInterval !== previous.autoSyncInterval
      ) {
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

  logseq.beforeunload(async () => {
    unloaded = true
    graphEpoch++
    autoSync.stop()
  })
}

logseq.ready(main).catch(console.error)
