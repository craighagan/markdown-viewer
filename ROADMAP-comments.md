# Comments Feature Roadmap

## Current State (v5.3.1)

- Select text → 💬 tooltip or ⌘⇧K to add comment
- Comments persist in `chrome.storage.local`
- Sidebar panel with comment list
- Highlights on anchored text
- Edit, resolve, reopen, delete individual comments
- Resolve All / Delete All bulk actions
- Export as JSON (`.comments.json`)
- Export as Markdown with inline HTML comments (`.commented.md`)
- Toggle on/off in popup Content settings

---

## Phase 1 — Metadata & Filtering

### 1.1 Author Name
- Configurable in extension options (stored in `chrome.storage.sync`)
- Stamped on each comment at creation time
- Displayed in sidebar below comment body
- Default: empty (no author shown)

### 1.2 Comment Tags
Preset tags (selectable at comment creation time):
- `question` — asking for clarification
- `suggestion` — proposing a change
- `issue` — something is wrong
- `outdated` — content is stale
- `action-needed` — requires follow-up
- `note` — general annotation (default)

Rendered as colored pills in the sidebar. Tag is optional.

### 1.3 Severity
Optional severity per comment:
- `critical` — red pill
- `high` — orange pill
- `medium` — yellow pill (default if set)
- `low` — grey pill

Omitted by default (most comments don't need severity).

### 1.4 Filter Sidebar
Dropdown filters at top of sidebar:
- By status: All / Open / Resolved
- By tag: All / specific tag
- By severity: All / Critical / High / Medium / Low

Filters combine (AND logic). Active filter count shown.

### 1.5 Keyboard Navigation
- `Ctrl+]` — jump to next comment (scroll page to highlight + flash sidebar item)
- `Ctrl+[` — jump to previous comment
- Works in document order (by anchor position)

---

## Phase 2 — Editing Power

### 2.1 Suggestion Mode
Special comment type: "I suggest changing the selected text to..."
- Comment creation UI shows a "Suggest replacement" toggle
- When active, a second textarea appears for the proposed text
- Sidebar renders suggestions as mini-diffs: ~~original~~ → **proposed**
- Suggestion can be "accepted" (not applied to file — just marks it as accepted)
- Markdown export renders as: `~~old text~~ **new text**<!-- SUGGESTION: reason -->`

### 2.2 Import Comments
- Button in sidebar header: "⬆ Import"
- Opens file picker for `.comments.json`
- Options: Merge (add to existing) or Replace (clear then load)
- Validates format version, skips duplicates by ID

### 2.3 Search Comments
- Search input at top of sidebar body
- Filters comments in real-time (searches body text + anchor text + tags)
- Clears with × button or Escape

### 2.4 Linkify URLs in Comments
- Auto-detect URLs in comment body text
- Render as clickable links (open in new tab)
- Support markdown-style links: `[text](url)` in comment body

---

## Phase 3 — Collaboration & Polish

### 3.1 Threaded Replies
- Each comment can have child replies
- Reply button on each comment → opens inline textarea
- Replies show author + timestamp, indented
- Replies export to JSON with the parent comment
- Data model: `replies: [{id, author, body, createdAt}]`

### 3.2 Comment Count Badge
- Extension icon shows badge with unresolved comment count for current tab
- Updates on comment add/resolve/delete
- Only shows for `file:///` URLs with active comments

### 3.3 Markdown Export with Suggestion Diffs
- Suggestions render as: `~~original~~**proposed**<!-- SUGGESTION (author): reason -->`
- Accepted suggestions render as just the proposed text with a note: `proposed text<!-- ACCEPTED: reason -->`

---

## Collaboration Strategy

### Zero-infrastructure options (v1 collaboration)

These work today or with Phase 2 import/export:

| Method | How it works | Best for |
|--------|-------------|----------|
| **Git-based** | `.comments.json` lives next to the `.md` in the repo. Each reviewer commits their comments. Git handles merge. | Engineering teams already using git |
| **File round-trip** | Export → share via Slack/email → teammate imports | Ad-hoc reviews, small teams |
| **Shared filesystem** | Markdown + sidecar on Google Drive / Dropbox / iCloud / NFS | Non-engineers, shared docs |

### Future shared storage options (v2 collaboration)

These would require extension configuration:

| Method | Complexity | Notes |
|--------|-----------|-------|
| **GitHub Gist** | Low | Export/import via Gist API. Shareable URL. Needs GitHub token. |
| **S3 bucket** | Medium | Team shares a bucket. Key = hash of file path. Needs AWS creds. |
| **WebDAV** | Medium | Works with Nextcloud, ownCloud, corporate file servers |
| **Firebase/Supabase** | Medium | Real-time sync, but adds a hosted dependency |
| **CRDTs (Yjs/Automerge)** | High | True real-time collaboration. Needs signaling server. |

**Recommendation:** Git-based + file round-trip covers 90% of use cases for the target audience (engineers reviewing markdown docs). Shared storage is a nice-to-have that can be plugged in later since the data model is just JSON.

---

## Data Model (target state)

```json
{
  "version": 2,
  "file": "README.md",
  "comments": [
    {
      "id": "c_1692345678_abc",
      "anchor": {
        "text": "selected text",
        "prefix": "30 chars before",
        "suffix": "30 chars after",
        "heading": "## Section Name"
      },
      "body": "Comment text here",
      "author": "Craig",
      "tag": "suggestion",
      "severity": "high",
      "suggestion": "proposed replacement text",
      "resolved": false,
      "createdAt": "2026-08-15T20:00:00Z",
      "updatedAt": "2026-08-15T20:05:00Z",
      "replies": [
        {
          "id": "r_1692345999_xyz",
          "author": "Alex",
          "body": "Agreed, let's change this.",
          "createdAt": "2026-08-16T10:00:00Z"
        }
      ]
    }
  ]
}
```

Backward compatible — `version: 1` files load fine (missing fields default to null/empty).

---

## Implementation Order

1. Phase 1.1: Author name (settings + stamp on creation)
2. Phase 1.2: Tags (UI in comment creation + pills in sidebar)
3. Phase 1.3: Severity (optional picker + pills)
4. Phase 1.4: Filter sidebar
5. Phase 1.5: Keyboard navigation
6. Phase 2.1: Suggestion mode
7. Phase 2.2: Import comments
8. Phase 2.3: Search comments
9. Phase 2.4: Linkify URLs
10. Phase 3.1: Threaded replies
11. Phase 3.2: Badge count
12. Phase 3.3: Enhanced markdown export
