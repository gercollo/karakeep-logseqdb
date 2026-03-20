/**
 * Schema initialization for properties and tags.
 */

import { URL_PROPERTY, DATE_PROPERTY, BOOKMARKS_TAG, getPluginPropertyIdent } from './types'

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

interface SchemaConfig {
  tagName: string
  urlPropertyName: string
  datePropertyName: string
  urlPropertyIdentOverride: string
  datePropertyIdentOverride: string
}

interface ResolvedPropertyRef {
  ident: string
  tagRef: string
  writeKey: string
}

async function resolvePropertyRef(
  propertyName: string,
  identOverride?: string
): Promise<ResolvedPropertyRef> {
  const trimmedOverride = identOverride?.trim()
  if (trimmedOverride) {
    const result = await logseq.DB.datascriptQuery(
      `[:find (pull ?p [:db/ident :block/uuid :block/name]) :where [?p :db/ident ${trimmedOverride}]]`
    )
    const property = result?.[0]?.[0]
    const ident = normalizeIdent(property?.[':db/ident']) || trimmedOverride
    const uuid = property?.[':block/uuid']
    const name = property?.[':block/name']

    return {
      ident,
      tagRef: uuid || name || trimmedOverride,
      writeKey: name || propertyName,
    }
  }

  await logseq.Editor.upsertProperty(propertyName, {
    type: propertyName.toLowerCase().includes('date') ? 'date' : 'url',
    cardinality: 'one',
  })

  const managedProperty = await logseq.Editor.getProperty(propertyName)

  return {
    ident: normalizeIdent(managedProperty?.['ident']) || getPluginPropertyIdent(propertyName),
    tagRef: managedProperty?.uuid || propertyName,
    writeKey: String(managedProperty?.name || propertyName),
  }
}

/**
 * Ensure Karakeep-managed properties exist and return their actual idents.
 */
export async function ensureManagedPropertyIdents(config?: Partial<SchemaConfig>): Promise<{
  url: string
  date: string
  urlWriteKey: string
  dateWriteKey: string
}> {
  try {
    const urlPropertyName = config?.urlPropertyName || URL_PROPERTY
    const datePropertyName = config?.datePropertyName || DATE_PROPERTY
    const urlPropertyIdentOverride = config?.urlPropertyIdentOverride?.trim()
    const datePropertyIdentOverride = config?.datePropertyIdentOverride?.trim()

    const managedUrlProperty = await resolvePropertyRef(urlPropertyName, urlPropertyIdentOverride)
    const managedDateProperty = await resolvePropertyRef(
      datePropertyName,
      datePropertyIdentOverride
    )

    return {
      url: managedUrlProperty.ident,
      date: managedDateProperty.ident,
      urlWriteKey: managedUrlProperty.writeKey,
      dateWriteKey: managedDateProperty.writeKey,
    }
  } catch (error) {
    console.error('[Karakeep] Error ensuring managed properties:', error)
    return {
      url: getPluginPropertyIdent(config?.urlPropertyName || URL_PROPERTY),
      date: getPluginPropertyIdent(config?.datePropertyName || DATE_PROPERTY),
      urlWriteKey: config?.urlPropertyName || URL_PROPERTY,
      dateWriteKey: config?.datePropertyName || DATE_PROPERTY,
    }
  }
}

/**
 * Initialize Bookmarks tag with plugin-owned property schema.
 */
export async function initializeBookmarksTag(config?: Partial<SchemaConfig>): Promise<void> {
  try {
    const tagName = config?.tagName || BOOKMARKS_TAG
    const urlPropertyName = config?.urlPropertyName || URL_PROPERTY
    const datePropertyName = config?.datePropertyName || DATE_PROPERTY

    console.log('[Karakeep] ===== INITIALIZING BOOKMARKS TAG SCHEMA =====')

    let tag = await logseq.Editor.getTag(tagName)
    console.log('[Karakeep] getTag result:', tag)

    if (!tag) {
      await logseq.Editor.createTag(tagName)
      tag = await logseq.Editor.getTag(tagName)
      console.log(`[Karakeep] Created #${tagName} tag:`, tag)
    }

    if (!tag) {
      console.error(`[Karakeep] Failed to create #${tagName} tag`)
      return
    }

    const urlPropertyIdentOverride = config?.urlPropertyIdentOverride?.trim()
    const datePropertyIdentOverride = config?.datePropertyIdentOverride?.trim()
    const managedUrlProperty = await resolvePropertyRef(urlPropertyName, urlPropertyIdentOverride)
    const managedDateProperty = await resolvePropertyRef(
      datePropertyName,
      datePropertyIdentOverride
    )

    try {
      await logseq.Editor.addTagProperty(tag.uuid, managedDateProperty.tagRef)
    } catch (err) {
      console.log('[Karakeep] Date property already attached or unavailable:', err)
    }

    try {
      await logseq.Editor.addTagProperty(tag.uuid, managedUrlProperty.tagRef)
    } catch (err) {
      console.log('[Karakeep] URL property already attached or unavailable:', err)
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
  await ensureManagedPropertyIdents(config)
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
