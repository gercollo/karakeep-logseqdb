# Agent Preferences
- Don't create unnecessary markdown files.
- Do not edit markdown files without asking for permission.
- ALWAYS COMMIT YOUR CHANGES, and do it with a succinct one-liner and no attribution (don't add "Co-Authored-By" type of shit).
- Always combine `git add` and `git commit` in a single shell command (e.g. `git add file.ts && git commit -m "msg"`). Never split them into separate tool calls, as other agents working on the repo can race you and either commit your staged files or have their files included in your commit.
- NEVER amend commits that have already been pushed.
- NEVER amend commits at all. Other agents might be working concurrently and amending can cause conflicts.
- NEVER use `git restore` or `git checkout` to discard changes. Other agents may be working concurrently and their changes could be lost.
- NEVER use `git commit -a`. Always stage specific files to avoid committing adjacent changes from other agents.

## Current Plugin Invariants
- The plugin now uses fixed managed properties only:
  - `bookmark_url`
  - `bookmark_date`
- Do not reintroduce settings for property names or property ident overrides unless explicitly asked.
- Keep only the retrieve command unless the user explicitly asks for more commands.

## Bookmark Write Path
- New bookmark insertion must happen in this order:
  1. create the block
  2. add the `Bookmarks` tag
  3. write `bookmark_url`
  4. write `bookmark_date`
- Do not rely on `appendBlockInPage(..., { properties })` for bookmark properties in this graph. That created tagged blocks with empty properties.

## Property Rules
- `bookmark_url` must be a real Logseq `url` property.
- `bookmark_date` must be a real Logseq `date` property.
- For typed date writes, use the journal page entity id/ref. Do not write plain text date strings into the date property.
- Avoid reviving old property paths such as `url`, `date`, `karakeep_*`, `test124_*`, or `_test_plugin`.

## Tag/Class Rules
- Attach properties to `Bookmarks` with `addTagProperty(...)`.
- Do not try to write `class/properties` directly with `upsertBlockProperty(...)`.

## Dedupe Rules
- Dedupe/backfill must read from `bookmark_url`.
- Property reads may come back as entities, not raw strings. Extract the actual URL string before comparing.
- Multiple Karakeep bookmarks may share the same URL. Do not use a one-URL-to-one-bookmark-ID map for backfill.
- Do not save `syncedIds` for failed inserts.
