/* FLIPBOOK STUDIO - Local-first flipbook application */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const DB_NAME = 'FlipbookStudioDB';
  const DB_VERSION = 1;
  let db;
  let books = [];
  let draft = null;
  let editingId = null;
  let activeBook = null;
  let pageFlip = null;
  let readerModePortrait = true;
  let soundEnabled = true;
  let zoom = 1;
  let coverActive = true;
  let backCoverActive = false;
  let confirmAction = null;
  let dragPageIndex = null;

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('books', { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { db = request.result; resolve(db); };
    });
  }

  function dbRequest(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const getAllBooks = () => dbRequest('books', 'readonly', store => store.getAll());
  const putBook = book => dbRequest('books', 'readwrite', store => store.put(book));
  const deleteBook = id => dbRequest('books', 'readwrite', store => store.delete(id));

  // ---------- UI helpers ----------
  function toast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('#toastWrap').appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function showLoader(show, text = 'Memproses…') {
    $('#globalLoaderText').textContent = text;
    $('#globalLoader').hidden = !show;
  }

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp));
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function setView(viewName) {
    $$('.view').forEach(view => view.hidden = view.id !== `view-${viewName}`);
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));
    const titles = {
      dashboard: ['Dashboard', 'Ringkasan aktivitas flipbook Anda'],
      library: ['Koleksi Buku', 'Kelola perpustakaan digital Anda'],
      create: [editingId ? 'Edit Flipbook' : 'Buat Flipbook Baru', 'Unggah, atur, dan publikasikan dokumen'],
      guide: ['Panduan', 'Cara menggunakan FLIPBOOK STUDIO']
    };
    $('#viewTitle').textContent = titles[viewName][0];
    $('#viewSub').textContent = titles[viewName][1];
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');
  }

  function openModal(modalId) {
    $('#modalBackdrop').hidden = false;
    $$('.modal').forEach(modal => modal.hidden = modal.id !== modalId);
  }

  function closeModal() {
    $('#modalBackdrop').hidden = true;
    $$('.modal').forEach(modal => modal.hidden = true);
  }

  function confirmDelete(title, text, action) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    confirmAction = action;
    openModal('confirmModal');
  }

  // ---------- Navigation ----------
  $$('.nav-item').forEach(item => item.addEventListener('click', event => {
    event.preventDefault();
    if (item.dataset.view === 'create') startCreate();
    else setView(item.dataset.view);
  }));
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.goto === 'create') startCreate();
    else setView(button.dataset.goto);
  }));
  $('#btnNewBook').addEventListener('click', () => startCreate());
  $('#btnBurger').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sidebarBackdrop').classList.toggle('show');
  });
  $('#sidebarBackdrop').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');
  });
  $('#btnTheme').addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem('flipTheme', document.body.classList.contains('light') ? 'light' : 'dark');
  });
  if (localStorage.getItem('flipTheme') === 'light') document.body.classList.add('light');

  // ---------- Dashboard & library ----------
  function renderStats() {
    const pages = books.reduce((sum, book) => sum + (book.pages?.length || 0), 0);
    const marks = books.reduce((sum, book) => sum + (book.bookmarks?.length || 0), 0);
    const history = JSON.parse(localStorage.getItem('flipHistory') || '[]');
    $('#statBooks').textContent = books.length;
    $('#statPages').textContent = pages;
    $('#statOpened').textContent = history.length;
    $('#statMarks').textContent = marks;
  }

  function coverFor(book) {
    const index = Number.isInteger(book.coverFront) ? book.coverFront : 0;
    return book.pages?.[index] || book.pages?.[0] || '';
  }

  function renderBookCard(book) {
    const cover = coverFor(book);
    return `<article class="book-card">
      <div class="book-cover">${cover ? `<img src="${cover}" alt="${escapeHTML(book.title)}">` : '<span class="cover-placeholder">📖</span>'}</div>
      <div class="book-info">
        <h4 title="${escapeHTML(book.title)}">${escapeHTML(book.title)}</h4>
        <div class="book-meta"><span>${book.pages?.length || 0} halaman</span><span>·</span><span>${formatDate(book.createdAt)}</span></div>
        <div class="book-actions">
          <button class="btn btn-primary" data-read="${book.id}">Baca</button>
          <button class="btn btn-ghost" data-edit="${book.id}">Edit</button>
          <button class="btn btn-ghost" data-share="${book.id}" title="Bagikan">↗</button>
          <button class="btn btn-ghost" data-delete="${book.id}" title="Hapus">🗑</button>
        </div>
      </div>
    </article>`;
  }

  function renderDashboard() {
    renderStats();
    const recent = [...books].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    $('#dashEmpty').hidden = recent.length > 0;
    $('#dashGrid').innerHTML = recent.map(renderBookCard).join('');

    const history = JSON.parse(localStorage.getItem('flipHistory') || '[]');
    const historyItems = history.slice(0, 5).map(item => {
      const book = books.find(value => value.id === item.id);
      if (!book) return '';
      const cover = coverFor(book);
      return `<div class="history-item" data-read="${book.id}">
        <div class="h-cover">${cover ? `<img src="${cover}" alt="">` : ''}</div>
        <div class="h-info"><h5>${escapeHTML(book.title)}</h5><small>Halaman ${item.page || 1} · ${formatDate(item.openedAt)}</small></div>
        <button class="icon-btn">→</button>
      </div>`;
    }).join('');
    $('#historyList').innerHTML = historyItems || '<p class="hint">Belum ada riwayat membaca.</p>';
  }

  function renderLibrary() {
    const query = $('#libSearch').value.trim().toLowerCase();
    const sort = $('#libSort').value;
    let filtered = books.filter(book => book.title.toLowerCase().includes(query));
    filtered.sort((a, b) => {
      if (sort === 'old') return a.createdAt - b.createdAt;
      if (sort === 'az') return a.title.localeCompare(b.title);
      if (sort === 'za') return b.title.localeCompare(a.title);
      if (sort === 'pages') return (b.pages?.length || 0) - (a.pages?.length || 0);
      return b.createdAt - a.createdAt;
    });
    $('#libEmpty').hidden = filtered.length > 0;
    $('#libGrid').innerHTML = filtered.map(renderBookCard).join('');
  }

  $('#libSearch').addEventListener('input', renderLibrary);
  $('#libSort').addEventListener('change', renderLibrary);

  document.addEventListener('click', event => {
    const readButton = event.target.closest('[data-read]');
    if (readButton) openReader(readButton.dataset.read);
    const editButton = event.target.closest('[data-edit]');
    if (editButton) startEdit(editButton.dataset.edit);
    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) {
      const book = books.find(value => value.id === deleteButton.dataset.delete);
      if (book) confirmDelete('Hapus Flipbook?', `“${book.title}” akan dihapus permanen dari perangkat ini.`, async () => {
        await deleteBook(book.id);
        books = books.filter(value => value.id !== book.id);
        renderAll();
        toast('Flipbook berhasil dihapus.', 'success');
      });
    }
    const shareButton = event.target.closest('[data-share]');
    if (shareButton) openShareModal(shareButton.dataset.share);
  });

  $('#confirmYes').addEventListener('click', async () => {
    closeModal();
    if (confirmAction) await confirmAction();
    confirmAction = null;
  });
  $('#confirmNo').addEventListener('click', () => { confirmAction = null; closeModal(); });
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  $('#modalBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });

  // ---------- Create / edit ----------
  function emptyDraft() {
    return { title: '', author: '', description: '', pages: [], pageNames: [], coverFront: 0, coverBack: null,
      bgColor: '#0b1020', accent: '#7c5cff', size: 'a4', speed: 900, transition: 'realistic', mode: 'night', visibility: 'private',
      originalPdf: null, toc: [] };
  }

  function startCreate() {
    editingId = null;
    draft = emptyDraft();
    const saved = localStorage.getItem('flipDraft');
    if (saved) {
      try { draft = { ...draft, ...JSON.parse(saved) }; } catch (_) {}
    }
    populateCreateForm();
    setView('create');
  }

  function startEdit(id) {
    const book = books.find(value => value.id === id);
    if (!book) return;
    editingId = id;
    draft = JSON.parse(JSON.stringify(book));
    populateCreateForm();
    setView('create');
  }

  function populateCreateForm() {
    $('#createStepTitle').textContent = editingId ? '1 · Edit Dokumen' : '1 · Unggah Dokumen';
    $('#fTitle').value = draft.title || '';
    $('#fAuthor').value = draft.author || '';
    $('#fDesc').value = draft.description || '';
    $('#fBgColor').value = draft.bgColor || '#0b1020';
    $('#fAccent').value = draft.accent || '#7c5cff';
    $('#fSize').value = draft.size || 'a4';
    $('#fSpeed').value = String(draft.speed || 900);
    $('#fTransition').value = draft.transition || 'realistic';
    $('#fMode').value = draft.mode || 'night';
    $('#fVisibility').value = draft.visibility || 'private';
    renderPageEditor();
    updateSaveEnabled();
  }

  function collectForm() {
    draft.title = $('#fTitle').value.trim();
    draft.author = $('#fAuthor').value.trim();
    draft.description = $('#fDesc').value.trim();
    draft.bgColor = $('#fBgColor').value;
    draft.accent = $('#fAccent').value;
    draft.size = $('#fSize').value;
    draft.speed = Number($('#fSpeed').value);
    draft.transition = $('#fTransition').value;
    draft.mode = $('#fMode').value;
    draft.visibility = $('#fVisibility').value;
  }

  function autosaveDraft() {
    collectForm();
    try {
      const metadata = { ...draft, pages: [], pageNames: [], originalPdf: null };
      localStorage.setItem('flipDraft', JSON.stringify(metadata));
    } catch (_) {
      // Data buku tetap aman di IndexedDB saat proses simpan dijalankan.
    }
  }

  ['#fTitle','#fAuthor','#fDesc','#fBgColor','#fAccent','#fSize','#fSpeed','#fTransition','#fMode','#fVisibility'].forEach(selector => {
    $(selector).addEventListener('input', () => { autosaveDraft(); updateSaveEnabled(); });
    $(selector).addEventListener('change', () => { autosaveDraft(); updateSaveEnabled(); });
  });

  function updateSaveEnabled() {
    $('#btnSaveBook').disabled = !(draft?.pages?.length);
  }

  $('#btnCancelCreate').addEventListener('click', () => {
    localStorage.removeItem('flipDraft');
    draft = emptyDraft();
    editingId = null;
    setView('dashboard');
  });

  $('#btnPickFiles').addEventListener('click', event => {
    event.stopPropagation();
    $('#fileInput').click();
  });
  $('#dropZone').addEventListener('click', event => {
    if (event.target === $('#dropZone') || event.target.closest('.dz-ico, h4, p')) $('#fileInput').click();
  });
  const dropZone = $('#dropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); }));
  dropZone.addEventListener('drop', event => handleFiles([...event.dataTransfer.files]));
  $('#fileInput').addEventListener('change', event => handleFiles([...event.target.files]));

  async function handleFiles(files) {
    if (!files.length) return;
    if (!draft) draft = emptyDraft();
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const invalid = files.filter(file => !allowed.includes(file.type) && !/\.(pdf|jpe?g|png|webp)$/i.test(file.name));
    if (invalid.length) {
      $('#uploadError').hidden = false;
      $('#uploadError').textContent = `Format tidak didukung: ${invalid.map(file => file.name).join(', ')}`;
      return;
    }
    $('#uploadError').hidden = true;
    $('#uploadProgressWrap').hidden = false;
    showProgress(0, 'Memproses dokumen…');

    if (draft?.pages?.length && !editingId) {
      // Keep existing draft pages; uploads append rather than replacing.
    }

    try {
      const pdfjs = window.pdfjsLib;
      if (pdfjs) pdfjs.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
      const allPages = draft?.pages ? [...draft.pages] : [];
      const allNames = draft?.pageNames ? [...draft.pageNames] : [];

      const processedNames = [];
      let failedCount = 0;
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        showProgress(Math.round(index / files.length * 85), `Memproses ${file.name}…`);
        try {
        if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          const pdfPages = await renderPDF(file);
          allPages.push(...pdfPages.images);
          allNames.push(...pdfPages.images.map((_, i) => `${file.name} · Halaman ${i + 1}`));
          if (!draft.toc?.length) draft.toc = pdfPages.toc || [];
          draft.originalPdf = await blobToDataURL(file);
        } else {
          const image = await resizeImageFile(file);
          allPages.push(image);
          allNames.push(file.name);
        }
        processedNames.push(file.name);
        } catch (fileError) {
          failedCount++;
          console.error(`Gagal memproses ${file.name}:`, fileError);
        }
        showProgress(Math.round((index + 1) / files.length * 100), `Selesai: ${file.name}`);
      }

      if (!processedNames.length) {
        throw new Error('Tidak ada file yang berhasil diproses. Pastikan PDF atau gambar tidak rusak.');
      }

      draft.pages = allPages;
      draft.pageNames = allNames;
      draft.coverFront = draft.coverFront ?? 0;
      if (!draft.title?.trim()) {
        const sourceName = files[0]?.name || 'Flipbook Baru';
        draft.title = sourceName.replace(/\.[^.]+$/, '').trim() || 'Flipbook Baru';
        $('#fTitle').value = draft.title;
      }
      renderPageEditor();
      autosaveDraft();
      updateSaveEnabled();
      setTimeout(() => $('#uploadProgressWrap').hidden = true, 500);
      toast(failedCount
        ? `${allPages.length} halaman berhasil diproses; ${failedCount} file dilewati.`
        : `${allPages.length} halaman siap diatur.`, failedCount ? 'info' : 'success');
    } catch (error) {
      console.error(error);
      $('#uploadError').hidden = false;
      $('#uploadError').textContent = `Gagal memproses file: ${error.message || 'Format file tidak dapat dibaca.'}`;
      $('#uploadProgressWrap').hidden = true;
      toast('Dokumen gagal diproses.', 'error');
    } finally {
      $('#fileInput').value = '';
    }
  }

  function showProgress(percent, label) {
    $('#uploadProgressPct').textContent = `${percent}%`;
    $('#uploadProgressBar').style.width = `${percent}%`;
    $('#uploadProgressLabel').textContent = label;
  }

  async function renderPDF(file) {
    if (!window.pdfjsLib) throw new Error('PDF.js tidak tersedia. Periksa folder assets/vendor.');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const images = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.35, 1600 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale: Math.max(0.8, scale) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.82));
      showProgress(Math.round(pageNumber / pdf.numPages * 100), `Merender PDF · halaman ${pageNumber}/${pdf.numPages}`);
    }

    let toc = [];
    try {
      const outline = await pdf.getOutline();
      if (outline) {
        const titleToPage = new Map();
        for (let i = 1; i <= pdf.numPages; i++) {
          const view = await outline[0]?.dest;
        }
        toc = await Promise.all(outline.map(async item => {
          let pageIndex = null;
          try {
            if (typeof item.dest === 'string') {
              const dest = await pdf.getDestination(item.dest);
              if (dest) pageIndex = await pdf.getPageIndex(dest[0]);
            } else if (item.dest?.[0]) {
              pageIndex = await pdf.getPageIndex(item.dest[0]);
            }
          } catch (_) {}
          return { title: item.title, page: pageIndex == null ? 0 : pageIndex };
        }));
      }
    } catch (_) {}
    return { images, toc };
  }

  function resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca gambar'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error(`${file.name} bukan gambar yang valid`));
        image.onload = () => {
          const maxDimension = 1800;
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.naturalWidth * scale);
          canvas.height = Math.round(image.naturalHeight * scale);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function renderPageEditor() {
    const pages = draft?.pages || [];
    $('#pageEditor').hidden = pages.length === 0;
    $('#pageCountLabel').textContent = `${pages.length} halaman`;
    $('#pageList').innerHTML = pages.map((page, index) => `<div class="page-card" draggable="true" data-index="${index}" title="${escapeHTML(draft.pageNames?.[index] || `Halaman ${index + 1}`)}">
      <img src="${page}" alt="Halaman ${index + 1}">
      <span class="page-num">${index + 1}</span>
      <button class="page-del" data-remove-page="${index}" title="Hapus halaman">×</button>
    </div>`).join('');

    const options = pages.map((_, index) => `<option value="${index}">Halaman ${index + 1}</option>`).join('');
    $('#coverFrontSel').innerHTML = options;
    $('#coverBackSel').innerHTML = `<option value="">Tidak ada</option>${options}`;
    $('#coverFrontSel').value = String(draft.coverFront ?? 0);
    $('#coverBackSel').value = draft.coverBack == null ? '' : String(draft.coverBack);
    updateCoverThumb('coverFront', draft.coverFront);
    updateCoverThumb('coverBack', draft.coverBack);
  }

  function updateCoverThumb(type, index) {
    const target = $(`#${type}Thumb`);
    if (index == null || !draft.pages?.[index]) target.innerHTML = '—';
    else target.innerHTML = `<img src="${draft.pages[index]}" alt="Cover">`;
  }

  $('#pageList').addEventListener('dragstart', event => {
    const card = event.target.closest('.page-card');
    if (!card) return;
    dragPageIndex = Number(card.dataset.index);
    card.classList.add('dragging');
  });
  $('#pageList').addEventListener('dragend', event => {
    event.target.closest('.page-card')?.classList.remove('dragging');
  });
  $('#pageList').addEventListener('dragover', event => {
    event.preventDefault();
    const card = event.target.closest('.page-card');
    if (!card || dragPageIndex == null) return;
    const targetIndex = Number(card.dataset.index);
    if (targetIndex === dragPageIndex) return;
    const [page] = draft.pages.splice(dragPageIndex, 1);
    const [name] = draft.pageNames.splice(dragPageIndex, 1);
    draft.pages.splice(targetIndex, 0, page);
    draft.pageNames.splice(targetIndex, 0, name);
    dragPageIndex = targetIndex;
    renderPageEditor();
  });
  $('#pageList').addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-page]');
    if (!removeButton) return;
    const index = Number(removeButton.dataset.removePage);
    draft.pages.splice(index, 1);
    draft.pageNames.splice(index, 1);
    if (draft.coverFront >= draft.pages.length) draft.coverFront = Math.max(0, draft.pages.length - 1);
    renderPageEditor();
    autosaveDraft();
    updateSaveEnabled();
  });
  $('#btnSortTitle').addEventListener('click', () => {
    const paired = draft.pages.map((page, index) => ({ page, name: draft.pageNames[index] || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    draft.pages = paired.map(item => item.page);
    draft.pageNames = paired.map(item => item.name);
    renderPageEditor();
    autosaveDraft();
  });
  $('#btnClearPages').addEventListener('click', () => {
    confirmDelete('Kosongkan Halaman?', 'Semua halaman pada draf akan dihapus.', () => {
      draft.pages = []; draft.pageNames = []; draft.coverFront = 0; draft.coverBack = null;
      renderPageEditor(); autosaveDraft(); updateSaveEnabled();
    });
  });

  $('#coverFrontSel').addEventListener('change', event => { draft.coverFront = Number(event.target.value); updateCoverThumb('coverFront', draft.coverFront); autosaveDraft(); });
  $('#coverBackSel').addEventListener('change', event => { draft.coverBack = event.target.value === '' ? null : Number(event.target.value); updateCoverThumb('coverBack', draft.coverBack); autosaveDraft(); });
  $('#btnCoverFront').addEventListener('click', () => $('#coverFrontSel').focus());
  $('#btnCoverBack').addEventListener('click', () => $('#coverBackSel').focus());

  $('#btnSaveBook').addEventListener('click', async () => {
    collectForm();
    if (!draft.pages.length) { $('#metaError').hidden = false; $('#metaError').textContent = 'Unggah PDF atau gambar terlebih dahulu.'; return; }
    if (!draft.title) draft.title = 'Flipbook Baru';
    $('#metaError').hidden = true;
    showLoader(true, 'Menyimpan flipbook…');
    try {
      const now = Date.now();
      $('#fTitle').value = draft.title;
      const book = {
        ...draft,
        id: editingId || `book_${now}_${Math.random().toString(36).slice(2, 8)}`,
        title: draft.title,
        author: draft.author,
        description: draft.description,
        createdAt: editingId ? (books.find(item => item.id === editingId)?.createdAt || now) : now,
        updatedAt: now,
        bookmarks: editingId ? (books.find(item => item.id === editingId)?.bookmarks || []) : []
      };
      await putBook(book);
      const existingIndex = books.findIndex(item => item.id === book.id);
      if (existingIndex >= 0) books[existingIndex] = book; else books.unshift(book);
      localStorage.removeItem('flipDraft');
      editingId = null;
      draft = emptyDraft();
      renderAll();
      setView('dashboard');
      toast('Flipbook berhasil disimpan.', 'success');
    } catch (error) {
      console.error(error);
      $('#metaError').hidden = false;
      $('#metaError').textContent = 'Penyimpanan gagal. Coba kurangi ukuran atau jumlah halaman.';
      toast('Flipbook gagal disimpan.', 'error');
    } finally {
      showLoader(false);
    }
  });

  // ---------- Demo ----------
  $('#btnDemo').addEventListener('click', async () => {
    showLoader(true, 'Menyiapkan contoh flipbook…');
    try {
      const pages = [];
      for (let i = 1; i <= 8; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 900; canvas.height = 1200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = i === 1 ? '#7c5cff' : (i % 2 ? '#fffaf0' : '#eef2ff');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = i === 1 ? '#ffffff' : '#151b36';
        ctx.textAlign = 'center';
        ctx.font = i === 1 ? '700 72px Outfit, sans-serif' : '700 52px Outfit, sans-serif';
        ctx.fillText(i === 1 ? 'FLIPBOOK STUDIO' : `Halaman ${i}`, 450, i === 1 ? 520 : 180);
        ctx.font = '400 28px Outfit, sans-serif';
        ctx.fillText(i === 1 ? 'Contoh Buku Digital' : 'Contoh halaman buku interaktif', 450, i === 1 ? 610 : 260);
        ctx.strokeStyle = i === 1 ? '#b7aaff' : '#7c5cff';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(300, 700); ctx.lineTo(600, 700); ctx.stroke();
        pages.push(canvas.toDataURL('image/jpeg', 0.9));
      }
      const book = {
        id: `demo_${Date.now()}`, title: 'Contoh Flipbook Studio', author: 'FLIPBOOK STUDIO', description: 'Buku demonstrasi bawaan.',
        pages, pageNames: pages.map((_, i) => `Halaman ${i + 1}`), coverFront: 0, coverBack: 7,
        bgColor: '#0b1020', accent: '#7c5cff', size: 'a4', speed: 900, transition: 'realistic', mode: 'night', visibility: 'public',
        toc: [{ title: 'Pembuka', page: 0 }, { title: 'Bagian 1', page: 2 }, { title: 'Penutup', page: 7 }],
        bookmarks: [], createdAt: Date.now(), updatedAt: Date.now()
      };
      await putBook(book);
      books.unshift(book);
      renderAll();
      toast('Contoh flipbook siap dibaca.', 'success');
    } finally { showLoader(false); }
  });

  // ---------- Reader ----------
  function addHistory(bookId, page) {
    let history = JSON.parse(localStorage.getItem('flipHistory') || '[]');
    history = history.filter(item => item.id !== bookId);
    history.unshift({ id: bookId, page: Number(page) + 1, openedAt: Date.now() });
    localStorage.setItem('flipHistory', JSON.stringify(history.slice(0, 20)));
  }

  function ensureReaderContainers() {
    const stage = $('#readerStage');
    if (!stage) return;
    if (!$('#coverView')) {
      const cover = document.createElement('div');
      cover.id = 'coverView';
      cover.className = 'cover-view';
      cover.hidden = true;
      cover.innerHTML = '<img id="coverViewImage" alt="Sampul buku"><button id="coverOpenButton" class="cover-open-button">Buka Buku</button>';
      stage.insertBefore(cover, stage.firstChild);
      cover.addEventListener('click', event => {
        if (event.target !== $('#coverOpenButton')) openBookFromCover();
      });
      $('#coverOpenButton').addEventListener('click', openBookFromCover);
    }
    if (!$('#backCoverView')) {
      const backCover = document.createElement('div');
      backCover.id = 'backCoverView';
      backCover.className = 'cover-view';
      backCover.hidden = true;
      backCover.innerHTML = '<img id="backCoverViewImage" alt="Sampul belakang buku">';
      stage.insertBefore(backCover, stage.firstChild);
    }
    if (!$('#flipArea')) {
      const flip = document.createElement('div');
      flip.id = 'flipArea';
      flip.className = 'flip-area';
      stage.insertBefore(flip, $('#readerLoading'));
    }
  }

  async function openReader(id) {
    const book = books.find(value => value.id === id);
    if (!book?.pages?.length) { toast('Buku tidak memiliki halaman.', 'error'); return; }
    activeBook = book;
    ensureReaderContainers();
    readerModePortrait = true;
    coverActive = true;
    backCoverActive = false;
    $('#reader').hidden = false;
    $('#reader').style.background = book.bgColor || '#0b1020';
    document.documentElement.style.setProperty('--accent', book.accent || '#7c5cff');
    $('#rTitle').textContent = book.title;
    $('#rAuthor').textContent = book.author || 'Penulis tidak dicantumkan';
    $('#rPageTotal').textContent = book.pages.length;
    $('#readerLoading').hidden = true;
    zoom = 1;
    $('#flipArea').hidden = true;
    $('#flipArea').style.transform = 'scale(1)';
    if ($('#coverView')) $('#coverView').hidden = false;
    if ($('#coverViewImage')) {
      $('#coverViewImage').src = coverFor(book);
    }
    renderReaderToc();

    addHistory(book.id, 0);
    $('#readerLoading').hidden = true;
  }

  function getReaderDimensions() {
    const stage = $('#readerStage');
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    let ratio = 1.414;
    if (activeBook?.size === 'square') ratio = 1;
    if (activeBook?.size === 'landscape') ratio = 0.714;
    if (readerModePortrait) {
      const height = Math.min(availableHeight, availableWidth * ratio, 700);
      const width = height / ratio;
      return { width: Math.floor(width), height: Math.floor(height) };
    }
    const height = Math.min(availableHeight, (availableWidth / 2) * ratio, 1000);
    const pageWidth = height / ratio;
    return { width: Math.floor(pageWidth * 2), height: Math.floor(height) };
  }

  function initPageFlip(initialPage = 0) {
    ensureReaderContainers();
    return new Promise(resolve => {
      if ($('#reader').hidden || !$('#flipArea')) {
        resolve();
        return;
      }
      if (!window.St?.PageFlip) {
        $('#readerLoading').innerHTML = '<p>Library PageFlip belum dimuat.</p>';
        toast('Animasi flipbook tidak tersedia.', 'error');
        resolve();
        return;
      }
      if (pageFlip) {
        try { pageFlip.destroy(); } catch (_) {}
      }
      ensureReaderContainers();
      $('#flipArea').innerHTML = '';
      const size = getReaderDimensions();
      const pageWidth = readerModePortrait ? size.width : size.width / 2;
      const options = {
        width: pageWidth,
        height: size.height,
        size: readerModePortrait ? 'fixed' : 'stretch',
        minWidth: Math.min(300, pageWidth),
        maxWidth: pageWidth,
        minHeight: Math.min(300, size.height),
        maxHeight: size.height,
        showCover: true,
        flippingTime: activeBook.speed || 900,
        usePortrait: readerModePortrait,
        startPage: initialPage,
        drawShadow: true,
        maxShadowOpacity: 0.65,
        mobileScrollSupport: false,
        showPageCorners: true,
        autoSize: true
      };
      $('#flipArea').classList.toggle('portrait-mode', readerModePortrait);
      pageFlip = new St.PageFlip($('#flipArea'), options);
      const flipParent = $('#flipArea').querySelector('.stf__parent');
      if (flipParent) {
        flipParent.style.width = `${size.width}px`;
        flipParent.style.maxWidth = `${size.width}px`;
      }
      const pageElements = activeBook.pages.map((source, index) => {
        const page = document.createElement('div');
        page.className = 'flip-page';
        const image = document.createElement('img');
        image.src = source;
        image.alt = `Halaman ${index + 1}`;
        page.appendChild(image);
        return page;
      });
      pageFlip.loadFromHTML(pageElements);
      pageFlip.on('flip', event => {
        const index = event.data;
        $('#rPageInput').value = index + 1;
        if (index >= activeBook.pages.length - 1) {
          showBackCoverView();
          return;
        }
        addHistory(activeBook.id, index);
        playFlipSound();
      });
      pageFlip.on('changeOrientation', event => {
        const portrait = event.data === 'portrait';
        $('#flipArea').classList.toggle('portrait-mode', portrait);
      });
      pageFlip.on('changeState', () => {});
      requestAnimationFrame(() => resolve());
    });
  }

  function playFlipSound() {
    if (!soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = playFlipSound.context || (playFlipSound.context = new AudioContext());
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(180, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(90, context.currentTime + 0.08);
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.1);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.11);
    } catch (_) {}
  }

  $('#rBack').addEventListener('click', closeReader);
  function closeReader() {
    backCoverActive = false;
    if (pageFlip) {
      try { pageFlip.destroy(); } catch (_) {}
      pageFlip = null;
    }
    $('#reader').hidden = true;
    if ($('#coverView')) $('#coverView').hidden = true;
    if ($('#flipArea')) $('#flipArea').hidden = true;
    coverActive = true;
    $('#thumbDrawer').hidden = true;
    $('#tocDrawer').hidden = true;
    $('#moreMenu').hidden = true;
    renderAll();
  }

  function showBackCoverView() {
    ensureReaderContainers();
    backCoverActive = true;
    if (pageFlip) {
      try { pageFlip.destroy(); } catch (_) {}
      pageFlip = null;
    }
    ensureReaderContainers();
    if ($('#flipArea')) $('#flipArea').hidden = true;
    if ($('#coverView')) $('#coverView').hidden = true;
    const backCover = $('#backCoverView');
    if (backCover) {
      backCover.hidden = false;
      const index = activeBook?.coverBack;
      const image = Number.isInteger(index) && activeBook.pages[index]
        ? activeBook.pages[index]
        : activeBook.pages[activeBook.pages.length - 1];
      $('#backCoverViewImage').src = image;
    }
    $('#rPageInput').value = activeBook.pages.length;
  }

  function showLastPageView() {
    ensureReaderContainers();
    backCoverActive = false;
    if ($('#backCoverView')) $('#backCoverView').hidden = true;
    if ($('#flipArea')) $('#flipArea').hidden = false;
    initPageFlip(Math.max(0, activeBook.pages.length - 2));
  }

  function showCoverView() {
    ensureReaderContainers();
    coverActive = true;
    if (pageFlip) {
      try { pageFlip.destroy(); } catch (_) {}
      pageFlip = null;
    }
    ensureReaderContainers();
    const flip = $('#flipArea');
    const cover = $('#coverView');
    if (flip) flip.hidden = true;
    if (cover) {
      cover.hidden = false;
      if (activeBook) $('#coverViewImage').src = coverFor(activeBook);
    }
    $('#rPageInput').value = 1;
  }

  async function openBookFromCover() {
    ensureReaderContainers();
    if (!coverActive) return;
    readerModePortrait = false;
    coverActive = false;
    const cover = $('#coverView');
    const flip = $('#flipArea');
    if (cover) cover.hidden = true;
    if (flip) flip.hidden = false;
    await initPageFlip(0);
    $('#rPageInput').value = 1;
  }

  if ($('#coverOpenButton')) $('#coverOpenButton').addEventListener('click', openBookFromCover);
  $('#rPrev').addEventListener('click', () => {
    if (backCoverActive) {
      showLastPageView();
      return;
    }
    if (coverActive) return;
    const current = pageFlip?.getCurrentPageIndex?.() || 0;
    if (current <= 0) showCoverView();
    else pageFlip?.flipPrev();
  });
  $('#rNext').addEventListener('click', () => {
    if (backCoverActive) return;
    if (coverActive) {
      openBookFromCover();
      return;
    }
    const current = pageFlip?.getCurrentPageIndex?.() || 0;
    if (current >= activeBook.pages.length - 2) {
      showBackCoverView();
      return;
    }
    pageFlip?.flipNext();
  });
  $('#rPageInput').addEventListener('change', event => {
    const page = Math.max(1, Math.min(activeBook.pages.length, Number(event.target.value) || 1));
    if (page >= activeBook.pages.length && !coverActive) {
      showBackCoverView();
    } else if (page === 1 && !coverActive) {
      showCoverView();
    } else if (page > 1) {
      if (coverActive) openBookFromCover().then(() => pageFlip?.flip(page - 1));
      else pageFlip?.flip(page - 1);
    }
  });
  document.addEventListener('keydown', event => {
    if ($('#reader').hidden) return;
    if (event.key === 'ArrowLeft') $('#rPrev').click();
    if (event.key === 'ArrowRight') $('#rNext').click();
    if (event.key === 'Escape') {
      if (!document.fullscreenElement) closeReader();
    }
  });

  if ($('#coverView')) {
    $('#coverView').addEventListener('click', event => {
      if (event.target !== $('#coverOpenButton')) openBookFromCover();
    });
  }

  let touchStartX = 0;
  $('#readerStage').addEventListener('touchstart', event => { touchStartX = event.changedTouches[0].clientX; }, { passive: true });
  $('#readerStage').addEventListener('touchend', event => {
    const delta = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 55) {
      if (delta > 0) $('#rPrev').click();
      else $('#rNext').click();
    }
  }, { passive: true });

  $('#rMode').addEventListener('click', async () => {
    if ($('#reader').hidden) return;
    if (coverActive) {
      await openBookFromCover();
      return;
    }
    readerModePortrait = !readerModePortrait;
    const current = pageFlip?.getCurrentPageIndex?.() || 0;
    await initPageFlip(current);
  });
  $('#rZoomIn').addEventListener('click', () => setZoom(zoom + 0.12));
  $('#rZoomOut').addEventListener('click', () => setZoom(Math.max(0.7, zoom - 0.12)));
  function setZoom(value) { zoom = value; $('#flipArea').style.transform = `scale(${zoom})`; }

  $('#rSound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    $('#rSound').textContent = soundEnabled ? '🔊' : '🔇';
  });
  $('#rBookmark').addEventListener('click', async () => {
    if (!activeBook) return;
    const page = (pageFlip?.getCurrentPageIndex?.() || 0) + 1;
    activeBook.bookmarks = activeBook.bookmarks || [];
    if (activeBook.bookmarks.includes(page)) {
      activeBook.bookmarks = activeBook.bookmarks.filter(item => item !== page);
      toast(`Bookmark halaman ${page} dihapus.`, 'info');
    } else {
      activeBook.bookmarks.push(page);
      toast(`Halaman ${page} ditandai.`, 'success');
    }
    await putBook(activeBook);
    const index = books.findIndex(book => book.id === activeBook.id);
    if (index >= 0) books[index] = activeBook;
  });

  $('#rFullscreen').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await $('#reader').requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { toast('Fullscreen tidak didukung browser ini.', 'error'); }
  });
  document.addEventListener('fullscreenchange', () => setTimeout(() => initPageFlip(pageFlip?.getCurrentPageIndex?.() || 0), 150));

  $('#rThumb').addEventListener('click', () => {
    $('#tocDrawer').hidden = true;
    $('#thumbDrawer').hidden = !$('#thumbDrawer').hidden;
  });
  $('#thumbClose').addEventListener('click', () => $('#thumbDrawer').hidden = true);
  function renderReaderToc() {
    $('#thumbGrid').innerHTML = activeBook.pages.map((page, index) => `<div class="thumb-item" data-thumb-page="${index}"><img src="${page}" alt="Halaman ${index + 1}"><div class="t-num">${index + 1}</div></div>`).join('');
    const toc = activeBook.toc || [];
    $('#tocList').innerHTML = toc.length ? toc.map(item => `<div class="toc-entry" data-toc-page="${item.page}">${escapeHTML(item.title)}</div>`).join('') : '<p class="hint">Dokumen ini tidak memiliki daftar isi.</p>';
  }
  $('#thumbGrid').addEventListener('click', event => {
    const item = event.target.closest('[data-thumb-page]');
    if (!item) return;
    const pageIndex = Number(item.dataset.thumbPage);
    if (pageIndex >= activeBook.pages.length - 1) showBackCoverView();
    else {
      if (coverActive) openBookFromCover().then(() => pageFlip?.flip(pageIndex));
      else pageFlip?.flip(pageIndex);
    }
    $('#thumbDrawer').hidden = true;
  });
  $('#rToc').addEventListener('click', () => {
    $('#thumbDrawer').hidden = true;
    $('#tocDrawer').hidden = !$('#tocDrawer').hidden;
  });
  $('#tocClose').addEventListener('click', () => $('#tocDrawer').hidden = true);
  $('#tocList').addEventListener('click', event => {
    const item = event.target.closest('[data-toc-page]');
    if (!item) return;
    pageFlip?.flip(Number(item.dataset.tocPage));
    $('#tocDrawer').hidden = true;
  });

  $('#rMore').addEventListener('click', () => $('#moreMenu').hidden = !$('#moreMenu').hidden);
  $('#mDownload').addEventListener('click', () => downloadOriginal());
  $('#mPrint').addEventListener('click', () => printBook());
  $('#mShare').addEventListener('click', () => openShareModal(activeBook.id));
  $('#mQr').addEventListener('click', () => openShareModal(activeBook.id, true));
  $('#mPublic').addEventListener('click', async () => {
    activeBook.visibility = activeBook.visibility === 'public' ? 'private' : 'public';
    await putBook(activeBook);
    $('#mPublicLabel').textContent = activeBook.visibility === 'public' ? '🔒 Jadikan Privat' : '🌐 Jadikan Publik';
    toast(activeBook.visibility === 'public' ? 'Flipbook sekarang Publik.' : 'Flipbook sekarang Privat.', 'success');
  });

  function downloadOriginal() {
    if (!activeBook.originalPdf) { toast('PDF asli tidak tersedia untuk buku ini.', 'info'); return; }
    const link = document.createElement('a');
    link.href = activeBook.originalPdf;
    link.download = `${activeBook.title || 'flipbook'}.pdf`;
    link.click();
  }

  function printBook() {
    if (!activeBook?.pages?.length) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast('Popup dicetak diblokir browser.', 'error'); return; }
    printWindow.document.write(`<html><head><title>${escapeHTML(activeBook.title)}</title><style>@page{margin:.5cm}body{margin:0}img{width:100%;height:99vh;object-fit:contain;page-break-after:always}</style></head><body>${activeBook.pages.map(page => `<img src="${page}">`).join('')}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  }

  // ---------- Sharing / QR ----------
  function makeShareLink(book) {
    const url = new URL(window.location.href);
    url.searchParams.set('book', book.id);
    return url.toString();
  }

  function openShareModal(id, showQr = false) {
    const book = books.find(value => value.id === id);
    if (!book) return;
    $('#shareBookName').textContent = `${book.title} · ${book.visibility === 'public' ? 'Publik' : 'Privat'}`;
    $('#shareLink').value = makeShareLink(book);
    $('#qrBox').hidden = !showQr;
    if (showQr) renderQr($('#shareLink').value);
    openModal('shareModal');
  }

  $('#btnCopyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#shareLink').value); toast('Link berhasil disalin.', 'success'); }
    catch (_) {
      $('#shareLink').select(); document.execCommand('copy'); toast('Link berhasil disalin.', 'success');
    }
  });
  $('#btnOpenTab').addEventListener('click', () => window.open($('#shareLink').value, '_blank', 'noopener'));
  $('#btnMakeQr').addEventListener('click', () => { $('#qrBox').hidden = false; renderQr($('#shareLink').value); });
  function renderQr(text) {
    $('#qrBox').innerHTML = '';
    if (window.QRCode) new QRCode($('#qrBox'), { text, width: 180, height: 180, colorDark: '#111827', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  }

  // ---------- Storage usage ----------
  async function updateStorageInfo() {
    let estimate = 0;
    if (navigator.storage?.estimate) {
      const value = await navigator.storage.estimate();
      estimate = value.usage || 0;
    } else {
      estimate = JSON.stringify(books).length;
    }
    $('#storageText').textContent = `${formatBytes(estimate)} terpakai`;
    const percent = Math.min(100, Math.round((estimate / (navigator.storage?.estimate ? 500 * 1024 * 1024 : 10 * 1024 * 1024)) * 100));
    $('#storageBar').style.width = `${percent}%`;
    $('#storagePct').textContent = `${percent}%`;
  }

  function renderAll() {
    renderDashboard();
    renderLibrary();
    updateStorageInfo();
  }

  // ---------- Boot ----------
  async function boot() {
    showLoader(true, 'Memuat koleksi buku…');
    try {
      await openDB();
      books = await getAllBooks();
      books.sort((a, b) => b.createdAt - a.createdAt);
      renderAll();

      const shareId = new URLSearchParams(window.location.search).get('book');
      if (shareId) {
        const sharedBook = books.find(book => book.id === shareId);
        if (sharedBook) openReader(sharedBook.id);
        else toast('Flipbook tidak ditemukan di perangkat ini.', 'error');
      }
    } catch (error) {
      console.error(error);
      toast('Penyimpanan lokal tidak dapat dibuka.', 'error');
    } finally {
      showLoader(false);
    }
  }

  boot();
})();
