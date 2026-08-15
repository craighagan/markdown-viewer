# Design: Persistent Comments for Local Markdown Files

## Overview

Add the ability to select text in a rendered markdown document and attach comments that persist to a sidecar file (`<filename>.comments.json`) alongside the original markdown file on disk.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (Chrome Extension)                          │
│                                                      │
│  ┌──────────────────┐    ┌────────────────────────┐ │
│  │  Content Script   │◄──►│  Background Service    │ │
│  │  (comments UI)    │    │  Worker                │ │
│  │                   │    │                        │ │
│  │  - Text selection │    │  - Routes messages     │ │
│  │  - Comment panel  │    │  - Native messaging    │ │
│  │  - Highlight      │    │    bridge              │ │
│  └──────────────────┘    └──────────┬─────────────┘ │
│                                      │               │
└──────────────────────────────────────┼───────────────┘
                                       │ Native Messaging
                                       ▼
                          ┌────────────────────────┐
                          │  Native Host (Node.js)  │
                          │                        │
                          │  - Read/write .json    │
                          │  - File path from URL  │
                          │  - Atomic writes       │
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │  Filesystem             │
                          │                        │
                          │  notes.md              │
                          │  notes.md.comments.json│
                          └────────────────────────┘
```

## Components

### 1. Comment Data Model

```json
{
  "version": 1,
  "file": "notes.md",
  "comments": [
    {
      "id": "c_1692345678_abc",
      "anchor": {
        "text": "selected text snippet",
        "prefix": "20 chars before selection",
        "suffix": "20 chars after selection",
        "headingContext": "## Nearest heading above"
      },
      "body": "This is my comment about this passage.",
      "createdAt": "2026-08-15T20:00:00Z",
      "updatedAt": "2026-08-15T20:00:00Z",
      "resolved": false
    }
  ]
}
```

**Anchor strategy:** Text anchoring uses the selected text plus surrounding prefix/suffix context. This is resilient to minor edits elsewhere in the document. The `headingContext` provides a fallback location hint if exact text matching fails.

### 2. Native Messaging Host (`markdown-viewer-comments-host`)

A Node.js script registered as a Chrome Native Messaging host.

**Responsibilities:**
- Receive file path + comment operations via stdin (Chrome's native messaging protocol)
- Convert `file:///` URLs to filesystem paths
- Read/write `<filename>.comments.json` sidecar files
- Atomic writes (write to `.tmp`, rename) to prevent corruption

**Registration:**
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.markdown_viewer.comments.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.markdown_viewer.comments.json`
- Windows: Registry key under `HKCU\Software\Google\Chrome\NativeMessagingHosts\`

**Host Manifest (`com.markdown_viewer.comments.json`):**
```json
{
  "name": "com.markdown_viewer.comments",
  "description": "Filesystem read/write for Markdown Viewer comments",
  "path": "/usr/local/bin/markdown-viewer-comments-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://ckkdlimhmcjmikdlpkmbgfkaikojcbjk/"]
}
```

**Protocol (length-prefixed JSON over stdin/stdout):**
```json
// Request: load comments
{"action": "load", "filePath": "/Users/me/docs/notes.md"}

// Response: comments loaded (file exists)
{"ok": true, "data": { "version": 1, "file": "notes.md", "comments": [...] }}

// Response: no comment file yet
{"ok": true, "data": null}

// Request: save comments
{"action": "save", "filePath": "/Users/me/docs/notes.md", "data": { "version": 1, ... }}

// Response: saved
{"ok": true}

// Error response
{"ok": false, "error": "EACCES: permission denied"}
```

### 3. Content Script (`content/comments.js`)

Injected alongside existing content scripts when viewing `file:///` markdown.

**UI elements:**
- **Selection action:** When user selects text and releases mouse, a small "💬" button appears near the selection endpoint
- **Comment sidebar:** Right-side panel (opposite the ToC) listing all comments for the file, ordered by document position
- **Highlights:** Anchored text gets a subtle yellow background highlight (`rgba(255, 220, 0, 0.2)`); clicking a highlight scrolls the sidebar to that comment
- **Comment editor:** Inline textarea with Save/Cancel buttons
- **Per-comment controls:** Edit, Resolve (strikethrough + dim), Delete

**Text anchoring logic:**
1. On selection, capture: `window.getSelection().toString()`, plus 20 chars before/after from the text content of the rendered HTML
2. On page load, re-anchor comments by searching rendered text nodes for anchor text flanked by prefix/suffix
3. If exact match fails, try: anchor text alone → heading context fallback
4. Unanchored comments display at the bottom of the sidebar with "⚠️ anchor lost" badge

**Interaction with existing features:**
- Comment panel toggle added to popup menu (like ToC toggle)
- When both ToC and Comments are active, ToC stays left, Comments stays right
- Comments respect the current theme's color scheme (light/dark)
- Autoreload: re-anchors comments after markdown re-render

### 4. Background Service Worker Changes (`background/comments.js`)

```javascript
md.comments = () => {
  var port = null
  var timeout = null

  function connect() {
    if (!port) {
      port = chrome.runtime.connectNative('com.markdown_viewer.comments')
      port.onDisconnect.addListener(() => { port = null })
    }
    clearTimeout(timeout)
    timeout = setTimeout(() => { port && port.disconnect(); port = null }, 30000)
    return port
  }

  return {
    load: (filePath) => { /* send load message, return promise */ },
    save: (filePath, data) => { /* send save message, return promise */ }
  }
}
```

### 5. Manifest Changes

```json
{
  "permissions": ["storage", "scripting", "nativeMessaging"]
}
```

`nativeMessaging` is the only new permission required.

## User Flow

1. User opens a local `.md` file → extension renders it as usual
2. User enables "Comments" from popup menu (or it's on by default for `file:///`)
3. Extension loads `<file>.comments.json` via native host; renders existing highlights
4. User selects text → "💬" tooltip appears
5. User clicks tooltip → comment input appears in sidebar, anchored to selection
6. User types comment, clicks Save
7. Background sends full comment state to native host → atomic write to disk
8. On file edit + autoreload, comments re-anchor to updated content

## Design Decisions

### Why sidecar `.comments.json` not inline HTML comments in the markdown?

- Doesn't modify the source markdown file
- Comments are structured data (timestamps, resolved state, anchoring metadata)
- Can be `.gitignore`d
- No risk of breaking rendering in other tools
- Human-readable JSON for manual editing or scripting

### Why Native Messaging and not File System Access API?

- File System Access API requires user gesture per session and doesn't work reliably on `file:///` in extensions
- Native Messaging is the established pattern (1Password, Bitwarden, etc.)
- Works without per-session prompts once installed

### Why not IndexedDB/chrome.storage keyed by file path?

- Comments should live alongside the file — portable when you move/copy files
- Survives browser reinstall or profile change
- Other tools can read/produce the same format
- `chrome.storage.sync` has a 100KB limit; comments could exceed it

### Comment file naming: `<filename>.comments.json`

`README.md` → `README.md.comments.json`

Keeps the association obvious. Sorting puts sidecar right next to source.

## Scope & Constraints

- **Local files only:** Comments only work on `file:///` URLs (native host requires a filesystem path)
- **Single user:** No collaboration. Last writer wins if two tabs save simultaneously.
- **Install step:** User runs `install.sh` once to register the native host
- **Node.js dependency:** Native host requires Node.js (v14+). Could alternatively be a compiled Go binary for zero dependencies.
- **Extension ID locked:** Native host manifest specifies the allowed extension ID. Sideloaded builds get a different ID.

## New Files

```
markdown-viewer/
├── content/
│   ├── comments.js          # Comment UI (selection, sidebar, highlights, editor)
│   └── comments.css         # Comment panel and highlight styling
├── background/
│   └── comments.js          # Native messaging bridge
├── native-host/
│   ├── index.js             # Native messaging host script
│   ├── package.json         # Minimal — no external deps
│   ├── install.sh           # macOS/Linux: copies host + registers manifest
│   ├── install.bat          # Windows installer
│   └── manifest.json        # Native host manifest template
└── manifest.chrome.json     # +nativeMessaging permission
```

## Open Questions

1. Toggle behavior — always-on for local files, or require explicit enable in popup?
2. Sidebar vs. inline popovers for comment display?
3. Reply threads per anchor, or single comment per selection?
4. Orphan handling when markdown changes — show orphans in a separate section?
5. Node.js vs. compiled binary for the native host?
