import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

interface SDKEntry {
  setupPluginUserInstance: (
    base: object,
    caller: object
  ) => {
    DB: { datascriptQuery: (query: string, ...inputs: unknown[]) => Promise<unknown> }
  }
}

// Execute the installed SDK distribution, including its real proxy argument handling.
// Skip automatic browser-host setup; only the RPC transport is supplied by the fixture.
const context = {
  window: { __LSP__HOST__: true },
  self: {} as { LSPluginEntry?: SDKEntry },
  navigator: { userAgent: 'test', platform: 'MacIntel' },
  console,
  URL,
  setTimeout,
  clearTimeout,
}
const require = createRequire(import.meta.url)
vm.runInNewContext(readFileSync(require.resolve('@logseq/libs'), 'utf8'), context)
const sdk = context.self.LSPluginEntry!

export function sdkQuery(execute: (query: string, ...inputs: unknown[]) => Promise<unknown>) {
  const instance = sdk.setupPluginUserInstance(
    {},
    {
      on: () => {},
      _extendUserModel: () => {},
      callAsync: async (
        event: string,
        payload: { method: string; args: [string, ...unknown[]] }
      ) => {
        assert.equal(event, 'api:call')
        assert.equal(payload.method, 'datascript_query')
        return execute(...payload.args)
      },
    }
  )
  return (query: string, ...inputs: unknown[]) => instance.DB.datascriptQuery(query, ...inputs)
}
