/**
 * Settings schema and accessors
 * Follows logseq-db-plugin-api-skill pattern
 */

import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin.user'
import { PluginSettings, DEFAULT_SETTINGS } from './types'

/**
 * Register plugin settings schema
 */
export function registerSettings(): void {
  try {
    const settings: SettingSchemaDesc[] = [
      {
        key: 'karakeepInstanceUrl',
        type: 'string',
        title: 'Karakeep Instance URL',
        description: 'Your self-hosted Karakeep instance URL (leave empty for official)',
        default: DEFAULT_SETTINGS.karakeepInstanceUrl,
      },
      {
        key: 'karakeepApiToken',
        type: 'string',
        title: 'API Token',
        description: 'Your Karakeep API token (from Settings → API Tokens)',
        default: DEFAULT_SETTINGS.karakeepApiToken,
      },
      {
        key: 'includeArchived',
        type: 'boolean',
        title: 'Include Archived',
        description: 'Sync archived bookmarks from Karakeep',
        default: DEFAULT_SETTINGS.includeArchived,
      },
      {
        key: 'includeFavourited',
        type: 'boolean',
        title: 'Only Favourited',
        description: 'Only sync favourited bookmarks',
        default: DEFAULT_SETTINGS.includeFavourited,
      },
      {
        key: 'usePageReferences',
        type: 'boolean',
        title: 'Use Page References',
        description: 'Create [[Title]] instead of [Title](URL)',
        default: DEFAULT_SETTINGS.usePageReferences,
      },
      {
        key: 'syncedIds',
        type: 'string',
        title: 'Synced IDs',
        description: 'Internal: IDs of already synced bookmarks',
        default: '',
        inputAs: 'textarea',
      },
      {
        key: 'autoSyncEnabled',
        type: 'boolean',
        title: 'Auto Sync',
        description: 'Automatically sync bookmarks at regular intervals',
        default: DEFAULT_SETTINGS.autoSyncEnabled,
      },
      {
        key: 'autoSyncInterval',
        type: 'number',
        title: 'Auto Sync Interval (minutes)',
        description: 'How often to auto-sync (minimum 1 minute)',
        default: DEFAULT_SETTINGS.autoSyncInterval,
      },
    ]

    logseq.useSettingsSchema(settings)
  } catch (error) {
    console.error('[Karakeep] Error registering settings:', error)
  }
}

/**
 * Get typed settings with defaults
 * Provides type safety and fallback values
 */
export function getSettings(): PluginSettings {
  try {
    if (logseq.settings) {
      // Parse syncedIds from JSON string if stored as string, or use default
      let syncedIds: string[] = []
      if (logseq.settings?.syncedIds) {
        try {
          if (typeof logseq.settings.syncedIds === 'string') {
            syncedIds = JSON.parse(logseq.settings.syncedIds)
          } else if (Array.isArray(logseq.settings.syncedIds)) {
            syncedIds = logseq.settings.syncedIds
          }
        } catch (e) {
          syncedIds = []
        }
      }

      const s = logseq.settings
      return {
        karakeepInstanceUrl:
          (typeof s.karakeepInstanceUrl === 'string' ? s.karakeepInstanceUrl : undefined) ??
          DEFAULT_SETTINGS.karakeepInstanceUrl,
        karakeepApiToken:
          (typeof s.karakeepApiToken === 'string' ? s.karakeepApiToken : undefined) ??
          DEFAULT_SETTINGS.karakeepApiToken,
        includeArchived:
          (typeof s.includeArchived === 'boolean' ? s.includeArchived : undefined) ??
          DEFAULT_SETTINGS.includeArchived,
        includeFavourited:
          (typeof s.includeFavourited === 'boolean' ? s.includeFavourited : undefined) ??
          DEFAULT_SETTINGS.includeFavourited,
        usePageReferences:
          (typeof s.usePageReferences === 'boolean' ? s.usePageReferences : undefined) ??
          DEFAULT_SETTINGS.usePageReferences,
        syncedIds: syncedIds,
        autoSyncEnabled:
          (typeof s.autoSyncEnabled === 'boolean' ? s.autoSyncEnabled : undefined) ??
          DEFAULT_SETTINGS.autoSyncEnabled,
        autoSyncInterval:
          (typeof s.autoSyncInterval === 'number' ? s.autoSyncInterval : undefined) ??
          DEFAULT_SETTINGS.autoSyncInterval,
      }
    }
    return DEFAULT_SETTINGS
  } catch (error) {
    console.error('[Karakeep] Error loading settings:', error)
    return DEFAULT_SETTINGS
  }
}

/**
 * Save synced IDs to settings
 */
export async function saveSyncedIds(ids: string[]): Promise<void> {
  try {
    await logseq.updateSettings({
      syncedIds: JSON.stringify(ids),
    })
  } catch (error) {
    console.error('[Karakeep] Error saving synced IDs:', error)
  }
}
