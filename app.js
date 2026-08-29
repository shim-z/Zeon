(function() {
  const STORAGE_KEY = 'rabt-pro-links-v2';
  const SETTINGS_KEY = 'rabt-pro-settings-v2';
  
  let state = loadState();
  let settings = loadSettings();
  let currentLinkIndex = 0;
  let awaitingLinkId = null;
  let pendingFile = null;
  let lastProcessedId = null;
  let sessionActive = false;

  // Initialize
  init();

  function init() {
    // Theme
    applyTheme();
    
    // Navigation
    setupNavigation();
    
    // Event listeners
    setupEvents();
    
    // Render
    render();
    renderLibrary();
    
    // Load settings into UI
    document.getElementById('defaultWhatsApp').value = settings.defaultWhatsApp;
    
    // Check for installed PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // State Management
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
        links: [],
        oldLinks: [],
        cursor: 0
      };
    } catch(e) {
      return { links: [], oldLinks: [], cursor: 0 };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
        defaultWhatsApp: 'whatsapp',
        importDays: 30,
        theme: 'light',
        lang: 'en'
      };
    } catch(e) {
      return { defaultWhatsApp: 'whatsapp', importDays: 30, theme: 'light', lang: 'en' };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // Navigation
  function setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        
        btn.classList.add('active');
        const section = btn.dataset.nav;
        
        if (section === 'import') {
          document.getElementById('importSection').classList.add('active');
        } else if (section === 'library') {
          document.getElementById('librarySection').classList.add('active');
          renderLibrary();
        } else if (section === 'settings') {
          document.getElementById('settingsSection').classList.add('active');
        } else {
          document.getElementById('queueSection').classList.add('active');
        }
      });
    });
  }

  // Event Setup
  function setupEvents() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      settings.theme = settings.theme === 'light' ? 'dark' : 'light';
      saveSettings();
      applyTheme();
    });

    // Language
    document.getElementById('langToggle').addEventListener('click', () => {
      settings.lang = settings.lang === 'en' ? 'ar' : 'en';
      saveSettings();
      applyLanguage();
    });

    // Open link
    document.getElementById('openLinkBtn').addEventListener('click', openCurrentLink);

    // Valid / Avoided buttons
    document.getElementById('validBtn').addEventListener('click', () => {
      classifyCurrentLink('valid');
    });

    document.getElementById('avoidedBtn').addEventListener('click', () => {
      classifyCurrentLink('avoided');
    });

    // Undo
    document.getElementById('undoBtn').addEventListener('click', undoLast);

    // Quick Actions
    document.getElementById('startSessionBtn').addEventListener('click', startSession);
    document.getElementById('exportValidBtn').addEventListener('click', exportValidLinks);
    document.getElementById('deleteExpiredBtn').addEventListener('click', deleteByStatus('expired'));
    document.getElementById('deleteAvoidedBtn').addEventListener('click', deleteByStatus('avoided'));

    // File import
    setupFileImport();

    // Date filter
    document.getElementById('dateFilter').addEventListener('change', (e) => {
      settings.importDays = e.target.value === 'all' ? Infinity : parseInt(e.target.value);
      saveSettings();
    });

    // WhatsApp selector
    setupWhatsAppSelector();

    // Library filters
    document.getElementById('searchBox').addEventListener('input', renderLibrary);
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.style.background = 'var(--panel)');
        btn.style.background = 'var(--primary)';
        btn.style.color = 'white';
        currentFilter = btn.dataset.filter;
        renderLibrary();
      });
    });

    // Clear all
    document.getElementById('clearAllBtn').addEventListener('click', clearAllData);

    // Visibility change for auto-advance
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Swipe gestures
    setupSwipeGestures();

    // Service worker messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }
  }

  // Core Functions
  function getNextPendingIndex() {
    const n = state.links.length;
    if (!n) return -1;
    for (let i = 0; i < n; i++) {
      const idx = (state.cursor + i) % n;
      if (state.links[idx].status === 'pending') return idx;
    }
    return -1;
  }

  function render() {
    // Update stats
    const counts = { pending: 0, valid: 0, expired: 0, avoided: 0 };
    state.links.forEach(l => {
      counts[l.status] = (counts[l.status] || 0) + 1;
    });
    
    document.getElementById('pendingCount').textContent = counts.pending;
    document.getElementById('validCount').textContent = counts.valid;
    document.getElementById('expiredCount').textContent = counts.expired;
    document.getElementById('avoidedCount').textContent = counts.avoided;
    
    // Update queue badge
    const badge = document.getElementById('queueBadge');
    if (counts.pending > 0) {
      badge.style.display = 'block';
      badge.textContent = counts.pending;
    } else {
      badge.style.display = 'none';
    }
    
    // Render current queue
    renderQueue();
  }

  function renderQueue() {
    const idx = getNextPendingIndex();
    
    if (idx === -1) {
      document.getElementById('currentLink').textContent = 'No pending links';
      document.getElementById('queuePosition').textContent = 'All done!';
      document.getElementById('linkMeta').textContent = 'Add more links or check the library';
      document.getElementById('decisionActions').style.display = 'none';
      document.getElementById('undoBtn').style.display = 'none';
      
      // Auto-end session
      if (sessionActive) {
        sessionActive = false;
        showToast('Session complete!');
      }
      return;
    }
    
    const link = state.links[idx];
    currentLinkIndex = idx;
    
    document.getElementById('currentLink').textContent = link.url;
    document.getElementById('queuePosition').textContent = `Link ${idx + 1} of ${state.links.length}`;
    document.getElementById('linkMeta').textContent = link.tag ? `Tag: ${link.tag}` : 'No tag';
    
    // Show decision buttons only when session is active
    if (sessionActive) {
      document.getElementById('decisionActions').style.display = 'flex';
    } else {
      document.getElementById('decisionActions').style.display = 'none';
    }
    
    // Show undo button if available
    if (lastProcessedId) {
      document.getElementById('undoBtn').style.display = 'block';
    } else {
      document.getElementById('undoBtn').style.display = 'none';
    }
  }

  function openCurrentLink() {
    const idx = getNextPendingIndex();
    if (idx === -1) return;
    
    const link = state.links[idx];
    
    // Open in selected WhatsApp
    openInWhatsApp(link.url);
    
    // Set awaiting ID for auto-classification
    awaitingLinkId = link.id;
    
    // Start auto-timer
    startAutoClassificationTimer();
  }

  function openInWhatsApp(url) {
    let intentUrl = url;
    
    switch (settings.defaultWhatsApp) {
      case 'business':
        intentUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(url)}`;
        break;
      case 'dual':
        // For dual WhatsApp, use a custom scheme (works on some Android versions)
        intentUrl = `whatsapp://send?text=${encodeURIComponent(url)}`;
        break;
      case 'ask':
        // Show modal
        document.getElementById('whatsAppModal').classList.add('show');
        pendingOpenUrl = url;
        return;
    }
    
    window.open(intentUrl, '_blank');
  }

  function classifyCurrentLink(status) {
    const idx = getNextPendingIndex();
    if (idx === -1) return;
    
    const link = state.links[idx];
    const previousStatus = link.status;
    
    link.status = status;
    link.lastProcessed = Date.now();
    lastProcessedId = link.id;
    
    state.cursor = (idx + 1) % state.links.length;
    
    saveState();
    render();
    renderLibrary();
    
    // Show undo
    document.getElementById('undoBtn').style.display = 'block';
    
    showToast(status === 'valid' ? 'Marked as Valid' : 'Marked as Avoided');
  }

  function startSession() {
    const idx = getNextPendingIndex();
    if (idx === -1) {
      showToast('No pending links to process');
      return;
    }
    
    sessionActive = true;
    renderQueue();
    showToast('Session started! Open links to process');
  }

  function undoLast() {
    if (!lastProcessedId) return;
    
    const link = state.links.find(l => l.id === lastProcessedId);
    if (link) {
      link.status = 'pending';
      state.cursor = state.links.findIndex(l => l.id === lastProcessedId);
    }
    
    lastProcessedId = null;
    saveState();
    render();
    renderLibrary();
    showToast('Undone');
  }

  function exportValidLinks() {
    const validLinks = state.links.filter(l => l.status === 'valid');
    
    if (!validLinks.length) {
      showToast('No valid links to export');
      return;
    }
    
    const text = validLinks.map(l => l.url).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied ${validLinks.length} valid links`);
    }).catch(() => {
      showToast('Failed to copy');
    });
  }

  function deleteByStatus(status) {
    const count = state.links.filter(l => l.status === status).length;
    
    if (!count) {
      showToast(`No ${status} links to delete`);
      return;
    }
    
    if (confirm(`Delete ${count} ${status} links?`)) {
      state.links = state.links.filter(l => l.status !== status);
      saveState();
      render();
      renderLibrary();
      showToast(`Deleted ${count} links`);
    }
  }

  // File Import
  function setupFileImport() {
    const fileInput = document.getElementById('fileInput');
    const fileDrop = document.getElementById('fileDrop');
    const importBtn = document.getElementById('importBtn');
    
    fileDrop.addEventListener('click', () => fileInput.click());
    fileDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileDrop.style.borderColor = 'var(--primary)';
    });
    fileDrop.addEventListener('dragleave', () => {
      fileDrop.style.borderColor = 'var(--border)';
    });
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.style.borderColor = 'var(--border)';
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    
    importBtn.addEventListener('click', processImport);
  }

  async function handleFile(file) {
    const importStatus = document.getElementById('importStatus');
    importStatus.textContent = 'Processing...';
    
    try {
      const text = await readFileAsText(file);
      pendingFile = { name: file.name, text };
      importStatus.textContent = `✅ ${file.name}`;
      document.getElementById('importBtn').disabled = false;
    } catch (err) {
      console.error(err);
      importStatus.textContent = '❌ Error';
      pendingFile = null;
    }
  }

  async function processImport() {
    if (!pendingFile) return;
    
    const importStatus = document.getElementById('importStatus');
    importStatus.textContent = 'Importing...';
    
    try {
      const links = extractLinksWithContext(pendingFile.text);
      const cutoff = Date.now() - (settings.importDays * 24 * 60 * 60 * 1000);
      
      let added = 0, duplicates = 0, old = 0;
      
      links.forEach(linkData => {
        const linkDate = linkData.date || Date.now();
        
        if (linkDate < cutoff) {
          old++;
          state.oldLinks.push(linkData.url);
          return;
        }
        
        const result = addLink(linkData.url, pendingFile.name, linkData.context);
        if (result === 'added') added++;
        else if (result === 'duplicate') duplicates++;
      });
      
      saveState();
      render();
      renderLibrary();
      
      importStatus.textContent = `✅ ${added} added, ${duplicates} dup, ${old} old`;
      showToast(`Added ${added} links`);
      
      // Reset
      pendingFile = null;
      document.getElementById('fileInput').value = '';
      document.getElementById('importBtn').disabled = true;
    } catch (err) {
      console.error(err);
      importStatus.textContent = '❌ Import failed';
    }
  }

  async function readFileAsText(file) {
    const name = file.name.toLowerCase();
    
    if (name.endsWith('.txt') || file.type === 'text/plain') {
      return await file.text();
    }
    
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      return await extractPdfText(file);
    }
    
    if (name.endsWith('.docx')) {
      return await extractDocxText(file);
    }
    
    return await file.text();
  }

  async function extractPdfText(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let full = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      full += content.items.map(it => it.str).join(' ') + '\n';
    }
    
    return full;
  }

  async function extractDocxText(file) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || '';
  }

  // Link Processing
  function extractLinksWithContext(text) {
    const re = /(https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+|https?:\/\/wa\.me\/[A-Za-z0-9]+)/gi;
    const matches = [...text.matchAll(re)];
    
    return matches.map(match => {
      const url = match[0];
      const start = match.index;
      
      // Get context around the link
      const contextStart = Math.max(0, start - 100);
      const contextEnd = Math.min(text.length, start + url.length + 100);
      const context = text.slice(contextStart, contextEnd);
      
      // Try to find date in context
      const dateMatch = context.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
      let date = null;
      
      if (dateMatch) {
        const parts = dateMatch[1].split(/[\/\-.]/);
        if (parts.length === 3) {
          date = new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        }
      }
      
      return { url, context, date };
    });
  }

  function addLink(url, tag, context) {
    url = url.trim();
    
    // Check duplicate
    if (state.links.some(l => l.url === url)) {
      return 'duplicate';
    }
    
    state.links.push({
      id: 'l' + Date.now() + Math.random().toString(36).slice(2, 7),
      url: url,
      tag: tag || '',
      status: 'pending',
      added: Date.now(),
      context: context || ''
    });
    
    return 'added';
  }

  // WhatsApp Selection
  function setupWhatsAppSelector() {
    document.querySelectorAll('.wa-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('.wa-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        settings.defaultWhatsApp = option.dataset.wa;
        saveSettings();
      });
    });
    
    // Load saved selection
    const selected = document.querySelector(`.wa-option[data-wa="${settings.defaultWhatsApp}"]`);
    if (selected) selected.classList.add('selected');
  }

  // Auto-classification on return
  function startAutoClassificationTimer() {
    // Store start time when link is opened
    localStorage.setItem('linkOpenedAt', Date.now());
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && awaitingLinkId) {
      const openedAt = parseInt(localStorage.getItem('linkOpenedAt') || Date.now());
      const elapsed = Date.now() - openedAt;
      
      const link = state.links.find(l => l.id === awaitingLinkId);
      
      if (link && link.status === 'pending') {
        // Auto-classify based on time
        if (elapsed < 5000) {
          // Too short - likely didn't open properly
          showToast('Link may not have opened. Try again?');
        } else if (elapsed >= 5000 && elapsed < 120000) {
          // Reasonable time - assume valid
          link.status = 'valid';
          link.lastProcessed = Date.now();
          lastProcessedId = link.id;
          state.cursor = (state.links.findIndex(l => l.id === link.id) + 1) % state.links.length;
          saveState();
          render();
          renderLibrary();
          showToast('Auto-marked as Valid');
        }
        // If > 2 minutes, don't auto-mark
      }
      
      awaitingLinkId = null;
      localStorage.removeItem('linkOpenedAt');
    }
  }

  // Swipe Gestures
  function setupSwipeGestures() {
    const container = document.getElementById('swipeContainer');
    const content = document.getElementById('swipeContent');
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    
    content.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isDragging = true;
      currentX = startX;
      content.style.transition = 'none';
    });
    
    content.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      currentX = e.touches[0].clientX;
      const diff = currentX - startX;
      content.style.transform = `translateX(${diff}px)`;
      
      // Show background
      const bg = document.querySelectorAll('.swipe-bg');
      const opacity = Math.min(Math.abs(diff) / 100, 1);
      bg[0].style.opacity = diff > 0 ? opacity : 0;
      bg[1].style.opacity = diff < 0 ? opacity : 0;
    });
    
    content.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;
      
      const diff = currentX - startX;
      content.style.transition = 'transform 0.3s';
      
      if (Math.abs(diff) > 80) {
        if (diff > 0) {
          // Swipe right - Valid
          classifyCurrentLink('valid');
        } else {
          // Swipe left - Avoided
          classifyCurrentLink('avoided');
        }
      }
      
      content.style.transform = 'translateX(0)';
      document.querySelectorAll('.swipe-bg').forEach(bg => bg.style.opacity = 0);
    });
  }

  // Service Worker Message
  function handleSWMessage(event) {
    if (event.data && event.data.type === 'advance' && event.data.linkId) {
      const link = state.links.find(l => l.id === event.data.linkId);
      if (link && link.status === 'pending') {
        link.status = 'valid';
        lastProcessedId = link.id;
        saveState();
        render();
        renderLibrary();
      }
    }
  }

  // Theme
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.getElementById('themeToggle').textContent = settings.theme === 'light' ? '🌙' : '☀️';
  }

  // Language
  function applyLanguage() {
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('langToggle').textContent = settings.lang === 'en' ? '🌐' : '🌐';
    // Update UI texts if needed
  }

  // Modal
  function openInSelected(whatsapp) {
    if (pendingOpenUrl) {
      window.open(pendingOpenUrl, '_blank');
      pendingOpenUrl = null;
    }
    closeModal();
  }

  function closeModal() {
    document.getElementById('whatsAppModal').classList.remove('show');
  }

  // Library
  let currentFilter = 'all';

  function renderLibrary() {
    const search = (document.getElementById('searchBox').value || '').toLowerCase();
    let items = state.links.slice().sort((a, b) => b.added - a.added);
    
    if (currentFilter !== 'all') {
      items = items.filter(l => l.status === currentFilter);
    }
    
    if (search) {
      items = items.filter(l => l.url.toLowerCase().includes(search) || (l.tag || '').toLowerCase().includes(search));
    }
    
    const list = document.getElementById('libraryList');
    
    if (!items.length) {
      list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-soft);">No links found</div>';
      return;
    }
    
    const statusIcons = {
      pending: '⏳',
      valid: '✅',
      expired: '❌',
      avoided: '🚫'
    };
    
    list.innerHTML = items.map(l => `
      <div class="link-item">
        <div class="status-icon ${l.status}">${statusIcons[l.status] || '•'}</div>
        <div class="link-info">
          <div class="link-url">${l.url}</div>
          <div class="link-meta">
            ${l.tag ? `🏷 ${l.tag} · ` : ''}${new Date(l.added).toLocaleDateString()}
          </div>
        </div>
        <div class="item-actions">
          <button class="action-btn delete" onclick="deleteLink('${l.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  }

  // Clear All
  function clearAllData() {
    if (confirm('Clear all data? This cannot be undone.')) {
      state = { links: [], oldLinks: [], cursor: 0 };
      saveState();
      render();
      renderLibrary();
      showToast('All data cleared');
    }
  }

  // Utility
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // Export functions globally
  window.deleteLink = function(id) {
    state.links = state.links.filter(l => l.id !== id);
    saveState();
    render();
    renderLibrary();
  };
})();