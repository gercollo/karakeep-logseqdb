# Agent Preferences
- Don't create unnecessary markdown files.
- Do not edit markdown files without asking for permission.
- ALWAYS COMMIT YOUR CHANGES, and do it with a succinct one-liner and no attribution (don't add "Co-Authored-By" type of shit).
- Always combine `git add` and `git commit` in a single shell command (e.g. `git add file.ts && git commit -m "msg"`). Never split them into separate tool calls, as other agents working on the repo can race you and either commit your staged files or have their files included in your commit.
- NEVER amend commits that have already been pushed.
- NEVER amend commits at all. Other agents might be working concurrently and amending can cause conflicts.
- NEVER use `git restore` or `git checkout` to discard changes. Other agents may be working concurrently and their changes could be lost.
- NEVER use `git commit -a`. Always stage specific files to avoid committing adjacent changes from other agents.

## Project Overview
- This is a Logseq DB-graph plugin that pulls bookmarks from Karakeep and materializes them as tagged Logseq blocks.
- The stable user-facing model is intentionally narrow:
  - one retrieve command
  - one bookmark class/tag: `Bookmarks`
  - two managed properties: `bookmark_url` and `bookmark_date`
- The codebase is small. The main seams are:
  - `src/index.ts` for orchestration, commands, sync flow, and insertion
  - `src/schema.ts` for property/tag setup against Logseq DB APIs
  - `src/settings.ts` for plugin settings
  - `src/logic.ts` for bookmark-to-block transformation
  - `src/api/` for Karakeep access

## Runtime Model
- The main complexity is not HTTP or transformation logic. It is Logseq DB behavior.
- Treat block creation, tagging, and property writes as separate operations. Logseq DB graphs are sensitive to ordering and property typing.
- Existing graph data may be heterogeneous because earlier iterations created multiple property variants. Avoid expanding that surface area again unless explicitly required.
- Dedupe is stateful. It relies on both persisted `syncedIds` and graph backfill against managed bookmark properties.

## Development Environment
- Validate code changes with:
  - `npm run typecheck`
  - `npm run build`
- Prefer small, local changes. This project has already accumulated failures from broad “fix everything” passes that changed schema assumptions, dedupe behavior, and command surface area at the same time.
- When touching sync behavior, reason in terms of three independent concerns:
  - schema setup
  - bookmark insertion
  - dedupe/backfill
- If a change affects Logseq property semantics, assume runtime verification matters more than static reasoning.

## CI/CD
- GitHub Actions CI runs on PRs to `main` and `develop`: typecheck, lint, build, and uploads a `plugin-build` artifact.
- The `publish.yml` workflow runs on GitHub releases: builds, packages `plugin.zip`, and attaches it to the release.

## Branch Strategy
- `main` is the release branch. `develop` is the integration branch.
- Create feature/fix branches off `develop` and open PRs against `develop`.

## Engineering Constraints
- Do not broaden the configurable surface without a strong reason. More property/config flexibility created most of the earlier regressions.
- Favor a single supported path over compatibility branches unless the user explicitly asks for migration or legacy support.
- Be careful with Logseq plugin APIs that appear generic. In this project, “can read” and “can safely write” have not been equivalent in practice.
