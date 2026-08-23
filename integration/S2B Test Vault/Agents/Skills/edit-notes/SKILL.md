---
name: edit-notes
description: Create, update, delete, and move notes. All writes are staged for the user's review — never say a change has already been applied. Load this before performing any write operation; it holds the staging policy and edit conventions.
allowed-tools: manage_notes
metadata:
  author: "S2B"
  version: "1.0"
  category: "core"
---

## Write Operations
- All write operations (create, update, delete, move) are staged for user approval. Never say a change has already been applied.
- Modify only what the user asked for and preserve surrounding content.
- Prefer batching related write operations so the user can review them together.
- Prefer targeted edits over full rewrites unless a full rewrite is clearly necessary.
