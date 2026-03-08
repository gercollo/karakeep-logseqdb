/**
 * Schema initialization for properties and tags
 * Following logseq-db-plugin-api-skill best practices
 */

import { URL_PROPERTY, DATE_PROPERTY, BOOKMARKS_TAG } from './types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeIdent(ident: unknown): string | null {
  if (!ident) return null
  if (typeof ident === 'string') return ident
  try {
    return String(ident)
  } catch {
    return null
  }
}

function identMatchesProperty(ident: unknown, propertyName: string): boolean {
  const normalized = normalizeIdent(ident)
  if (!normalized) return false

  const withoutColon = normalized.startsWith(':') ? normalized.slice(1) : normalized
  const tail = withoutColon.split('/').pop() || withoutColon
  const baseName = tail.split('-')[0]

  return baseName === propertyName || tail === propertyName || withoutColon === propertyName
}

/**
 * Initialize property type definitions
 * date and url are added to tag schema only — Logseq creates them
 * automatically in the :user.property/ namespace.
 */
export async function initializeProperties(): Promise<void> {
  console.log('[Karakeep] Properties will be initialized via tag schema only')
}

interface SchemaConfig {
  tagName: string
  urlPropertyName: string
  datePropertyName: string
  urlPropertyIdentOverride: string
  datePropertyIdentOverride: string
}

/**
 * Initialize Bookmarks tag with property schema
 * Creates the tag if it doesn't exist and adds properties to its schema
 * Only adds properties if they don't already exist
 */
export async function initializeBookmarksTag(config?: Partial<SchemaConfig>): Promise<void> {
  try {
    const tagName = config?.tagName || BOOKMARKS_TAG
    const urlPropertyName = config?.urlPropertyName || URL_PROPERTY
    const datePropertyName = config?.datePropertyName || DATE_PROPERTY
    const urlPropertyIdentOverride = config?.urlPropertyIdentOverride?.trim()
    const datePropertyIdentOverride = config?.datePropertyIdentOverride?.trim()

    console.log('[Karakeep] ===== INITIALIZING BOOKMARKS TAG SCHEMA =====')

    // Create or get the bookmarks tag
    let tag = await logseq.Editor.getTag(tagName)
    console.log('[Karakeep] getTag result:', tag)

    if (!tag) {
      tag = await logseq.Editor.createTag(tagName)
      console.log(`[Karakeep] Created #${tagName} tag:`, tag)
    }

    if (!tag) {
      console.error(`[Karakeep] Failed to create #${tagName} tag`)
      return
    }

    console.log('[Karakeep] Tag UUID:', tag.uuid, 'Tag ID:', tag.id)

    // Get existing properties to check if we've already added them
    const tagData = await logseq.DB.datascriptQuery(
      `[:find (pull ?t [:block/properties *1]) :where [?t :block/uuid "${tag.uuid}"]]`
    )

    console.log('[Karakeep] Tag properties query result:', tagData)

    // Result format: [[{:block/properties {...}}]]
    const existingProps = tagData[0]?.[0]?.[':block/properties'] || {}
    console.log('[Karakeep] Existing properties:', existingProps)

    // Check if properties already exist
    const hasDatePropByName = Object.values(existingProps).some((p: any) =>
      identMatchesProperty(p?.[':db/ident'], datePropertyName)
    )
    const hasUrlPropByName = Object.values(existingProps).some((p: any) =>
      identMatchesProperty(p?.[':db/ident'], urlPropertyName)
    )

    // If user provides explicit property ident override, trust it and skip property auto-creation.
    const hasDateProp = !!datePropertyIdentOverride || hasDatePropByName
    const hasUrlProp = !!urlPropertyIdentOverride || hasUrlPropByName

    console.log('[Karakeep] hasDateProp:', hasDateProp, 'hasUrlProp:', hasUrlProp)

    // Use the proper plugin API: logseq.Editor.addTagProperty
    // Add date property if it doesn't exist
    if (!hasDateProp) {
      console.log('[Karakeep] Adding date property using logseq.Editor.addTagProperty...')
      try {
        await logseq.Editor.addTagProperty(tag.uuid, datePropertyName)
        console.log('[Karakeep] ✓ Added date property to tag schema')
      } catch (err) {
        console.error('[Karakeep] Error adding date property:', err)
      }
    } else {
      console.log('[Karakeep] Date property already exists')
    }

    // Add url property if it doesn't exist
    if (!hasUrlProp) {
      console.log('[Karakeep] Adding url property using logseq.Editor.addTagProperty...')
      try {
        await logseq.Editor.addTagProperty(tag.uuid, urlPropertyName)
        console.log('[Karakeep] ✓ Added url property to tag schema')
      } catch (err) {
        console.error('[Karakeep] Error adding url property:', err)
      }
    } else {
      console.log('[Karakeep] URL property already exists')
    }

    console.log('[Karakeep] ===== TAG SCHEMA INITIALIZATION COMPLETE =====')
  } catch (error) {
    console.error('[Karakeep] Error initializing tag:', error)
  }
}

/**
 * Complete schema initialization
 */
export async function initializeSchema(config?: Partial<SchemaConfig>): Promise<void> {
  await initializeProperties()
  await initializeBookmarksTag(config)
}

/**
 * Ensure Bookmarks page exists
 */
export async function ensureBookmarksPage(pageName = BOOKMARKS_TAG): Promise<void> {
  try {
    let page = await logseq.Editor.getPage(pageName)
    if (!page) {
      console.log(`[Karakeep] Creating ${pageName} page...`)
      await logseq.Editor.createPage(pageName)
    }
  } catch (error) {
    console.error(`[Karakeep] Error ensuring ${pageName} page exists:`, error)
  }
}

/**
 * Discover the full :db/ident for a property on a tag by property name
 * Returns the full ident like ':user.property/url-xlm_xRT0' or null if not found
 *
 * Properties added to tag schema get random suffixes that vary per database.
 * This function discovers the actual ident at runtime.
 */
export async function discoverPropertyIdent(
  tagUuid: string,
  propertyName: string
): Promise<string | null> {
  try {
    // In empty/new graphs, class-property materialization can lag immediately after addTagProperty.
    // Retry with two discovery strategies before giving up.
    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Strategy A: class properties refs
      const tagData = await logseq.DB.datascriptQuery(
        `[:find (pull ?t [:logseq.property.class/properties *]) :where [?t :block/uuid "${tagUuid}"]]`
      )

      const properties = tagData[0]?.[0]?.[':logseq.property.class/properties'] || []
      for (const propRef of properties) {
        const propId = (propRef as any)?.[':db/id']
        if (!propId) continue

        const propData = await logseq.DB.datascriptQuery(
          `[:find (pull ?p [:db/ident]) :where [?p :db/id ${propId}]]`
        )
        const ident = propData[0]?.[0]?.[':db/ident']
        if (identMatchesProperty(ident, propertyName)) {
          const normalized = normalizeIdent(ident)
          if (normalized) {
            console.log(`[Karakeep] Discovered ${propertyName} property ident:`, normalized)
            return normalized
          }
        }
      }

      // Strategy B: tag block properties map
      const blockPropsData = await logseq.DB.datascriptQuery(
        `[:find (pull ?t [:block/properties *1]) :where [?t :block/uuid "${tagUuid}"]]`
      )
      const blockProps = blockPropsData[0]?.[0]?.[':block/properties'] || {}
      for (const propValue of Object.values(blockProps)) {
        const ident = (propValue as any)?.[':db/ident']
        if (identMatchesProperty(ident, propertyName)) {
          const normalized = normalizeIdent(ident)
          if (normalized) {
            console.log(
              `[Karakeep] Discovered ${propertyName} property ident from block properties:`,
              normalized
            )
            return normalized
          }
        }
      }

      if (attempt < maxAttempts) {
        console.log(
          `[Karakeep] Property ident ${propertyName} not available yet (attempt ${attempt}/${maxAttempts}), retrying...`
        )
        await sleep(250)
      }
    }

    console.warn(`[Karakeep] Property ${propertyName} not found on tag ${tagUuid}`)
    return null
  } catch (error) {
    console.error(`[Karakeep] Error discovering property ident for ${propertyName}:`, error)
    return null
  }
}
