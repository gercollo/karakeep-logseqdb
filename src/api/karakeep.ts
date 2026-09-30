/**
 * Karakeep API client
 * Handles all communication with Karakeep API
 */

import wretch from 'wretch'
import type { KarakeepPaginatedBookmarks, PluginSettings } from '../types'

export function bookmarkFilters(settings: PluginSettings): {
  archived?: boolean
  favourited?: boolean
} {
  return {
    archived: settings.includeArchived ? undefined : false,
    favourited: settings.includeFavourited ? true : undefined,
  }
}

/**
 * Karakeep API client class
 */
export class KarakeepAPI {
  private baseUrl: string
  private token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  /**
   * Get all bookmarks with pagination
   */
  async getAllBookmarks(options?: {
    archived?: boolean
    favourited?: boolean
    limit?: number
    cursor?: string
  }): Promise<KarakeepPaginatedBookmarks> {
    const params = new URLSearchParams()

    if (options?.archived !== undefined) {
      params.append('archived', String(options.archived))
    }
    if (options?.favourited !== undefined) {
      params.append('favourited', String(options.favourited))
    }
    if (options?.limit !== undefined) {
      params.append('limit', String(options.limit))
    }
    if (options?.cursor) {
      params.append('cursor', options.cursor)
    }

    const queryString = params.toString()
    const endpoint = `/api/v1/bookmarks${queryString ? `?${queryString}` : ''}`

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error('Karakeep request timed out')),
      30_000
    )
    try {
      return await wretch(this.baseUrl)
        .auth(`Bearer ${this.token}`)
        .accept('application/json')
        .options({ signal: controller.signal })
        .get(endpoint)
        .json<KarakeepPaginatedBookmarks>()
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Fetch all bookmarks with automatic pagination handling
   */
  async fetchAllBookmarks(
    options?: {
      archived?: boolean
      favourited?: boolean
      limit?: number
    },
    assertActive: () => void = () => {}
  ): Promise<KarakeepPaginatedBookmarks['bookmarks']> {
    const allBookmarks: KarakeepPaginatedBookmarks['bookmarks'] = []
    let cursor: string | undefined
    const seenCursors = new Set<string>()
    if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
      throw new Error('Bookmark limit must be a non-negative integer')
    }
    if (options?.limit === 0) return allBookmarks

    do {
      assertActive()
      const response = await this.getAllBookmarks({
        ...options,
        limit:
          options?.limit === undefined ? 100 : Math.min(100, options.limit - allBookmarks.length),
        cursor,
      })
      assertActive()

      if (!Array.isArray(response.bookmarks)) throw new Error('Invalid Karakeep bookmark response')
      if (response.nextCursor != null && typeof response.nextCursor !== 'string') {
        throw new Error('Invalid Karakeep pagination cursor')
      }
      const remaining =
        options?.limit === undefined
          ? response.bookmarks.length
          : options.limit - allBookmarks.length
      for (const bookmark of response.bookmarks.slice(0, remaining)) allBookmarks.push(bookmark)
      cursor = response.nextCursor || undefined

      // Stop if we hit the limit
      if (options?.limit !== undefined && allBookmarks.length >= options.limit) {
        break
      }
      if (cursor) {
        if (seenCursors.has(cursor))
          throw new Error('Karakeep returned a repeated pagination cursor')
        seenCursors.add(cursor)
      }
    } while (cursor)

    return allBookmarks
  }
}

/**
 * Create API client from current settings
 * Returns null if API token is not configured
 */
export function createAPIClient(): KarakeepAPI | null {
  const settings = (logseq.settings as any) || {}

  const token = settings.karakeepApiToken as string
  if (!token) {
    return null
  }

  const baseUrl = (settings.karakeepInstanceUrl as string) || 'https://try.karakeep.app'

  return new KarakeepAPI(baseUrl, token)
}
