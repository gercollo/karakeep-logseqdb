# Logseq Karakeep Plugin

Sync bookmarks from [Karakeep](https://karakeep.app) to Logseq.

This plugin supports **Logseq DB only**.

## Features

- **One-way sync**: Bookmarks from Karakeep → Logseq
- **Date-organized**: Bookmarks appear on daily journal pages under a "Bookmarks" section
- **URL storage**: Bookmarks stored as page references or markdown links
- **Filtering**: Sync all, favourited, or archived bookmarks

## Setup

1. Install the plugin in Logseq
2. Go to Plugin Settings
3. Configure your Karakeep API token:
   - Go to your Karakeep instance → Settings → API Tokens
   - Create a new token and paste it in the plugin settings
4. Optionally configure your self-hosted instance URL
5. Optionally customize:
   - Bookmark tag name
   - URL/date property names
   - URL/date property ident overrides (advanced)
6. Run the first sync manually via slash command.

## Usage

Use the slash commands:
- `/Karakeep: Retrieve Bookmarks` - Sync all bookmarks

## Bookmark Format

Bookmarks are inserted under a "Bookmarks" section on daily journal pages:

```markdown
Jan 30, 2026
  Bookmarks
    [[Bookmark Title]]
    [[Another Bookmark]]
```

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Karakeep Instance URL | Your Karakeep URL | `https://try.karakeep.app` |
| API Token | Your API token | - |
| Include Archived | Sync archived bookmarks | `false` |
| Only Favourited | Only sync favourited | `false` |
| Use Page References | Use `[[Title]]` format | `true` |
| Bookmark Tag Name | Tag/page used for bookmark entries | `Bookmarks` |
| URL Property Name | Property name for URL values | `url` |
| Date Property Name | Property name for date values | `date` |
| URL Property Ident Override | Full property ident override (advanced) | empty |
| Date Property Ident Override | Full property ident override (advanced) | empty |

## Release Install

Install from GitHub release `plugin.zip` (not source zip), or use the CI `plugin-build` artifact.
