/**
 * Karakeep API client
 * Handles all communication with Karakeep API
 */

import wretch from 'wretch'
import type { KarakeepPaginatedBookmarks } from '../types'

/**
 * Karakeep API client class
 */
class KarakeepAPI {
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

    return wretch(this.baseUrl)
      .auth(`Bearer ${this.token}`)
      .accept('application/json')
      .get(endpoint)
      .json<KarakeepPaginatedBookmarks>()
  }

  /**
   * Fetch all bookmarks with automatic pagination handling
   */
  async fetchAllBookmarks(options?: {
    archived?: boolean
    favourited?: boolean
    limit?: number
  }): Promise<KarakeepPaginatedBookmarks['bookmarks']> {
    let allBookmarks: KarakeepPaginatedBookmarks['bookmarks'] = []
    let cursor: string | undefined

    do {
      const response = await this.getAllBookmarks({
        ...options,
        limit: 100,
        cursor,
      })

      allBookmarks = [...allBookmarks, ...response.bookmarks]
      cursor = response.nextCursor || undefined

      // Stop if we hit the limit
      if (options?.limit && allBookmarks.length >= options.limit) {
        break
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
