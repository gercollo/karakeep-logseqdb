/**
 * Type definitions for Logseq Karakeep Plugin
 */

import { BlockEntity } from '@logseq/libs/dist/LSPlugin.user'

// ============================================================
// Karakeep API Types (from Python client)
// ============================================================

export interface KarakeepBookmark {
  id: string
  createdAt: string
  modifiedAt: string | null
  title: string | null
  archived: boolean
  favourited: boolean
  taggingStatus: 'success' | 'failure' | 'pending'
  summarizationStatus: 'success' | 'failure' | 'pending' | null
  note: string | null
  summary: string | null
  source: 'api' | 'web' | 'cli' | 'mobile' | 'extension' | 'singlefile' | 'rss' | 'import' | null
  userId: string
  tags: KarakeepTagShort[]
  content: KarakeepContent
  assets: KarakeepAsset[]
}

export interface KarakeepTagShort {
  id: string
  name: string
  attachedBy: 'ai' | 'human'
}

export type KarakeepContent =
  | KarakeepLinkContent
  | KarakeepTextContent
  | KarakeepAssetContent
  | KarakeepUnknownContent

export interface KarakeepLinkContent {
  type: 'link'
  url: string
  title: string | null
  description: string | null
  imageUrl: string | null
  imageAssetId: string | null
  screenshotAssetId: string | null
  pdfAssetId: string | null
  fullPageArchiveAssetId: string | null
  precrawledArchiveAssetId: string | null
  videoAssetId: string | null
  favicon: string | null
  htmlContent: string | null
  contentAssetId: string | null
  crawledAt: string | null
  crawlStatus: 'success' | 'failure' | 'pending' | null
  author: string | null
  publisher: string | null
  datePublished: string | null
  dateModified: string | null
}

export interface KarakeepTextContent {
  type: 'text'
  text: string
  sourceUrl: string | null
}

export interface KarakeepAssetContent {
  type: 'asset'
  assetType: 'image' | 'pdf'
  assetId: string
  fileName: string | null
  sourceUrl: string | null
  size: number | null
  content: string | null
}

export interface KarakeepUnknownContent {
  type: 'unknown'
}

export interface KarakeepAsset {
  id: string
  assetType:
    | 'linkHtmlContent'
    | 'screenshot'
    | 'pdf'
    | 'assetScreenshot'
    | 'bannerImage'
    | 'fullPageArchive'
    | 'video'
    | 'bookmarkAsset'
    | 'precrawledArchive'
    | 'userUploaded'
    | 'avatar'
    | 'unknown'
  fileName: string | null
}

export interface KarakeepPaginatedBookmarks {
  bookmarks: KarakeepBookmark[]
  nextCursor: string | null
}

// ============================================================
// Plugin Types
// ============================================================

export interface PluginSettings {
  karakeepInstanceUrl: string
  karakeepApiToken: string
  includeArchived: boolean
  includeFavourited: boolean
  usePageReferences: boolean
  bookmarkTagName: string
  syncedIds: string[] // Hidden: stores IDs of already synced bookmarks
  autoSyncEnabled: boolean // Enable automatic sync
  autoSyncInterval: number // Auto-sync interval in minutes
}

export const DEFAULT_SETTINGS: PluginSettings = {
  karakeepInstanceUrl: 'https://try.karakeep.app',
  karakeepApiToken: '',
  includeArchived: false,
  includeFavourited: false,
  usePageReferences: true,
  bookmarkTagName: 'Bookmarks',
  syncedIds: [],
  autoSyncEnabled: false,
  autoSyncInterval: 60, // Default: 60 minutes
}

// Property name constants (without namespace prefix)
export const URL_PROPERTY = 'bookmark_url'
export const DATE_PROPERTY = 'bookmark_date'
export const BOOKMARKS_TAG = DEFAULT_SETTINGS.bookmarkTagName
export const PLUGIN_ID = 'logseq-karakeep-plugin'

export function getPluginPropertyIdent(propertyName: string): string {
  return `:plugin.property.${PLUGIN_ID}/${propertyName}`
}

// Block structure for insertion
export interface BookmarkBlock {
  content: string
  properties: Record<string, any>
  bookmarkId?: string
  children?: BookmarkBlock[]
}

// Re-export Logseq types
export type { BlockEntity }
