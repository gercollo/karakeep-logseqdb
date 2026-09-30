import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import vm from 'node:vm'
import { testGraph } from './graph'

// Run the real plugin entry point with only its host SDK import stubbed.
// All graph data, credentials, HTTP and timers belong to this test process.
const bundle = build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  plugins: [
    {
      name: 'test-logseq-host',
      setup(build) {
        build.onResolve({ filter: /^@logseq\/libs$/ }, () => ({
          path: 'logseq-host',
          namespace: 'test',
        }))
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: '' }))
      },
    },
  ],
}).then((result) => result.outputFiles![0].text)

function rawBookmark(id = 'one') {
  return {
    id,
    title: `Bookmark ${id}`,
    createdAt: '2026-07-03T12:00:00Z',
    archived: false,
    favourited: false,
    content: { type: 'link', url: `https://example.test/${id}` },
  }
}

async function fixture(fetchPage?: () => Promise<Response>, configure?: (mock: any) => void) {
  const graph = testGraph()
  const messages = new Map<string, string>()
  const history: string[] = []
  const timers = new Map<number, { run: () => void; delay: number }>()
  let nextTimer = 0
  let requests = 0
  let ready!: () => Promise<void>
  let manual!: () => Promise<void>
  let settingsChanged!: (next: unknown, previous: unknown) => void
  let graphChanged!: () => void
  let unload!: () => Promise<void>
  const mock = graph.mock as any
  mock.ready = (callback: () => Promise<void>) => {
    ready = callback
    return Promise.resolve()
  }
  mock.beforeunload = (callback: () => Promise<void>) => {
    unload = callback
  }
  mock.useSettingsSchema = () => {}
  mock.provideModel = () => {}
  mock.provideStyle = () => {}
  mock.onSettingsChanged = (callback: typeof settingsChanged) => {
    settingsChanged = callback
  }
  mock.Editor.addTagProperty = async () => {}
  mock.Editor.registerSlashCommand = (_name: string, callback: () => Promise<void>) => {
    manual = () => callback()
  }
  mock.App.onCurrentGraphChanged = (callback: () => void) => {
    graphChanged = callback
  }
  mock.App.registerCommandPalette = (_opts: unknown, callback: () => Promise<void>) => {
    manual = callback
  }
  mock.App.registerUIItem = () => {}
  mock.UI = {
    showMsg: async (text: string, _status?: string, opts?: { key?: string }) => {
      const key = opts?.key || `message-${history.length}`
      history.push(text)
      messages.set(key, text)
      return key
    },
    closeMsg: (key: string) => {
      messages.delete(key)
    },
  }
  const update = mock.updateSettings
  mock.updateSettings = async (next: Record<string, unknown>) => {
    const previous = { ...mock.settings }
    await update(next)
    settingsChanged({ ...mock.settings }, previous)
  }
  configure?.(mock)
  const context = {
    logseq: mock,
    crypto: globalThis.crypto,
    TextEncoder,
    URLSearchParams,
    Response,
    Headers,
    AbortController,
    AbortSignal,
    Request,
    FormData,
    Blob,
    fetch: async () => {
      requests++
      return fetchPage
        ? await fetchPage()
        : new Response(JSON.stringify({ bookmarks: [rawBookmark()], nextCursor: null }))
    },
    setTimeout: (run: () => void, delay: number) => {
      if (delay < 60000) return setTimeout(run, delay)
      timers.set(++nextTimer, { run, delay })
      return nextTimer
    },
    clearTimeout: (id: ReturnType<typeof setTimeout> | number) => {
      if (typeof id === 'number') timers.delete(id)
      else clearTimeout(id)
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }
  vm.runInNewContext(await bundle, context)
  await ready()
  return {
    graph,
    messages,
    history,
    timers,
    manual,
    requests: () => requests,
    graphChanged: () => graphChanged(),
    unload: () => unload(),
    changeSettings: (next: Record<string, unknown>) => {
      const previous = { ...mock.settings }
      Object.assign(mock.settings, next)
      settingsChanged({ ...mock.settings }, previous)
    },
  }
}

test('manual commands share the sync lock while an API request is in flight', async () => {
  let finish!: (value: Response) => void
  const f = await fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const first = f.manual()
  await new Promise((resolve) => setImmediate(resolve))
  await f.manual()
  assert.equal(f.requests(), 1)
  assert.ok(f.history.includes('Sync already in progress, please wait'))
  finish(new Response(JSON.stringify({ bookmarks: [rawBookmark()], nextCursor: null })))
  await first
  assert.equal(f.graph.counts.inserts, 1)
  assert.ok(f.history.some((message) => message.startsWith('Inserted 1 bookmarks')))
  assert.equal(
    [...f.messages.values()].some((text) => /Fetching|Processing/.test(text)),
    false
  )
  await f.unload()
})

test('API errors release the lock and close the fetching message', async () => {
  let fail = true
  const f = await fixture(async () => {
    if (fail) throw new Error('Synthetic network failure')
    return new Response(JSON.stringify({ bookmarks: [], nextCursor: null }))
  })
  await f.manual()
  assert.ok(f.history.some((message) => message.includes('Synthetic network failure')))
  assert.equal(
    [...f.messages.values()].some((text) => text.startsWith('Fetching')),
    false
  )
  assert.equal(f.graph.counts.inserts, 0)
  fail = false
  await f.manual()
  assert.equal(f.requests(), 2)
  assert.ok(f.history.includes('No bookmarks found'))
  await f.unload()
})

test('settings events use the previous snapshot and ID checkpoints do not restart the timer', async () => {
  const f = await fixture()
  f.changeSettings({ autoSyncEnabled: true, autoSyncInterval: 5 })
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers.values()][0].delay, 300000)
  const timerId = [...f.timers.keys()][0]
  await f.manual()
  assert.equal([...f.timers.keys()][0], timerId)
  assert.equal(f.graph.settings.karakeepApiToken, 'test-token')
  assert.equal(f.graph.settings.karakeepInstanceUrl, 'https://karakeep.test')
  f.changeSettings({ autoSyncInterval: 10 })
  assert.equal(f.timers.size, 1)
  assert.equal([...f.timers.values()][0].delay, 600000)
  f.changeSettings({ autoSyncEnabled: false })
  assert.equal(f.timers.size, 0)
  await f.unload()
})

test('a graph switch during HTTP fetching aborts the import before any new nodes', async () => {
  let finish!: (value: Response) => void
  const f = await fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const syncing = f.manual()
  await new Promise((resolve) => setImmediate(resolve))
  f.graphChanged()
  finish(new Response(JSON.stringify({ bookmarks: [rawBookmark()], nextCursor: null })))
  await syncing
  assert.equal(f.graph.counts.inserts, 0)
  assert.ok(f.history.some((message) => message.includes('active graph changed')))
  await f.unload()
})

test('startup registers commands without requiring a ready graph or touching schema', async () => {
  const f = await fixture(undefined, (mock) => {
    mock.Editor.getTag = async () => {
      throw new Error('Graph is not ready')
    }
    mock.Editor.addTagProperty = async () => {
      throw new Error('Startup must not write schema')
    }
  })
  assert.equal(typeof f.manual, 'function')
  assert.equal(f.graph.counts.propertyReads + f.graph.counts.propertyCreates, 0)
  assert.equal(f.graph.counts.queries, 0)
  assert.equal(f.requests(), 0)
  assert.equal(f.history.length, 0)
  await f.manual()
  assert.ok(f.history.includes('Sync failed: Graph is not ready'))
  assert.equal(f.graph.counts.inserts, 0)
  await f.unload()
})

test('startup errors expose the failed stage and exception, including async toolbar failures', async () => {
  const f = await fixture(undefined, (mock) => {
    mock.App.registerUIItem = async () => {
      throw new Error('Synthetic toolbar unavailable')
    }
  })
  assert.ok(
    f.history.includes(
      'Plugin initialization failed (registering toolbar): Synthetic toolbar unavailable'
    )
  )
  assert.equal(f.timers.size, 0)
  await f.unload()
})

test('settings registration errors are surfaced instead of swallowed', async () => {
  const f = await fixture(undefined, (mock) => {
    mock.useSettingsSchema = () => {
      throw new Error('Synthetic settings unavailable')
    }
  })
  assert.ok(
    f.history.includes(
      'Plugin initialization failed (registering settings): Synthetic settings unavailable'
    )
  )
  assert.equal(f.requests(), 0)
  await f.unload()
})

test('unloading while toolbar registration is pending cannot start background sync', async () => {
  const f = await fixture(undefined, (mock) => {
    mock.settings.autoSyncEnabled = true
    const beforeunload = mock.beforeunload
    let unload!: () => Promise<void>
    mock.beforeunload = (callback: () => Promise<void>) => {
      beforeunload(callback)
      unload = callback
    }
    mock.App.registerUIItem = async () => {
      await unload()
    }
  })
  assert.equal(f.timers.size, 0)
  assert.equal(f.requests(), 0)
  assert.equal(f.history.length, 0)
})
