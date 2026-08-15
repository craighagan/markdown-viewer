md.comments = ({storage: {state}}) => {

  // Register context menu
  chrome.contextMenus.create({
    id: 'markdown-viewer-add-comment',
    title: 'Add Comment',
    contexts: ['selection'],
    documentUrlPatterns: ['file:///*']
  })

  // Handle context menu click
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'markdown-viewer-add-comment') {
      chrome.tabs.sendMessage(tab.id, {
        message: 'comments.add-from-menu',
        selectionText: info.selectionText
      })
    }
  })

  // Handle comment storage messages
  return (req, sender, sendResponse) => {
    if (req.message === 'comments.load') {
      var key = 'comments:' + req.url
      chrome.storage.local.get(key, (res) => {
        sendResponse({comments: res[key] || []})
      })
      return true
    }

    else if (req.message === 'comments.save') {
      var key = 'comments:' + req.url
      chrome.storage.local.set({[key]: req.comments}, () => {
        sendResponse({ok: true})
      })
      return true
    }

    else if (req.message === 'comments.export') {
      var key = 'comments:' + req.url
      chrome.storage.local.get(key, (res) => {
        var comments = res[key] || []
        var filename = req.filename || 'comments.json'

        var exportData = {
          version: 1,
          source: req.url,
          exportedAt: new Date().toISOString(),
          comments: comments
        }

        // Create a data URL and trigger download
        var json = JSON.stringify(exportData, null, 2)
        var blob = new Blob([json], {type: 'application/json'})
        var reader = new FileReader()
        reader.onload = () => {
          chrome.downloads.download({
            url: reader.result,
            filename: filename,
            saveAs: true
          }, () => {
            sendResponse({ok: true})
          })
        }
        reader.readAsDataURL(blob)
      })
      return true
    }

    else if (req.message === 'comments.clear') {
      var key = 'comments:' + req.url
      chrome.storage.local.remove(key, () => {
        sendResponse({ok: true})
      })
      return true
    }
  }
}
