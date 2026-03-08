# Logseq Karakeep Plugin

Sync bookmarks from [Karakeep](https://karakeep.app) to Logseq.

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
5. Create a "Bookmarks" page in your graph (if it doesn't exist)

## Usage

Use the slash commands:
- `/Karakeep: Retrieve Bookmarks` - Sync all bookmarks
- `/Karakeep: Retrieve Recent Bookmarks` - Sync recent bookmarks (limit 100)
- `/Karakeep: Retrieve Favourited Bookmarks` - Sync only favourited

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
| Store Karakeep ID | Store bookmark ID | `true` |
