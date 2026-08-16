;(() => {
  // ─── STATE ────────────────────────────────────────────────────

  var comments = []
  var pendingSelection = null
  var sidebarVisible = false
  var closeSidebarOnClick = true
  var pageUrl = location.href
  var authorName = ''
  var filters = {status: 'all', tag: 'all', severity: 'all'}
  var searchQuery = ''

  var TAGS = ['note', 'question', 'suggestion', 'issue', 'outdated', 'action-needed']
  var SEVERITIES = ['low', 'medium', 'high', 'critical']

  // ─── INITIALIZATION ───────────────────────────────────────────

  function init () {
    loadAuthor()
    loadComments()
    setupKeyboardShortcut()
    setupSelectionListener()
    setupMessageListener()
    createSidebar()
    createToggleButton()
  }

  // ─── STORAGE ──────────────────────────────────────────────────

  function loadAuthor () {
    chrome.storage.sync.get(['commentsAuthor', 'commentsCloseOnClick'], (res) => {
      authorName = res.commentsAuthor || ''
      closeSidebarOnClick = res.commentsCloseOnClick !== false // default true
    })
  }

  function loadComments () {
    chrome.runtime.sendMessage({
      message: 'comments.load',
      url: pageUrl
    }, (res) => {
      var stored = (res && res.comments) ? res.comments : []
      var inline = parseInlineComments()
      comments = mergeComments(stored, inline)
      if (inline.length > 0 && inline.length !== stored.length) {
        // Persist merged result so inline comments are editable
        saveComments()
      }
      renderHighlights()
      updateBadge()
    })
  }

  function parseInlineComments () {
    // The original <pre> may have been replaced by Mithril's mount.
    // Try to read it first; if empty, fetch the raw file.
    var pre = document.querySelector('pre')
    var source = pre ? (pre.textContent || pre.innerText || '') : ''

    if (source && source.includes('<!-- COMMENT')) {
      return parseInlineFromSource(source)
    }

    // If pre is gone or empty, fetch the raw file asynchronously
    if (location.protocol === 'file:') {
      chrome.runtime.sendMessage({
        message: 'autoreload',
        location: pageUrl
      }, (res) => {
        if (res && !res.err && res.body && res.body.includes('<!-- COMMENT')) {
          var inline = parseInlineFromSource(res.body)
          if (inline.length > 0) {
            var storedIds = new Set(comments.map((c) => c.id))
            var storedAnchors = new Set(comments.map((c) => c.anchor.text + '|||' + c.body))
            var newOnes = inline.filter((c) => !storedIds.has(c.id) && !storedAnchors.has(c.anchor.text + '|||' + c.body))
            if (newOnes.length > 0) {
              comments = comments.concat(newOnes)
              saveComments()
              renderHighlights()
              renderSidebar()
              updateBadge()
            }
          }
        }
      })
    }
    return []
  }

  function parseInlineFromSource (source) {
    var results = []
    var regex = /<!-- COMMENT(\s*\[RESOLVED\])?: ([\s\S]*?) -->/g
    var match

    while ((match = regex.exec(source)) !== null) {
      var resolved = !!match[1]
      var body = match[2].replace(/—/g, '--')

      var commentStart = match.index
      var commentEnd = commentStart + match[0].length

      // Grab text before the comment on the same line
      var beforeChunk = source.substring(Math.max(0, commentStart - 100), commentStart)
      var lastNewline = beforeChunk.lastIndexOf('\n')
      var lineBeforeComment = lastNewline >= 0 ? beforeChunk.substring(lastNewline + 1) : beforeChunk

      // Grab text after the comment (up to 50 chars, stop at newline)
      var afterChunk = source.substring(commentEnd, commentEnd + 50)
      var firstNewline = afterChunk.indexOf('\n')
      var lineAfterComment = firstNewline >= 0 ? afterChunk.substring(0, firstNewline) : afterChunk

      // Use text before comment as anchor (strip markdown syntax)
      var anchorText = lineBeforeComment.replace(/[#*_`>\[\]|]/g, '').trim()
      if (anchorText.length < 3) {
        anchorText = lineAfterComment.replace(/[#*_`>\[\]|]/g, '').trim()
      }
      if (anchorText.length < 3) continue

      // Prefix for disambiguation
      var prefixStart = Math.max(0, commentStart - 130)
      var prefixChunk = source.substring(prefixStart, Math.max(0, commentStart - 100))
      var prefix = prefixChunk.replace(/[#*_`>\[\]|]/g, '').trim()

      // Find nearest heading above
      var heading = ''
      var beforeAll = source.substring(0, commentStart)
      var headingMatches = beforeAll.match(/^#{1,6}\s+.+$/gm)
      if (headingMatches) heading = headingMatches[headingMatches.length - 1].replace(/^#+\s*/, '')

      results.push({
        id: 'inline_' + hashCode(anchorText + body),
        anchor: {
          text: anchorText.substring(0, 200),
          prefix: prefix.substring(0, 30),
          suffix: lineAfterComment.replace(/[#*_`>\[\]|]/g, '').trim().substring(0, 30),
          heading: heading
        },
        body: body.trim(),
        author: null,
        tag: null,
        severity: null,
        suggestion: null,
        replies: [],
        createdAt: new Date().toISOString(),
        updatedAt: null,
        resolved: resolved,
        _fromInline: true
      })
    }
    return results
  }

  function mergeComments (stored, inline) {
    if (!inline.length) return stored
    if (!stored.length) return inline

    // Merge: stored comments take priority (user may have edited them)
    var storedIds = new Set(stored.map((c) => c.id))
    var newInline = inline.filter((c) => !storedIds.has(c.id))

    // Also check by anchor text to avoid duplicating if ID format differs
    var storedAnchors = new Set(stored.map((c) => c.anchor.text + '|||' + c.body))
    var deduped = newInline.filter((c) => !storedAnchors.has(c.anchor.text + '|||' + c.body))

    return stored.concat(deduped)
  }

  function hashCode (str) {
    var hash = 0
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + ch
      hash |= 0
    }
    return Math.abs(hash).toString(36)
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
      if (e.target.closest('#_comments-sidebar') || e.target.closest('#_comments-input') || e.target.closest('#_comments-tooltip')) {
        return
      }
      removeCommentTooltip()
      var sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0) {
        pendingSelection = captureSelection(sel)
        showCommentTooltip(e)
      }
    })
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#_comments-tooltip')) {
        removeCommentTooltip()
      }
      // Close sidebar on click in document (not on our UI elements)
      if (sidebarVisible && closeSidebarOnClick
          && !e.target.closest('#_comments-sidebar')
          && !e.target.closest('#_comments-toggle')
          && !e.target.closest('#_comments-input')
          && !e.target.closest('#_comments-tooltip')
          && !e.target.closest('mark._comment-highlight')) {
        hideSidebar()
      }
    })
  }

  function setupKeyboardShortcut () {
    document.addEventListener('keydown', (e) => {
      // Cmd+Shift+K — add comment
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        e.stopPropagation()
        var sel = window.getSelection()
        if (sel && sel.toString().trim().length > 0) {
          pendingSelection = captureSelection(sel)
          showCommentInput()
        }
      }
      // Ctrl+] — next comment
      if (e.ctrlKey && e.key === ']') {
        e.preventDefault()
        navigateComment(1)
      }
      // Ctrl+[ — previous comment
      if (e.ctrlKey && e.key === '[') {
        e.preventDefault()
        navigateComment(-1)
      }
    })
  }

  function setupMessageListener () {
    chrome.runtime.onMessage.addListener((req) => {
      if (req.message === 'comments.add-from-menu') {
        if (pendingSelection) showCommentInput()
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

  function captureSelection (sel) {
    var range = sel.getRangeAt(0)
    var text = sel.toString().trim()
    var container = range.commonAncestorContainer
    var fullText = (container.textContent || '')
    var startOffset = fullText.indexOf(text)
    var prefix = fullText.substring(Math.max(0, startOffset - 30), startOffset)
    var suffix = fullText.substring(startOffset + text.length, startOffset + text.length + 30)

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

    var rect = range.getBoundingClientRect()
    return {
      text: text.substring(0, 200),
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
      <div class="_comments-input-options">
        <select class="_comments-input-tag" title="Tag (optional)">
          <option value="">— tag —</option>
          ${TAGS.map((t) => '<option value="' + t + '">' + t + '</option>').join('')}
        </select>
        <select class="_comments-input-severity" title="Severity (optional)">
          <option value="">— severity —</option>
          ${SEVERITIES.map((s) => '<option value="' + s + '">' + s + '</option>').join('')}
        </select>
        <label class="_comments-input-suggest-label">
          <input type="checkbox" class="_comments-input-suggest-toggle"> Suggest replacement
        </label>
      </div>
      <textarea class="_comments-input-suggestion" placeholder="Suggested replacement text..." rows="2" style="display:none"></textarea>
      <div class="_comments-input-actions">
        <button class="_comments-btn-save">Save (⌘↵)</button>
        <button class="_comments-btn-cancel">Cancel</button>
      </div>
    `

    var top = pendingSelection.rect.top + 30
    input.style.top = top + 'px'
    document.body.appendChild(input)

    var textarea = input.querySelector('._comments-input-textarea')
    var suggestionBox = input.querySelector('._comments-input-suggestion')
    var suggestToggle = input.querySelector('._comments-input-suggest-toggle')
    textarea.focus()

    suggestToggle.addEventListener('change', () => {
      suggestionBox.style.display = suggestToggle.checked ? 'block' : 'none'
      if (suggestToggle.checked) suggestionBox.focus()
    })

    input.querySelector('._comments-btn-save').addEventListener('click', () => {
      saveNewComment(input)
    })

    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveNewComment(input)
      }
      if (e.key === 'Escape') removeCommentInput()
    })
    suggestionBox.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveNewComment(input)
      }
      if (e.key === 'Escape') removeCommentInput()
    })

    input.querySelector('._comments-btn-cancel').addEventListener('click', removeCommentInput)
  }

  function saveNewComment (input) {
    var body = input.querySelector('._comments-input-textarea').value.trim()
    if (!body || !pendingSelection) return

    var tag = input.querySelector('._comments-input-tag').value || null
    var severity = input.querySelector('._comments-input-severity').value || null
    var suggestToggle = input.querySelector('._comments-input-suggest-toggle')
    var suggestion = suggestToggle.checked ? input.querySelector('._comments-input-suggestion').value.trim() : null

    var comment = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      anchor: {
        text: pendingSelection.text,
        prefix: pendingSelection.prefix,
        suffix: pendingSelection.suffix,
        heading: pendingSelection.heading
      },
      body: body,
      author: authorName || null,
      tag: tag,
      severity: severity,
      suggestion: suggestion || null,
      replies: [],
      createdAt: new Date().toISOString(),
      updatedAt: null,
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

  var anchoredIds = new Set()

  function renderHighlights () {
    document.querySelectorAll('mark._comment-highlight').forEach((el) => el.replaceWith(...el.childNodes))
    anchoredIds.clear()
    comments.forEach((comment) => {
      if (comment.resolved) return
      if (highlightText(comment)) {
        anchoredIds.add(comment.id)
      }
    })
  }

  function highlightText (comment) {
    var content = document.getElementById('_html') || document.getElementById('_markdown')
    if (!content) return false

    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null)
    var searchText = comment.anchor.text
    var node

    while ((node = walker.nextNode())) {
      var idx = node.textContent.indexOf(searchText)
      if (idx === -1) continue

      var parentText = node.parentElement.textContent || ''
      if (comment.anchor.prefix && !parentText.includes(comment.anchor.prefix + searchText)) {
        if (comment.anchor.suffix && !parentText.includes(searchText + comment.anchor.suffix)) {
          continue
        }
      }

      var range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, Math.min(idx + searchText.length, node.textContent.length))

      var mark = document.createElement('mark')
      mark.className = '_comment-highlight'
      if (comment.severity) mark.classList.add('_severity-' + comment.severity)
      mark.dataset.commentId = comment.id
      mark.addEventListener('click', () => {
        showSidebar()
        scrollSidebarTo(comment.id)
      })

      try { range.surroundContents(mark) } catch (e) { return false }
      return true
    }
    return false
  }

  // ─── KEYBOARD NAVIGATION ──────────────────────────────────────

  var navIndex = -1

  function navigateComment (direction) {
    var open = comments.filter((c) => !c.resolved)
    if (!open.length) return
    navIndex = (navIndex + direction + open.length) % open.length
    var c = open[navIndex]
    scrollToHighlight(c.id)
    showSidebar()
    scrollSidebarTo(c.id)
  }

  // ─── SIDEBAR ──────────────────────────────────────────────────

  function createSidebar () {
    var sidebar = document.createElement('div')
    sidebar.id = '_comments-sidebar'
    sidebar.innerHTML = `
      <div class="_comments-sidebar-header">
        <span class="_comments-title">Comments <span class="_comments-badge">0</span></span>
        <div class="_comments-sidebar-actions">
          <button class="_comments-btn-import" title="Import comments from a JSON file">⬆</button>
          <button class="_comments-btn-resolve-all" title="Resolve all comments">✓ All</button>
          <button class="_comments-btn-delete-all" title="Delete all comments">🗑 All</button>
          <button class="_comments-btn-export-json" title="Download comments as structured JSON data file">⬇ JSON</button>
          <button class="_comments-btn-export-md" title="Download markdown file with comments embedded as HTML comments">⬇ MD</button>
          <button class="_comments-btn-close" title="Close comments panel">✕</button>
        </div>
      </div>
      <div class="_comments-sidebar-filters">
        <input class="_comments-search" type="text" placeholder="Search comments..." title="Search comment text, tags, authors">
        <div class="_comments-filter-row">
          <select class="_comments-filter-status" title="Filter by status">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <select class="_comments-filter-tag" title="Filter by tag">
            <option value="all">All tags</option>
            ${TAGS.map((t) => '<option value="' + t + '">' + t + '</option>').join('')}
          </select>
          <select class="_comments-filter-severity" title="Filter by severity">
            <option value="all">All severity</option>
            ${SEVERITIES.map((s) => '<option value="' + s + '">' + s + '</option>').join('')}
          </select>
        </div>
      </div>
      <div class="_comments-sidebar-body"></div>
    `
    document.body.appendChild(sidebar)

    sidebar.querySelector('._comments-btn-close').addEventListener('click', hideSidebar)
    sidebar.querySelector('._comments-btn-export-json').addEventListener('click', exportCommentsJson)
    sidebar.querySelector('._comments-btn-export-md').addEventListener('click', exportCommentsMd)
    sidebar.querySelector('._comments-btn-import').addEventListener('click', importComments)
    sidebar.querySelector('._comments-btn-resolve-all').addEventListener('click', resolveAll)
    sidebar.querySelector('._comments-btn-delete-all').addEventListener('click', deleteAll)

    // Filters
    sidebar.querySelector('._comments-search').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase()
      renderSidebar()
    })
    sidebar.querySelector('._comments-filter-status').addEventListener('change', (e) => {
      filters.status = e.target.value
      renderSidebar()
    })
    sidebar.querySelector('._comments-filter-tag').addEventListener('change', (e) => {
      filters.tag = e.target.value
      renderSidebar()
    })
    sidebar.querySelector('._comments-filter-severity').addEventListener('change', (e) => {
      filters.severity = e.target.value
      renderSidebar()
    })
  }

  function createToggleButton () {
    var btn = document.createElement('button')
    btn.id = '_comments-toggle'
    btn.title = 'Toggle Comments Panel (Ctrl+] / Ctrl+[ to navigate)'
    btn.textContent = '💬'
    btn.addEventListener('click', toggleSidebar)
    document.body.appendChild(btn)
  }

  function toggleSidebar () { sidebarVisible ? hideSidebar() : showSidebar() }
  function showSidebar () { sidebarVisible = true; document.getElementById('_comments-sidebar').classList.add('_visible'); renderSidebar() }
  function hideSidebar () { sidebarVisible = false; document.getElementById('_comments-sidebar').classList.remove('_visible') }

  function getFilteredComments () {
    return comments.filter((c) => {
      if (filters.status === 'open' && c.resolved) return false
      if (filters.status === 'resolved' && !c.resolved) return false
      if (filters.tag !== 'all' && c.tag !== filters.tag) return false
      if (filters.severity !== 'all' && c.severity !== filters.severity) return false
      if (searchQuery) {
        var hay = [c.body, c.anchor.text, c.tag || '', c.author || '', c.suggestion || ''].join(' ').toLowerCase()
        if (!hay.includes(searchQuery)) return false
      }
      return true
    })
  }

  function renderSidebar () {
    var body = document.querySelector('#_comments-sidebar ._comments-sidebar-body')
    if (!body) return

    var filtered = getFilteredComments()

    if (comments.length === 0) {
      body.innerHTML = '<div class="_comments-empty">No comments yet.<br>Select text and click the 💬 tooltip,<br>or press <kbd>⌘⇧K</kbd> to add a comment.</div>'
      return
    }

    if (filtered.length === 0) {
      body.innerHTML = '<div class="_comments-empty">No comments match current filters.</div>'
      return
    }

    body.innerHTML = filtered.map((c) => {
      var isOrphan = !c.resolved && !anchoredIds.has(c.id)
      return `
      <div class="_comments-item ${c.resolved ? '_resolved' : ''} ${isOrphan ? '_orphan' : ''}" data-id="${c.id}">
        <div class="_comments-item-pills">
          ${isOrphan ? '<span class="_pill _pill-orphan" title="Anchor text not found in document">⚠️ unanchored</span>' : ''}
          ${c.tag ? '<span class="_pill _pill-tag _pill-' + c.tag + '">' + c.tag + '</span>' : ''}
          ${c.severity ? '<span class="_pill _pill-severity _pill-' + c.severity + '">' + c.severity + '</span>' : ''}
        </div>
        <div class="_comments-item-anchor" title="${escapeHtml(c.anchor.text)}">
          "${escapeHtml(c.anchor.text.substring(0, 60))}${c.anchor.text.length > 60 ? '…' : ''}"
        </div>
        ${isOrphan && c.anchor.heading ? '<div class="_comments-item-hint">Was near: ' + escapeHtml(c.anchor.heading) + '</div>' : ''}
        <div class="_comments-item-body">${linkify(escapeHtml(c.body))}</div>
        ${c.suggestion ? '<div class="_comments-item-suggestion"><span class="_suggestion-label">Suggestion:</span> <del>' + escapeHtml(c.anchor.text.substring(0, 80)) + '</del> → <ins>' + escapeHtml(c.suggestion.substring(0, 80)) + '</ins></div>' : ''}
        ${c.replies && c.replies.length ? '<div class="_comments-replies">' + c.replies.map((r) => '<div class="_comments-reply"><strong>' + escapeHtml(r.author || 'Anonymous') + ':</strong> ' + linkify(escapeHtml(r.body)) + ' <span class="_comments-reply-date">' + formatDate(r.createdAt) + '</span></div>').join('') + '</div>' : ''}
        <div class="_comments-item-meta">
          <span class="_comments-item-date">${c.author ? escapeHtml(c.author) + ' · ' : ''}${formatDate(c.createdAt)}</span>
          <span class="_comments-item-actions">
            <button class="_comments-btn-reply" data-id="${c.id}" title="Reply">↩</button>
            <button class="_comments-btn-edit" data-id="${c.id}" title="Edit">✎</button>
            ${c.resolved
              ? '<button class="_comments-btn-unresolve" data-id="' + c.id + '" title="Reopen">↺</button>'
              : '<button class="_comments-btn-resolve" data-id="' + c.id + '" title="Resolve">✓</button>'
            }
            <button class="_comments-btn-delete" data-id="${c.id}" title="Delete">✕</button>
          </span>
        </div>
      </div>
    `}).join('')

    // Event listeners
    body.querySelectorAll('._comments-btn-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); editComment(btn.dataset.id) })
    })
    body.querySelectorAll('._comments-btn-reply').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); replyToComment(btn.dataset.id) })
    })
    body.querySelectorAll('._comments-btn-resolve').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); resolveComment(btn.dataset.id) })
    })
    body.querySelectorAll('._comments-btn-unresolve').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); unresolveComment(btn.dataset.id) })
    })
    body.querySelectorAll('._comments-btn-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteComment(btn.dataset.id) })
    })
    body.querySelectorAll('._comments-item').forEach((el) => {
      el.addEventListener('click', () => {
        scrollToHighlight(el.dataset.id)
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
      // Force scroll by computing absolute position and scrolling directly
      var rect = mark.getBoundingClientRect()
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop
      var targetY = rect.top + scrollTop - (window.innerHeight / 2)
      window.scrollTo({top: targetY, behavior: 'smooth'})
      mark.classList.remove('_flash')
      void mark.offsetWidth // force reflow to restart animation
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

  function editComment (id) {
    var c = comments.find((c) => c.id === id)
    if (!c) return
    var item = document.querySelector(`._comments-item[data-id="${id}"]`)
    if (!item) return

    var bodyEl = item.querySelector('._comments-item-body')
    bodyEl.innerHTML = `
      <textarea class="_comments-edit-textarea">${escapeHtml(c.body)}</textarea>
      <div class="_comments-edit-actions">
        <button class="_comments-edit-save">Save</button>
        <button class="_comments-edit-cancel">Cancel</button>
      </div>
    `
    var textarea = bodyEl.querySelector('textarea')
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)

    bodyEl.querySelector('._comments-edit-save').addEventListener('click', () => {
      var v = textarea.value.trim()
      if (v) { c.body = v; c.updatedAt = new Date().toISOString(); saveComments() }
      renderSidebar()
    })
    bodyEl.querySelector('._comments-edit-cancel').addEventListener('click', () => renderSidebar())
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        var v = textarea.value.trim()
        if (v) { c.body = v; c.updatedAt = new Date().toISOString(); saveComments() }
        renderSidebar()
      }
      if (e.key === 'Escape') renderSidebar()
    })
  }

  function replyToComment (id) {
    var c = comments.find((c) => c.id === id)
    if (!c) return
    var item = document.querySelector(`._comments-item[data-id="${id}"]`)
    if (!item) return

    // Don't add multiple reply boxes
    if (item.querySelector('._comments-reply-input')) return

    var replyDiv = document.createElement('div')
    replyDiv.className = '_comments-reply-input'
    replyDiv.innerHTML = `
      <textarea class="_comments-reply-textarea" placeholder="Reply..." rows="2"></textarea>
      <div class="_comments-edit-actions">
        <button class="_comments-reply-save">Reply</button>
        <button class="_comments-reply-cancel">Cancel</button>
      </div>
    `
    item.appendChild(replyDiv)

    var textarea = replyDiv.querySelector('textarea')
    textarea.focus()

    replyDiv.querySelector('._comments-reply-save').addEventListener('click', () => {
      var v = textarea.value.trim()
      if (v) {
        if (!c.replies) c.replies = []
        c.replies.push({
          id: 'r_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          author: authorName || null,
          body: v,
          createdAt: new Date().toISOString()
        })
        saveComments()
      }
      renderSidebar()
    })
    replyDiv.querySelector('._comments-reply-cancel').addEventListener('click', () => renderSidebar())
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        var v = textarea.value.trim()
        if (v) {
          if (!c.replies) c.replies = []
          c.replies.push({
            id: 'r_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            author: authorName || null,
            body: v,
            createdAt: new Date().toISOString()
          })
          saveComments()
        }
        renderSidebar()
      }
      if (e.key === 'Escape') renderSidebar()
    })
  }

  function deleteComment (id) {
    comments = comments.filter((c) => c.id !== id)
    saveComments(); renderHighlights(); renderSidebar()
  }

  function resolveAll () {
    if (!comments.some((c) => !c.resolved)) return
    comments.forEach((c) => { c.resolved = true })
    saveComments(); renderHighlights(); renderSidebar()
  }

  function deleteAll () {
    if (!comments.length) return
    if (!confirm('Delete all ' + comments.length + ' comment(s)?')) return
    comments = []
    saveComments(); renderHighlights(); renderSidebar()
  }

  // ─── IMPORT / EXPORT ──────────────────────────────────────────

  function importComments () {
    var input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.addEventListener('change', (e) => {
      var file = e.target.files[0]
      if (!file) return
      var reader = new FileReader()
      reader.onload = () => {
        try {
          var data = JSON.parse(reader.result)
          var imported = data.comments || data
          if (!Array.isArray(imported)) { alert('Invalid comments file'); return }

          var mode = comments.length > 0
            ? confirm('Merge with existing comments?\n\nOK = Merge\nCancel = Replace all')
            : true

          if (mode) {
            // Merge — skip duplicates by ID
            var existingIds = new Set(comments.map((c) => c.id))
            var newOnes = imported.filter((c) => !existingIds.has(c.id))
            comments = comments.concat(newOnes)
          } else {
            comments = imported
          }

          saveComments()
          renderHighlights()
          renderSidebar()
        } catch (err) {
          alert('Failed to parse file: ' + err.message)
        }
      }
      reader.readAsText(file)
    })
    input.click()
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
    var filename = baseFilename.replace(/\.md$/i, '') + '.commented.md'
    chrome.runtime.sendMessage({
      message: 'comments.export-md',
      url: pageUrl,
      filename: filename,
      comments: comments
    })
  }

  // ─── BADGE ────────────────────────────────────────────────────

  function updateBadge () {
    var count = comments.filter((c) => !c.resolved).length
    var badge = document.querySelector('._comments-badge')
    if (badge) {
      badge.textContent = count
      badge.style.display = count > 0 ? 'inline' : 'none'
    }
    var toggle = document.getElementById('_comments-toggle')
    if (toggle) {
      toggle.textContent = count > 0 ? `💬 ${count}` : '💬'
    }
    // Extension icon badge
    chrome.runtime.sendMessage({message: 'comments.badge', count: count})
  }

  // ─── UTILITIES ────────────────────────────────────────────────

  function escapeHtml (str) {
    return (str || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]))
  }

  function linkify (html) {
    return html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
  }

  function formatDate (iso) {
    if (!iso) return ''
    var d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
  }

  // ─── BOOT ─────────────────────────────────────────────────────

  var bootInterval = setInterval(() => {
    if (document.getElementById('_html') || document.getElementById('_markdown')) {
      clearInterval(bootInterval)
      init()
    }
  }, 100)
})()
