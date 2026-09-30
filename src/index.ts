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
import { initializeBookmarksTag } from './schema'
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
    await initializeBookmarksTag({ tagName: settings.bookmarkTagName, assertActive })
    assertActive()
    const result = await insertBookmarksWithTags(blocks, settings, assertActive, silent)
    assertActive()
    if (!silent || result.failed) {
      await logseq.UI.showMsg(summary(result), result.failed ? 'warning' : 'success')
    }
    console.log('[Karakeep] Sync completed:', summary(result))
  } catch (error) {
    console.error('[Karakeep] Sync failed:', error)
    if (!unloaded) await logseq.UI.showMsg(`Sync failed: ${errorMessage(error)}`, 'error')
  } finally {
    if (fetchingMessage !== null) logseq.UI.closeMsg(fetchingMessage)
    syncInProgress = false
  }
}

/**
 * Main plugin initialization
 */
function getToolbarIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 1.1 512.1 509.8" aria-hidden="true" class="ti">
    <path fill="currentColor" d="M481.7 1.1H30.3C13.6 1.1 0 14.6 0 31.4v449.2c0 16.7 13.5 30.3 30.3 30.3h451.5c16.7 0 30.3-13.5 30.3-30.3V31.4c-.1-16.7-13.6-30.3-30.4-30.3M223.7 436c0 4.4-3.5 7.9-7.9 7.9H76.6c-4.4 0-7.9-3.5-7.9-7.9V74.4c0-4.4 3.5-7.9 7.9-7.9h137c4.4 0 7.9 3.5 7.9 7.9V212s-.8 59.2 2.2 105.7zm217.4 0c0 6.3-7 10-12.2 6.6l-63.5-41.5c-2.7-1.8-6.3-1.7-9 .2l-55.6 40.2c-2.3 1.7-5 1.8-7.4 1-2-1.4-3.4-3.8-3.4-6.5V155.2c7.5-1.4 15.9-2.3 25.6-2.3 47.5 0 125.4 26.9 125.4 102.6z"/>
  </svg>`
}

async function registerToolbarItem(): Promise<void> {
  logseq.provideModel({
    async onKarakeepToolbarClick() {
      await retrieveAndInsert('')
    },
  })

  logseq.provideStyle(`
    .karakeep-toolbar-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 1;
    }

    .karakeep-toolbar-button svg {
      display: block;
      width: 18px;
      height: 18px;
      min-width: 18px;
      min-height: 18px;
    }
  `)

  await logseq.App.registerUIItem('toolbar', {
    key: 'karakeep-sync',
    template: `
      <a
        class="button karakeep-toolbar-button"
        data-on-click="onKarakeepToolbarClick"
        title="Karakeep Sync"
        aria-label="Karakeep Sync"
      >
        ${getToolbarIconSvg()}
      </a>
    `,
  })
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'Unknown error; see the developer console'
}

async function main() {
  let stage = 'registering lifecycle hooks'
  try {
    // Cleanup must be installed even if a later startup step fails.
    logseq.beforeunload(async () => {
      unloaded = true
      graphEpoch++
      autoSync.stop()
    })
    logseq.App.onCurrentGraphChanged(() => {
      graphEpoch++
    })

    stage = 'registering settings'
    registerSettings()

    // Register the UI without graph reads or schema writes. Schema setup belongs
    // to a sync, when the graph is available and protected by its epoch guard.
    stage = 'registering commands'
    logseq.Editor.registerSlashCommand('Karakeep: Retrieve Bookmarks', async (e) => {
      await retrieveAndInsert(e.uuid)
    })
    await logseq.App.registerCommandPalette(
      {
        key: 'karakeep-retrieve-bookmarks',
        label: 'Karakeep: Retrieve Bookmarks',
      },
      async () => {
        await retrieveAndInsert('')
      }
    )
    if (unloaded) return
    stage = 'registering toolbar'
    await registerToolbarItem()

    if (unloaded) return
    stage = 'configuring auto-sync'
    updateAutoSync()
    logseq.onSettingsChanged((next, previous) => {
      if (
        next.autoSyncEnabled !== previous.autoSyncEnabled ||
        next.autoSyncInterval !== previous.autoSyncInterval
      ) {
        updateAutoSync()
      }
    })
    console.log('[Karakeep] Plugin loaded successfully')
  } catch (error) {
    autoSync.stop()
    if (unloaded) return
    const message = `Plugin initialization failed (${stage}): ${errorMessage(error)}`
    console.error('[Karakeep]', message, error)
    await logseq.UI.showMsg(message, 'error', { timeout: 20000 })
  }
}

logseq.ready(main).catch(console.error)
