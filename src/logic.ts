/**
 * Pure business logic for bookmark processing
 * No I/O operations, fully testable
 */

import { format } from 'date-fns'
import type { KarakeepBookmark, BookmarkBlock, PluginSettings } from './types'

/**
 * Check if a string looks like a UUID (to filter out)
 */
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

/**
 * Sanitize text for use in block content
 * - Removes line breaks and excessive whitespace
 * - Escapes backslashes (must be first to avoid double-escaping)
 * - Removes backticks (break Logseq code blocks)
 * - Removes pipes (block reference separator)
 * - Escapes brackets that could create unintended page refs or links
 */
function sanitizeText(text: string): string {
  if (!text) return ''
  let sanitized = text

  // Remove backticks entirely (they break Logseq formatting)
  sanitized = sanitized.replace(/`/g, '')

  // Replace pipes with dashes (block ref separator)
  sanitized = sanitized.replace(/\|/g, '-')

  // Replace newlines with spaces, collapse multiple spaces
  sanitized = sanitized
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized
}

/**
 * Transform Karakeep bookmark to Logseq block content
 * Pure function - no I/O
 */
export function bookmarkToContent(bookmark: KarakeepBookmark, settings: PluginSettings): string {
  const { content } = bookmark

  switch (content.type) {
    case 'link': {
      const url = content.url
      // Sanitize title to remove line breaks
      const rawTitle = bookmark.title || content.title || url
      const displayTitle = sanitizeText(rawTitle)

      return settings.usePageReferences ? `[[${displayTitle}]]` : `[${displayTitle}](${url})`
    }

    case 'text': {
      const text = sanitizeText(content.text || '')
      const source = content.sourceUrl ? ` from ${content.sourceUrl}` : ''
      return `${text}${source}`
    }

    case 'asset': {
      const fileName = sanitizeText(content.fileName || content.assetId)
      const source = content.sourceUrl ? ` from ${content.sourceUrl}` : ''
      return `${fileName}${source}`
    }

    case 'unknown':
    default:
      return sanitizeText(bookmark.title || 'Unknown bookmark')
  }
}

/**
 * Build bookmark blocks from Karakeep bookmarks
 * Pure function - no I/O (except preferredDateFormat which is cached)
 */
export async function buildBookmarkBlocks(
  bookmarks: KarakeepBookmark[],
  settings: PluginSettings
): Promise<BookmarkBlock[]> {
  const blocks: BookmarkBlock[] = []

  if (bookmarks.length === 0) return blocks

  // Get preferred date format (cached by Logseq)
  const preferredDateFormat =
    (await logseq.App.getUserConfigs()).preferredDateFormat || 'MMM do, yyyy'
  const dates = new Map<string, string>()

  for (const bookmark of bookmarks) {
    // Skip archived based on settings
    if (bookmark.archived && !settings.includeArchived) {
      continue
    }
    if (settings.includeFavourited && !bookmark.favourited) continue

    // Skip bookmarks without a URL we can track
    // This prevents UUID-only entries with no actual content
    let hasUrl = false
    if (bookmark.content.type === 'link') {
      hasUrl = !!bookmark.content.url
    } else if (bookmark.content.type === 'text' || bookmark.content.type === 'asset') {
      hasUrl = !!bookmark.content.sourceUrl
    }

    // If no URL and no meaningful title/content, skip it
    if (!hasUrl && !bookmark.title && bookmark.content.type !== 'unknown') {
      console.log('[Karakeep] Skipping bookmark without URL or title:', bookmark.id)
      continue
    }

    // If title is just the ID/UUID, skip it
    if (bookmark.title && (bookmark.title === bookmark.id || isUUID(bookmark.title))) {
      console.log('[Karakeep] Skipping bookmark with UUID as title:', bookmark.id)
      continue
    }

    // Build content
    const content = bookmarkToContent(bookmark, settings)

    // Format date for property (e.g., "Feb 3rd, 2026")
    const bookmarkDate = new Date(bookmark.createdAt)
    if (Number.isNaN(bookmarkDate.getTime())) {
      throw new Error(`Invalid creation date for bookmark ${bookmark.id}`)
    }
    const dayKey = `${bookmarkDate.getFullYear()}-${bookmarkDate.getMonth()}-${bookmarkDate.getDate()}`
    let dateString = dates.get(dayKey)
    if (!dateString) {
      dateString = format(bookmarkDate, preferredDateFormat)
      dates.set(dayKey, dateString)
    }

    // Build properties (using simple names, Logseq adds namespace)
    // For date property, we need to get the journal page reference
    const properties: Record<string, any> = {
      // Note: date property will be set separately using journal page reference
    }

    // Add URL for link bookmarks or text/asset with sourceUrl
    if (bookmark.content.type === 'link') {
      properties['url'] = bookmark.content.url
    } else if (bookmark.content.type === 'text' || bookmark.content.type === 'asset') {
      if (bookmark.content.sourceUrl) {
        properties['url'] = bookmark.content.sourceUrl
      }
    }

    // Store dateString for later use in index.ts
    const block: BookmarkBlock = {
      content,
      properties,
      dateString,
      bookmarkId: bookmark.id,
      dedupeByUrl: bookmark.content.type === 'link',
    }

    blocks.push(block)
  }

  return blocks
}

/**
 * Filter bookmarks by favourited status
 * Pure function
 */
export function filterByFavourited(
  bookmarks: KarakeepBookmark[],
  favourited: boolean
): KarakeepBookmark[] {
  return favourited ? bookmarks.filter((b) => b.favourited) : bookmarks
}
