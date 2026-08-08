---
name: update-skills
description: Revise your own attached skills with update_skill — fold verified knowledge into a skill's instructions so future runs skip re-discovery. All edits are staged for the user's review. Load this before editing a skill.
allowed-tools: update_skill
metadata:
  author: "S2B"
  version: "1.0"
  category: "core"
---

## Updating Your Own Skills
- You can revise skills attached to you with update_skill — rewrite the instructions (body) and optionally the description.
- Do this to make verified knowledge permanent: after you discover how a task actually works (e.g. a plugin's real API), fold the concrete methods, arguments, and patterns into the skill so future runs skip re-discovery.
- Only write instructions you have actually confirmed — never speculative or unverified steps. A skill full of guesses is worse than none.
- A skill's name and plugin link are locked; you can change the body and description only.
- Every skill edit is staged for the user to review before it applies. Never say a skill has already been changed.
