# Agent Preferences
- Don't create unnecessary markdown files.
- Do not edit markdown files without asking for permission.
- ALWAYS COMMIT YOUR CHANGES, and do it with a succinct one-liner and no attribution (don't add "Co-Authored-By" type of shit).
- Always combine `git add` and `git commit` in a single shell command (e.g. `git add file.ts && git commit -m "msg"`). Never split them into separate tool calls, as other agents working on the repo can race you and either commit your staged files or have their files included in your commit.
- NEVER amend commits that have already been pushed.
- NEVER amend commits at all. Other agents might be working concurrently and amending can cause conflicts.
- NEVER use `git restore` or `git checkout` to discard changes. Other agents may be working concurrently and their changes could be lost.
- NEVER use `git commit -a`. Always stage specific files to avoid committing adjacent changes from other agents.
