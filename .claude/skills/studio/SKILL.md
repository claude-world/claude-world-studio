---
description: Claude World Studio CLI — publish to Threads, check accounts, view history
triggers:
  - publish to threads
  - post to threads
  - social media
  - studio publish
  - studio status
  - studio accounts
  - publish history
---

# Claude World Studio CLI

## Prerequisites

Studio server must be running (`claude-world-studio` or `npm run dev`).
Check with: `claude-world-studio status`

## Commands

### Check Status
```bash
claude-world-studio status
```

### List Accounts
```bash
claude-world-studio accounts
```
Returns account IDs needed for publishing.

### Publish to Threads
```bash
claude-world-studio publish \
  --account ACCOUNT_ID \
  --text "Post content here" \
  --score 75
```

Options:
- `--account ID` — Account ID from `accounts` command (required)
- `--text TEXT` — Post content, max 500 chars (required)
- `--score N` — Quality score, must be >= 70 (required by quality gate)
- `--image-url URL` — Public image URL to attach
- `--poll "Option A|Option B|Option C"` — Poll (2-4 options, pipe-separated)
- `--link-comment URL` — Auto-reply with link (keeps URL out of post body)
- `--tag TOPIC` — Topic tag, no # prefix

### View History
```bash
claude-world-studio history --limit 20
```

## Workflow

1. `claude-world-studio status` — ensure server running
2. `claude-world-studio accounts` — get account ID
3. Write content (max 500 chars, score >= 70)
4. `claude-world-studio publish --account ID --text "..." --score N`

## Quality Rules
- Score must be >= 70
- Text must be <= 500 chars
- No URLs in post body (use `--link-comment` instead)
- Polls use `--poll` flag, never text-based A/B/C in body
