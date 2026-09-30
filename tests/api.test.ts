import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KarakeepAPI, bookmarkFilters, createAPIClient } from '../src/api/karakeep'
import { DEFAULT_SETTINGS, type KarakeepBookmark } from '../src/types'

const item = (id: string) => ({ id }) as KarakeepBookmark

test('keeps the existing Bearer-token login and instance URL while adding pagination parameters', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url: string, opts: RequestInit) => {
    requests++
    const requestUrl = new URL(url)
    assert.equal(requestUrl.origin, 'https://karakeep.test')
    assert.equal(requestUrl.pathname, '/api/v1/bookmarks')
    assert.equal(requestUrl.searchParams.get('archived'), 'false')
    assert.equal(requestUrl.searchParams.get('favourited'), 'true')
    assert.equal(new Headers(opts.headers).get('Authorization'), 'Bearer unchanged-test-token')
    return new Response(JSON.stringify({ bookmarks: [], nextCursor: null }), {
      headers: { 'content-type': 'application/json' },
    })
  })
  await new KarakeepAPI('https://karakeep.test/', 'unchanged-test-token').fetchAllBookmarks({
    archived: false,
    favourited: true,
  })
  assert.equal(requests, 1)
})

test('collects cursor pages without losing entries', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  const calls: unknown[] = []
  api.getAllBookmarks = async (options) => {
    calls.push(options)
    return options?.cursor
      ? { bookmarks: [item('two')], nextCursor: null }
      : { bookmarks: [item('one')], nextCursor: 'next' }
  }
  assert.deepEqual(
    (await api.fetchAllBookmarks()).map((bookmark) => bookmark.id),
    ['one', 'two']
  )
  assert.equal(calls.length, 2)
})

test('a total limit sizes the last request and returns exactly that many entries', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  const limits: number[] = []
  api.getAllBookmarks = async (options) => {
    limits.push(options!.limit!)
    return {
      bookmarks: Array.from({ length: 100 }, (_, i) => item(`${limits.length}-${i}`)),
      nextCursor: `cursor-${limits.length}`,
    }
  }
  assert.equal((await api.fetchAllBookmarks({ limit: 125 })).length, 125)
  assert.deepEqual(limits, [100, 25])
  assert.equal((await api.fetchAllBookmarks({ limit: 0 })).length, 0)
  assert.equal(limits.length, 2)
})

test('stops a repeated cursor instead of fetching indefinitely', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  let calls = 0
  api.getAllBookmarks = async () => {
    calls++
    return { bookmarks: [item('one')], nextCursor: 'repeated' }
  }
  await assert.rejects(api.fetchAllBookmarks(), /repeated pagination cursor/)
  assert.equal(calls, 2)
})

test('rejects invalid limits and malformed page payloads before import', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  for (const limit of [-1, NaN, 1.5])
    await assert.rejects(api.fetchAllBookmarks({ limit }), /non-negative integer/)
  api.getAllBookmarks = async () => ({ bookmarks: null, nextCursor: null }) as never
  await assert.rejects(api.fetchAllBookmarks(), /Invalid Karakeep bookmark response/)
})

test('Include archived means both archived statuses; Only favourited is optional', () => {
  assert.deepEqual(bookmarkFilters(DEFAULT_SETTINGS), { archived: false, favourited: undefined })
  assert.deepEqual(bookmarkFilters({ ...DEFAULT_SETTINGS, includeArchived: true }), {
    archived: undefined,
    favourited: undefined,
  })
  assert.deepEqual(bookmarkFilters({ ...DEFAULT_SETTINGS, includeFavourited: true }), {
    archived: false,
    favourited: true,
  })
})

test('client creation still uses the existing login settings without rewriting them', () => {
  const settings = {
    karakeepApiToken: 'unchanged-test-token',
    karakeepInstanceUrl: 'https://karakeep.test',
  }
  globalThis.logseq = { settings } as unknown as typeof logseq
  assert.ok(createAPIClient())
  assert.deepEqual(settings, {
    karakeepApiToken: 'unchanged-test-token',
    karakeepInstanceUrl: 'https://karakeep.test',
  })
  globalThis.logseq = { settings: {} } as typeof logseq
  assert.equal(createAPIClient(), null)
})

test('a graph/context cancellation stops pagination before requesting the next page', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  let cancelled = false
  let calls = 0
  api.getAllBookmarks = async () => {
    calls++
    cancelled = true
    return { bookmarks: [item('one')], nextCursor: 'more' }
  }
  await assert.rejects(
    api.fetchAllBookmarks(undefined, () => {
      if (cancelled) throw new Error('Context changed')
    }),
    /Context changed/
  )
  assert.equal(calls, 1)
})

test('a hanging request is aborted and its deadline timer is cleared', async (t) => {
  let expire!: () => void
  let cleared = false
  const timer = {} as ReturnType<typeof setTimeout>
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
    assert.equal(delay, 30000)
    expire = callback
    return timer
  })
  t.mock.method(globalThis, 'clearTimeout', (value: unknown) => {
    assert.equal(value, timer)
    cleared = true
  })
  t.mock.method(
    globalThis,
    'fetch',
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason))
      })
  )
  const request = new KarakeepAPI('https://karakeep.test', 'test-token').getAllBookmarks()
  expire()
  await assert.rejects(request, /Karakeep request timed out/)
  assert.equal(cleared, true)
})

test('rejects a malformed cursor value', async () => {
  const api = new KarakeepAPI('https://karakeep.test', 'test-token')
  api.getAllBookmarks = async () => ({ bookmarks: [], nextCursor: { malformed: true } }) as never
  await assert.rejects(api.fetchAllBookmarks(), /Invalid Karakeep pagination cursor/)
})
