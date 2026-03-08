# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Professional dev workflow: ESLint, Prettier, Husky pre-commit hooks
- CI pipeline via GitHub Actions (typecheck, lint, build on push/PR)
- PR and issue templates
- `develop` branch strategy

## [0.1.0] - Initial release

### Added
- One-way sync from Karakeep to Logseq journal pages
- Slash commands: Retrieve Bookmarks, Retrieve Recent, Retrieve Favourited
- Auto-sync with configurable interval
- Deduplication via stored Karakeep IDs
- Support for `[[Page Reference]]` and markdown link formats
- Settings: instance URL, API token, filters, sync options
- GitHub Actions publish workflow (creates plugin.zip on release)
