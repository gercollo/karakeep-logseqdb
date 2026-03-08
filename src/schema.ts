/**
 * Schema initialization for properties and tags
 * Following logseq-db-plugin-api-skill best practices
 */

import { URL_PROPERTY, DATE_PROPERTY, BOOKMARKS_TAG } from './types'

/**
 * Initialize property type definitions
 * date and url are added to tag schema only — Logseq creates them
 * automatically in the :user.property/ namespace.
 */
export async function initializeProperties(): Promise<void> {
  console.log('[Karakeep] Properties will be initialized via tag schema only')
}

/**
 * Initialize Bookmarks tag with property schema
 * Creates the tag if it doesn't exist and adds properties to its schema
 * Only adds properties if they don't already exist
 */
export async function initializeBookmarksTag(): Promise<void> {
  try {
    console.log('[Karakeep] ===== INITIALIZING BOOKMARKS TAG SCHEMA =====')

    // Create or get the bookmarks tag
    let tag = await logseq.Editor.getTag(BOOKMARKS_TAG)
    console.log('[Karakeep] getTag result:', tag)

    if (!tag) {
      tag = await logseq.Editor.createTag(BOOKMARKS_TAG)
      console.log(`[Karakeep] Created #${BOOKMARKS_TAG} tag:`, tag)
    }

    if (!tag) {
      console.error(`[Karakeep] Failed to create #${BOOKMARKS_TAG} tag`)
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
    const hasDateProp = Object.values(existingProps).some(
      (p: any) => p?.[':db/ident'] === DATE_PROPERTY
    )
    const hasUrlProp = Object.values(existingProps).some(
      (p: any) => p?.[':db/ident'] === URL_PROPERTY
    )

    console.log('[Karakeep] hasDateProp:', hasDateProp, 'hasUrlProp:', hasUrlProp)

    // Use the proper plugin API: logseq.Editor.addTagProperty
    // Add date property if it doesn't exist
    if (!hasDateProp) {
      console.log('[Karakeep] Adding date property using logseq.Editor.addTagProperty...')
      try {
        await logseq.Editor.addTagProperty(tag.uuid, DATE_PROPERTY)
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
        await logseq.Editor.addTagProperty(tag.uuid, URL_PROPERTY)
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
export async function initializeSchema(): Promise<void> {
  await initializeProperties()
  await initializeBookmarksTag()
}

/**
 * Ensure Bookmarks page exists
 */
export async function ensureBookmarksPage(): Promise<void> {
  try {
    let page = await logseq.Editor.getPage('Bookmarks')
    if (!page) {
      console.log('[Karakeep] Creating Bookmarks page...')
      await logseq.Editor.createPage('Bookmarks')
    }
  } catch (error) {
    console.error('[Karakeep] Error ensuring Bookmarks page exists:', error)
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
    // Query tag's class properties - stored in :logseq.property.class/properties
    const tagData = await logseq.DB.datascriptQuery(
      `[:find (pull ?t [:logseq.property.class/properties *]) :where [?t :block/uuid "${tagUuid}"]]`
    )

    console.log(`[Karakeep] discoverPropertyIdent: tagData for ${propertyName}:`, tagData)

    const properties = tagData[0]?.[0]?.[':logseq.property.class/properties'] || []
    console.log(`[Karakeep] discoverPropertyIdent: properties:`, properties)

    // Each property is a ref, need to get its :db/ident
    for (const propRef of properties) {
      const propId = (propRef as any)?.[':db/id']
      if (propId) {
        // Query the property entity to get its :db/ident
        const propData = await logseq.DB.datascriptQuery(
          `[:find (pull ?p [:db/ident]) :where [?p :db/id ${propId}]]`
        )
        const ident = propData[0]?.[0]?.[':db/ident']
        console.log(`[Karakeep] discoverPropertyIdent: prop ${propId} has ident:`, ident)

        if (ident && typeof ident === 'string') {
          // Extract name from ident (e.g., "url" from ":user.property/url-xyz")
          const identName = ident.split('/').pop()?.split('-')[0]
          console.log(
            `[Karakeep] discoverPropertyIdent: extracted name "${identName}" looking for "${propertyName}"`
          )
          if (identName === propertyName) {
            console.log(`[Karakeep] Discovered ${propertyName} property ident:`, ident)
            return ident
          }
        }
      }
    }

    console.warn(`[Karakeep] Property ${propertyName} not found on tag ${tagUuid}`)
    return null
  } catch (error) {
    console.error(`[Karakeep] Error discovering property ident for ${propertyName}:`, error)
    return null
  }
}
