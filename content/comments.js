;(() => {
  // Comments state
  var comments = []
  var pendingSelection = null
  var sidebarVisible = false
  var pageUrl = location.href

  // ─── INITIALIZATION ───────────────────────────────────────────

  function init () {
    loadComments()
    setupKeyboardShortcut()
    setupSelectionListener()
    setupMessageListener()
    createSidebar()
    createToggleButton()
  }

  // ─── STORAGE ──────────────────────────────────────────────────

  function loadComments () {
    chrome.runtime.sendMessage({
      message: 'comments.load',
      url: pageUrl
    }, (res) => {
      if (res && res.comments) {
        comments = res.comments
        renderHighlights()
        updateBadge()
      }
    })
  }

  function saveComments () {
    chrome.runtime.sendMessage({
      message: 'comments.save',
      url: pageUrl,
      comments: comments
    })
    updateBadge()
  }

  // ─── SELECTION HANDLING ───────────────────────────────────────

  function setupSelectionListener () {
    document.addEventListener('mouseup', (e) => {
      // Ignore clicks inside our own UI
      if (e.target.closest('#_comments-sidebar') || e.target.closest('#_comments-input') || e.target.closest('#_comments-tooltip')) {
        return
      }

      // Remove any existing tooltip
      removeCommentTooltip()

      var sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0) {
        pendingSelection = captureSelection(sel)
        showCommentTooltip(e)
      }
    })

    // Remove tooltip on click elsewhere
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#_comments-tooltip')) {
        removeCommentTooltip()
      }
    })
  }

  function setupKeyboardShortcut () {
    document.addEventListener('keydown', (e) => {
      // Cmd+Shift+K (Mac) or Ctrl+Shift+K (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        e.stopPropagation()
        var sel = window.getSelection()
        if (sel && sel.toString().trim().length > 0) {
          pendingSelection = captureSelection(sel)
          showCommentInput()
        }
      }
    })
  }

  function showCommentTooltip (e) {
    var tooltip = document.createElement('div')
    tooltip.id = '_comments-tooltip'
    tooltip.textContent = '💬 Comment'
    tooltip.style.top = (e.pageY - 40) + 'px'
    tooltip.style.left = e.pageX + 'px'
    tooltip.addEventListener('click', () => {
      removeCommentTooltip()
      showCommentInput()
    })
    document.body.appendChild(tooltip)
  }

  function removeCommentTooltip () {
    var el = document.getElementById('_comments-tooltip')
    if (el) el.remove()
  }

  function setupMessageListener () {
    chrome.runtime.onMessage.addListener((req) => {
      if (req.message === 'comments.add-from-menu') {
        // Context menu was clicked — use the pending selection
        if (pendingSelection) {
          showCommentInput()
        }
      }
    })
  }

  function captureSelection (sel) {
    var range = sel.getRangeAt(0)
    var text = sel.toString().trim()

    // Get surrounding context for re-anchoring
    var container = range.commonAncestorContainer
    var fullText = (container.textContent || '')
    var startOffset = fullText.indexOf(text)
    var prefix = fullText.substring(Math.max(0, startOffset - 30), startOffset)
    var suffix = fullText.substring(startOffset + text.length, startOffset + text.length + 30)

    // Find nearest heading for fallback context
    var heading = ''
    var node = range.startContainer
    while (node && node !== document.body) {
      if (node.previousElementSibling) {
        var prev = node.previousElementSibling
        if (/^H[1-6]$/.test(prev.tagName)) {
          heading = prev.textContent
          break
        }
      }
      node = node.parentElement
    }

    // Get rect for positioning
    var rect = range.getBoundingClientRect()

    return {
      text: text.substring(0, 200), // Cap at 200 chars for storage
      prefix: prefix,
      suffix: suffix,
      heading: heading,
      rect: {top: rect.top + window.scrollY, left: rect.left}
    }
  }

  // ─── COMMENT INPUT UI ─────────────────────────────────────────

  function showCommentInput () {
    removeCommentInput()

    var input = document.createElement('div')
    input.id = '_comments-input'
    input.innerHTML = `
      <div class="_comments-input-header">
        <span>Comment on: <em>"${escapeHtml(pendingSelection.text.substring(0, 50))}${pendingSelection.text.length > 50 ? '…' : ''}"</em></span>
      </div>
      <textarea class="_comments-input-textarea" placeholder="Type your comment..." rows="3" autofocus></textarea>
      <div class="_comments-input-actions">
        <button class="_comments-btn-save">Save</button>
        <button class="_comments-btn-cancel">Cancel</button>
      </div>
    `

    // Position near the selection
    var top = pendingSelection.rect.top + 30
    input.style.top = top + 'px'

    document.body.appendChild(input)

    var textarea = input.querySelector('textarea')
    textarea.focus()

    // Save on button click or Cmd+Enter
    input.querySelector('._comments-btn-save').addEventListener('click', () => {
      saveComment(textarea.value)
    })

    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveComment(textarea.value)
      }
      if (e.key === 'Escape') {
        removeCommentInput()
      }
    })

    input.querySelector('._comments-btn-cancel').addEventListener('click', () => {
      removeCommentInput()
    })
  }

  function saveComment (body) {
    if (!body.trim() || !pendingSelection) return

    var comment = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      anchor: {
        text: pendingSelection.text,
        prefix: pendingSelection.prefix,
        suffix: pendingSelection.suffix,
        heading: pendingSelection.heading
      },
      body: body.trim(),
      createdAt: new Date().toISOString(),
      resolved: false
    }

    comments.push(comment)
    saveComments()
    removeCommentInput()
    renderHighlights()
    renderSidebar()
    pendingSelection = null
    window.getSelection().removeAllRanges()
  }

  function removeCommentInput () {
    var el = document.getElementById('_comments-input')
    if (el) el.remove()
  }

  // ─── HIGHLIGHTS ───────────────────────────────────────────────

  function renderHighlights () {
    // Remove existing highlights
    document.querySelectorAll('mark._comment-highlight').forEach((el) => el.replaceWith(...el.childNodes))

    comments.forEach((comment) => {
      if (comment.resolved) return
      highlightText(comment)
    })
  }

  function highlightText (comment) {
    var content = document.getElementById('_html') || document.getElementById('_markdown')
    if (!content) return

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null)
    var searchText = comment.anchor.text
    var node

    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(searchText)
      if (idx === -1) continue

      // Verify with prefix/suffix context if available
      var parentText = node.parentElement.textContent || ''
      var contextMatch = true
      if (comment.anchor.prefix) {
        contextMatch = parentText.includes(comment.anchor.prefix + searchText)
      }
      if (!contextMatch && comment.anchor.suffix) {
        contextMatch = parentText.includes(searchText + comment.anchor.suffix)
      }

      if (idx >= 0) {
        var range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, Math.min(idx + searchText.length, node.textContent.length))

        var mark = document.createElement('mark')
        mark.className = '_comment-highlight'
        mark.dataset.commentId = comment.id
        mark.addEventListener('click', () => {
          showSidebar()
          scrollSidebarTo(comment.id)
        })

        try {
          range.surroundContents(mark)
        } catch (e) {
          // Range spans multiple elements — skip highlighting for this one
        }
        break
      }
    }
  }

  // ─── SIDEBAR ──────────────────────────────────────────────────

  function createSidebar () {
    var sidebar = document.createElement('div')
    sidebar.id = '_comments-sidebar'
    sidebar.innerHTML = `
      <div class="_comments-sidebar-header">
        <span class="_comments-title">Comments <span class="_comments-badge">0</span></span>
        <div class="_comments-sidebar-actions">
          <button class="_comments-btn-resolve-all" title="Resolve all">✓ All</button>
          <button class="_comments-btn-delete-all" title="Delete all">🗑 All</button>
          <button class="_comments-btn-export-json" title="Download as JSON">⬇ JSON</button>
          <button class="_comments-btn-export-md" title="Download as Markdown with inline comments">⬇ MD</button>
          <button class="_comments-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="_comments-sidebar-body"></div>
    `
    document.body.appendChild(sidebar)

    sidebar.querySelector('._comments-btn-close').addEventListener('click', hideSidebar)
    sidebar.querySelector('._comments-btn-export-json').addEventListener('click', exportCommentsJson)
    sidebar.querySelector('._comments-btn-export-md').addEventListener('click', exportCommentsMd)
    sidebar.querySelector('._comments-btn-resolve-all').addEventListener('click', resolveAll)
    sidebar.querySelector('._comments-btn-delete-all').addEventListener('click', deleteAll)
  }

  function createToggleButton () {
    var btn = document.createElement('button')
    btn.id = '_comments-toggle'
    btn.title = 'Toggle Comments Panel'
    btn.textContent = '💬'
    btn.addEventListener('click', toggleSidebar)
    document.body.appendChild(btn)
  }

  function toggleSidebar () {
    sidebarVisible ? hideSidebar() : showSidebar()
  }

  function showSidebar () {
    sidebarVisible = true
    document.getElementById('_comments-sidebar').classList.add('_visible')
    renderSidebar()
  }

  function hideSidebar () {
    sidebarVisible = false
    document.getElementById('_comments-sidebar').classList.remove('_visible')
  }

  function renderSidebar () {
    var body = document.querySelector('#_comments-sidebar ._comments-sidebar-body')
    if (!body) return

    if (comments.length === 0) {
      body.innerHTML = '<div class="_comments-empty">No comments yet.<br>Select text and click the 💬 tooltip,<br>or press <kbd>⌘⇧K</kbd> to add a comment.</div>'
      return
    }

    body.innerHTML = comments.map((c) => `
      <div class="_comments-item ${c.resolved ? '_resolved' : ''}" data-id="${c.id}">
        <div class="_comments-item-anchor" title="${escapeHtml(c.anchor.text)}">
          "${escapeHtml(c.anchor.text.substring(0, 60))}${c.anchor.text.length > 60 ? '…' : ''}"
        </div>
        <div class="_comments-item-body">${escapeHtml(c.body)}</div>
        <div class="_comments-item-meta">
          <span class="_comments-item-date">${formatDate(c.createdAt)}</span>
          <span class="_comments-item-actions">
            ${c.resolved
              ? '<button class="_comments-btn-unresolve" data-id="' + c.id + '">Reopen</button>'
              : '<button class="_comments-btn-resolve" data-id="' + c.id + '">Resolve</button>'
            }
            <button class="_comments-btn-delete" data-id="${c.id}">Delete</button>
          </span>
        </div>
      </div>
    `).join('')

    // Attach event listeners
    body.querySelectorAll('._comments-btn-resolve').forEach((btn) => {
      btn.addEventListener('click', () => resolveComment(btn.dataset.id))
    })
    body.querySelectorAll('._comments-btn-unresolve').forEach((btn) => {
      btn.addEventListener('click', () => unresolveComment(btn.dataset.id))
    })
    body.querySelectorAll('._comments-btn-delete').forEach((btn) => {
      btn.addEventListener('click', () => deleteComment(btn.dataset.id))
    })
    body.querySelectorAll('._comments-item-anchor').forEach((el) => {
      el.addEventListener('click', () => {
        var id = el.closest('._comments-item').dataset.id
        scrollToHighlight(id)
      })
    })
  }

  function scrollSidebarTo (commentId) {
    var item = document.querySelector(`._comments-item[data-id="${commentId}"]`)
    if (item) {
      item.scrollIntoView({behavior: 'smooth', block: 'center'})
      item.classList.add('_flash')
      setTimeout(() => item.classList.remove('_flash'), 1000)
    }
  }

  function scrollToHighlight (commentId) {
    var mark = document.querySelector(`mark[data-comment-id="${commentId}"]`)
    if (mark) {
      mark.scrollIntoView({behavior: 'smooth', block: 'center'})
      mark.classList.add('_flash')
      setTimeout(() => mark.classList.remove('_flash'), 1000)
    }
  }

  // ─── COMMENT OPERATIONS ───────────────────────────────────────

  function resolveComment (id) {
    var c = comments.find((c) => c.id === id)
    if (c) { c.resolved = true; saveComments(); renderHighlights(); renderSidebar() }
  }

  function unresolveComment (id) {
    var c = comments.find((c) => c.id === id)
    if (c) { c.resolved = false; saveComments(); renderHighlights(); renderSidebar() }
  }

  function deleteComment (id) {
    comments = comments.filter((c) => c.id !== id)
    saveComments()
    renderHighlights()
    renderSidebar()
  }

  function resolveAll () {
    if (!comments.some((c) => !c.resolved)) return
    comments.forEach((c) => { c.resolved = true })
    saveComments()
    renderHighlights()
    renderSidebar()
  }

  function deleteAll () {
    if (!comments.length) return
    if (!confirm('Delete all ' + comments.length + ' comment(s)?')) return
    comments = []
    saveComments()
    renderHighlights()
    renderSidebar()
  }

  function exportCommentsJson () {
    var pathParts = new URL(pageUrl).pathname.split('/')
    var filename = (pathParts[pathParts.length - 1] || 'document') + '.comments.json'

    chrome.runtime.sendMessage({
      message: 'comments.export',
      url: pageUrl,
      filename: filename
    })
  }

  function exportCommentsMd () {
    var pathParts = new URL(pageUrl).pathname.split('/')
    var baseFilename = pathParts[pathParts.length - 1] || 'document'
    // Strip .md extension if present, then add .commented.md
    var filename = baseFilename.replace(/\.md$/i, '') + '.commented.md'

    // Fetch the raw markdown source
    chrome.runtime.sendMessage({
      message: 'comments.export-md',
      url: pageUrl,
      filename: filename,
      comments: comments
    })
  }

  // ─── BADGE ────────────────────────────────────────────────────

  function updateBadge () {
    var badge = document.querySelector('._comments-badge')
    if (badge) {
      var count = comments.filter((c) => !c.resolved).length
      badge.textContent = count
      badge.style.display = count > 0 ? 'inline' : 'none'
    }

    var toggle = document.getElementById('_comments-toggle')
    if (toggle) {
      var count = comments.filter((c) => !c.resolved).length
      toggle.textContent = count > 0 ? `💬 ${count}` : '💬'
    }
  }

  // ─── UTILITIES ────────────────────────────────────────────────

  function escapeHtml (str) {
    return str.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]))
  }

  function formatDate (iso) {
    var d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
  }

  // ─── BOOT ─────────────────────────────────────────────────────

  // Wait for the markdown viewer to finish rendering
  var bootInterval = setInterval(() => {
    if (document.getElementById('_html') || document.getElementById('_markdown')) {
      clearInterval(bootInterval)
      init()
    }
  }, 100)
})()
