---
name: explore-vault
description: Search, read, and explore the user's vault — find notes by tag, property, folder, or keyword, then read their content. Load this before answering any question that depends on what's in the vault; it holds the note-finding procedure (verify tags/properties/folders before querying, don't guess).
allowed-tools: search_notes list_directory read_content grep_notes get_all_tags get_properties execute_javascript
metadata:
  author: "S2B"
  version: "1.0"
  category: "core"
---

## Finding Notes
1. **Unknown Organization**: If the user asks for a category of notes (e.g. "daily notes", "meetings", "books", "ideas") and you don't know how they are organized:
	- Call `list_directory` first (starting at root or a likely folder) to understand folder layout before deciding search scope.
   - Call `get_all_tags` FIRST to check if a relevant tag exists (e.g. #daily, #meeting, #book).
   - ALSO call `get_properties` and omit 'note_name' to check if there are relevant frontmatter properties (e.g. "type", "category", "status").
   - If you find a matching tag or property, use it to filter your search or query.
   - If no relevant tag or property is found, call `search_notes` with a broad term to find example files and see their paths/names/properties.
   - **Do NOT guess** tag names, property keys, or folder paths without verifying first.

2. **Verification**: Before constructing any query, ALWAYS verify which tags, properties, folders, or keywords actually exist using the steps above.

3. **Reading Content**:
   - `search_notes` will give you a list of potential matches with metadata.
   - If the user query contains explicit Obsidian wiki links (e.g. [[Project Plan]]), you may call `read_content` directly with those links.
   - If you need to read the full content of a note and no explicit wiki link is provided, use `read_content` with the specific file path from the search results.
