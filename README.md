# Logseq Karakeep Plugin

Sync bookmarks from [Karakeep](https://karakeep.app) into Logseq DB.

This extension is early stage.

Use it first with a small Karakeep collection and a test graph before using it on a larger graph or your main data.

This extension works with **Logseq DB only**.

## What It Does

- Imports bookmarks from Karakeep into Logseq
- Stores bookmarks under a configurable bookmarks tag/page
- Supports configurable `url` and `date` properties
- Supports manual sync and optional auto-sync

## Setup

1. Install the plugin in Logseq DB.
2. Open plugin settings.
3. Add your Karakeep API token.
4. Set your Karakeep instance URL.
5. Optionally set bookmark tag name, URL property name, date property name, or URL/date property ident overrides.
6. Run the first sync manually with the slash command `/Karakeep: Retrieve Bookmarks`.

## Recommendation

Test with:

- a small bookmark collection
- a fresh or disposable Logseq DB graph
- manual sync first, before enabling auto-sync

## Install

Install from the GitHub release `plugin.zip` or from the CI `plugin-build` artifact.

Do not use the repository source zip as the plugin package.

## Disclaimer

Karakeep and related names, branding, and trademarks belong to their respective owner or original creator.

This project is an independent community plugin and is not affiliated with or endorsed by Karakeep.
