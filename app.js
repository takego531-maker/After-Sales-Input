/* After Sales Input v2.1 — Machine Health Check. Offline-first (IndexedDB), tampilan HP & kantor. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};

  /* ================= storage ================= */
  var KEY = {
    session: 'asi.session', lastLogin: 'asi.lastLogin', sent: 'asi.sent', nik: 'asi.nik',
    boot: function (s) { return 'asi.boot21.' + s.company + '.' + s.user.username; },
    draft: function (s) { return 'asi.mhcDraft21.' + s.company + '.' + s.user.username; }
  };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Memori HP penuh — data belum tersimpan!', 'err'); return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  var idb = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open('after-sales-input', 1);
        r.onupgradeneeded = function () { var db = r.result; db.createObjectStore('queue', { keyPath: 'id' }); db.createObjectStore('photos'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(st, mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(st, mode), s = t.objectStore(st), out, r = fn(s);
          if (r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { res(out); }; t.onerror = t.onabort = function () { rej(t.error || new Error('IndexedDB error')); };
        });
      });
    }
    return {
      put: function (st, val, key) { return tx(st, 'readwrite', function (s) { return key === undefined ? s.put(val) : s.put(val, key); }); },
      get: function (st, key) { return tx(st, 'readonly', function (s) { return s.get(key); }); },
      del: function (st, key) { return tx(st, 'readwrite', function (s) { return s.delete(key); }); },
      all: function (st) { return tx(st, 'readonly', function (s) { return s.getAll(); }); }
    };
  })();
  var photoKey = function (owner, slot) { return owner + '|' + slot; };

  /* ================= state ================= */
  var S = {
    session: store.get(KEY.session, null), boot: null, view: 'home', syncing: false, installEvt: null, queue: [],
    wiz: null, list: { filter: null, q: '', rows: null, loading: false }, counts: null, detail: null
  };
  if (S.session) S.boot = store.get(KEY.boot(S.session), null);

  /* ================= helpers ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(e, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(e, k); }); return; }
    e.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function online() { return navigator.onLine !== false; }
  function wide() { return window.innerWidth >= 900; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var BL = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  function fmtDate(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Number(m[3]) + ' ' + BL[Number(m[2]) - 1] + ' ' + m[1] : String(iso || ''); }
  function fmtTime(ts) { var d = new Date(ts); return d.getDate() + ' ' + BL[d.getMonth()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseNum(s) {
    s = String(s == null ? '' : s).replace(/[^\d.,\-]/g, '');
    if (!s || s === '-') return NaN;
    var dot = s.indexOf('.') >= 0, com = s.indexOf(',') >= 0;
    if (dot && com) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (com) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (dot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
  }
  function fmtNum(n) { return n === '' || n == null || isNaN(Number(n)) ? (n == null ? '' : String(n)) : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 }); }
  function fmtRp(n) { return n === '' || n == null || !Number(n) ? '—' : 'Rp ' + fmtNum(n); }
  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ''; }, kind === 'err' ? 5000 : 3000);
  }
  function perms() { return (S.session && S.session.user && S.session.user.perms) || {}; }
  function can(perm) { var P = perms(); return String(perm || '').split('|').some(function (p) { return !!P[p]; }); }
  function mhc() { return S.boot && S.boot.mhc; }
  var STATUS_TONE = { 'Selesai Diperiksa': 'ok', 'Cari Part di JDS': 'bad', 'Perlu Quotation': 'wait', 'Quotation Dibuat': 'info',
                      'Negosiasi': 'info', 'Approved (PO)': 'ok', 'Invoice': 'ok', 'Lose': 'bad' };
  function chip(text, tone) { return text ? h('span', { class: 'chip ' + (tone || STATUS_TONE[text] || '') }, text) : null; }
  function machineTone(s) { return s === 'BREAKDOWN' ? 'bad' : s === 'RUNNING WITH NOTE' ? 'wait' : 'ok'; }

  /* ================= API ================= */
  function api(action, data, timeoutMs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 45000) : null;
    return fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, data || {})), redirect: 'follow', signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) { return res.text(); }, function () { var err = new Error('Tidak ada koneksi internet'); err.offline = true; throw err; })
      .then(function (txt) {
        if (timer) clearTimeout(timer);
        var j;
        try { j = JSON.parse(txt); } catch (e) { var err = new Error('Server belum siap (cek deploy Apps Script)'); err.offline = /<html/i.test(txt) && txt.length < 200; throw err; }
        if (!j.ok) { var e2 = new Error(String(j.error || 'Gagal').replace(/^AUTH:\s*/, '')); e2.auth = /^AUTH/.test(j.error || ''); throw e2; }
        return j;
      });
  }

  /* ================= session ================= */
  function saveSession() { store.set(KEY.session, S.session); }
  function refreshBoot(manual) {
    if (!S.session || S.session.expired) return Promise.resolve();
    if (!online()) { if (manual) toast('Offline — memakai data tersimpan di HP', 'warn'); return Promise.resolve(); }
    var had = !!S.boot;
    if (manual) toast('Memperbarui data…');
    return api('formBootstrap', { token: S.session.token }, 60000).then(function (r) {
      S.boot = r; S.session.user = r.user; saveSession(); store.set(KEY.boot(S.session), r);
      if (!had || manual) render(); else renderHeader();
      if (manual) toast('Data diperbarui · ' + r.population.length + ' unit · ' + r.serviceCalls.length + ' Call ID', 'ok');
      loadCounts();
    }).catch(function (e) { if (e.auth) return markExpired(); if (manual || !had) toast(e.message, 'err'); if (!had) render(); });
  }
  function loadCounts() {
    if (!S.session || !online()) return;
    api('formListMhc', { token: S.session.token, filter: 'counts' }).then(function (r) { S.counts = r.counts; if (S.view === 'home' || S.view === 'list') render(); }).catch(function () { });
  }
  function markExpired() { if (!S.session) return; S.session.expired = true; saveSession(); toast('Sesi habis — login ulang. Data antrean tetap aman.', 'warn'); render(); }
  function logout(force) {
    var pend = myQueue().length;
    if (!force && !confirm(pend ? pend + ' data belum terkirim dan tetap tersimpan di HP ini. Keluar?' : 'Keluar dari aplikasi?')) return;
    S.session = null; S.boot = null; S.view = 'home'; S.wiz = null; S.counts = null; store.del(KEY.session); render();
  }

  /* ================= queue ================= */
  function loadQueue() { return idb.all('queue').then(function (q) { S.queue = (q || []).sort(function (a, b) { return a.createdAt - b.createdAt; }); renderStatus(); }); }
  function myQueue() {
    if (!S.session) return [];
    var s = S.session;
    return S.queue.filter(function (x) { return x.company === s.company && x.username === s.user.username; });
  }
  function saveItem(item) { return idb.put('queue', item).then(loadQueue); }
  function removeItem(item) {
    var keys = (item.photoSlots || []).concat(item.hasSig ? ['sig'] : []);
    return Promise.all(keys.map(function (slot) { return idb.del('photos', photoKey(item.id, slot)); }))
      .then(function () { return idb.del('queue', item.id); }).then(loadQueue);
  }
  function blobToB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function runItem(item) {
    var tok = S.session.token;
    if (item.kind === 'mhcUpdate') return api('formUpdateMhc', Object.assign({ token: tok, clientId: item.id }, item.payload));
    var done = item.uploaded || {}, jobs = [];
    (item.photoSlots || []).forEach(function (slot) { jobs.push([slot, 'full']); jobs.push([slot, 'small']); });
    if (item.hasSig) jobs.push(['sig', 'full']);
    var total = jobs.length, chain = Promise.resolve();
    jobs.forEach(function (j) {
      var k = j[0] + ':' + j[1];
      if (done[k]) return;
      chain = chain.then(function () {
        item.progress = 'Upload foto ' + (Object.keys(done).length + 1) + '/' + total; renderStatus(); if (S.view === 'queue') render();
        return idb.get('photos', photoKey(item.id, j[0])).then(function (p) {
          if (!p) throw new Error('Foto ' + j[0] + ' hilang dari HP');
          return blobToB64(j[1] === 'small' ? (p.small || p.blob) : p.blob);
        }).then(function (b64) {
          return api('formUploadPhoto', { token: tok, clientId: item.id, slot: j[0], variant: j[1], data: b64, branch: item.payload.branch,
                                          mime: j[0] === 'sig' ? 'image/png' : 'image/jpeg' }, 120000);
        }).then(function (r) { done[k] = { url: r.url }; item.uploaded = done; return idb.put('queue', item); });
      });
    });
    return chain.then(function () {
      item.progress = 'Menyimpan data & membuat PDF…'; renderStatus(); if (S.view === 'queue') render();
      var photos = {};
      (item.photoSlots || []).forEach(function (slot) { photos[slot] = { url: done[slot + ':full'].url, caption: (item.payload.captions || {})[slot] || '' }; });
      if (item.hasSig) photos.sig = { url: done['sig:full'].url };
      return api('formSubmitMhc', Object.assign({ token: tok, clientId: item.id, photos: photos }, item.payload), 180000);
    });
  }
  function syncQueue() {
    if (S.syncing || !S.session || S.session.expired || !online()) return Promise.resolve();
    var items = myQueue().filter(function (x) { return x.status === 'pending'; });
    if (!items.length) return Promise.resolve();
    S.syncing = true; renderStatus();
    var sentN = 0, chain = Promise.resolve(false);
    items.forEach(function (item) {
      chain = chain.then(function (stop) {
        if (stop) return true;
        return runItem(item).then(function (r) {
          var sent = store.get(KEY.sent, []);
          sent.unshift({ id: item.id, kind: item.kind, summary: item.summary, company: item.company, username: item.username,
                         row: r.row, mhcNo: r.mhcNo || '', mhcStatus: r.mhcStatus || '', notified: r.notified || 0, sentAt: Date.now() });
          store.set(KEY.sent, sent.slice(0, 50)); sentN++;
          return removeItem(item).then(function () { return false; });
        }, function (e) {
          item.progress = '';
          if (e.offline) return idb.put('queue', item).then(function () { return true; });
          if (e.auth) { markExpired(); return true; }
          item.status = 'error'; item.error = e.message;
          return saveItem(item).then(function () { return false; });
        });
      });
    });
    return chain.then(function () {
      S.syncing = false;
      if (sentN) { toast(sentN + ' data berhasil terkirim ke Google Sheet', 'ok'); loadCounts(); }
      return loadQueue();
    }).then(function () { if (S.view === 'queue' || S.view === 'home') render(); });
  }

  /* ================= shell ================= */
  function render() {
    var app = $('#app'); app.innerHTML = '';
    document.body.classList.toggle('is-wide', wide());
    if (!S.session) { app.appendChild(viewLogin()); return; }
    app.appendChild(h('header', { class: 'top', id: 'top' })); renderHeader();
    var main = h('main', { class: 'main' + (S.view === 'mhc' ? ' with-steps' : '') + (S.view === 'detail' || S.view === 'list' ? ' office' : '') });
    if (S.session.expired) main.appendChild(h('div', { class: 'banner warn' }, h('div', null, h('b', null, 'Sesi login habis. '), 'Data antrean tetap aman di HP ini.'),
      h('button', { class: 'btn small', onclick: function () { logout(true); } }, 'Login ulang')));
    if (!S.boot) main.appendChild(h('div', { class: 'card center' }, h('p', null, online() ? 'Mengambil data form dari Google Sheet…' : 'Sambungkan ke internet sekali untuk mengunduh data form.'),
      h('button', { class: 'btn', onclick: function () { refreshBoot(true); } }, 'Coba lagi')));
    else if (S.view === 'mhc' && can('mhcInput')) main.appendChild(viewWizard());
    else if (S.view === 'list') main.appendChild(viewList());
    else if (S.view === 'detail' && S.detail) main.appendChild(viewDetail());
    else if (S.view === 'queue') main.appendChild(viewQueue());
    else main.appendChild(viewHome());
    app.appendChild(main);
    app.appendChild(viewTabs());
  }
  function go(view) { S.view = view; render(); window.scrollTo(0, 0); }
  function renderHeader() {
    var top = $('#top'); if (!top || !S.session) return;
    var u = S.session.user; top.innerHTML = '';
    append(top, h('div', { class: 'top-row' },
      h('div', { class: 'brand' }, h('img', { class: 'logo img', src: 'logos/' + S.session.company.toLowerCase() + '.png', alt: S.session.company }),
        h('div', null, h('div', { class: 'who' }, u.name), h('div', { class: 'sub' }, S.session.company + ' · ' + (u.branch === 'ALL' ? 'Semua cabang' : u.branch) + ' · ' + (u.roles || []).join(', ').replace(/_/g, ' ')))),
      h('div', { class: 'top-actions' }, h('span', { id: 'net', class: 'net' }),
        S.installEvt ? h('button', { class: 'icon-btn', title: 'Install aplikasi', onclick: doInstall }, '⬇') : null,
        h('button', { class: 'icon-btn', title: 'Perbarui data', onclick: function () { refreshBoot(true); } }, '↻'),
        h('button', { class: 'icon-btn', title: 'Keluar', onclick: function () { logout(false); } }, '⎋'))));
    renderStatus();
  }
  function renderStatus() {
    var net = $('#net');
    if (net) { var on = online(); net.className = 'net ' + (S.syncing ? 'sync' : on ? 'on' : 'off'); net.textContent = S.syncing ? 'Mengirim…' : on ? 'Online' : 'Offline'; }
    var n = myQueue().length, b = $('#qbadge');
    if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
  }
  function viewTabs() {
    var n = myQueue().length;
    function tab(id, icon, label, extra) {
      var active = S.view === id || (id === 'list' && S.view === 'detail');
      return h('button', { class: 'tab' + (active ? ' active' : ''), onclick: function () { if (id === 'mhc') startWizard(); else if (id === 'list') openList(S.list.filter || defaultFilter()); else go(id); } },
        h('span', { class: 'ti' }, icon), h('span', null, label), extra || null);
    }
    return h('nav', { class: 'tabs' }, tab('home', '⌂', 'Beranda'), can('mhcInput') ? tab('mhc', '＋', 'MHC Baru') : null,
      tab('list', '☰', 'Daftar MHC'), tab('queue', '⇅', 'Antrean', h('span', { id: 'qbadge', class: 'badge', style: n ? '' : 'display:none' }, n)));
  }
  function doInstall() { if (!S.installEvt) return; S.installEvt.prompt(); S.installEvt.userChoice.then(function () { S.installEvt = null; renderHeader(); }); }

  /* ================= login ================= */
  function viewLogin() {
    var last = store.get(KEY.lastLogin, {}), company = last.company || 'IPE';
    var user = h('input', { class: 'inp', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', value: last.username || '' });
    var pass = h('input', { class: 'inp', type: 'password', name: 'password', autocomplete: 'current-password' });
    var btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Masuk');
    function submit(ev) {
      ev.preventDefault();
      if (!user.value.trim() || !pass.value) return toast('Isi username & password', 'err');
      btn.disabled = true; btn.textContent = 'Memeriksa…';
      api('formLogin', { username: user.value.trim(), password: pass.value, company: company }).then(function (r) {
        S.session = { token: r.token, user: r.user, company: r.company, loginAt: Date.now() }; saveSession();
        store.set(KEY.lastLogin, { username: r.user.username, company: r.company });
        S.boot = store.get(KEY.boot(S.session), null); S.view = 'home'; render();
        return refreshBoot(false).then(syncQueue);
      }).catch(function (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Masuk'; });
    }
    return h('div', { class: 'login-wrap' },
      h('div', { class: 'login-hero' }, h('div', { class: 'logo-pair' }, h('img', { src: 'logos/ipe.png', alt: 'IPE' }), h('img', { src: 'logos/ike.png', alt: 'IKE' })),
        h('h1', null, 'After Sales Input'), h('p', null, 'Machine Health Check')),
      h('form', { class: 'card', onsubmit: submit }, h('label', { class: 'lbl' }, 'Company'), segmented(['IPE', 'IKE'], company, function (v) { company = v; }),
        h('label', { class: 'lbl' }, 'Username'), user, h('label', { class: 'lbl' }, 'Password'), pass, btn,
        !online() ? h('p', { class: 'hint warn-text' }, 'Anda sedang offline. Login butuh internet (sekali saja).') : null,
        S.queue.length ? h('p', { class: 'hint' }, S.queue.length + ' data di HP ini menunggu dikirim — login untuk mengirimnya.') : null),
      h('p', { class: 'foot' }, 'v' + (CFG.VERSION || '')));
  }
  function segmented(opts, value, onChange, cls) {
    var wrap = h('div', { class: 'seg ' + (cls || '') });
    opts.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'seg-btn' + (o === value ? ' on' : '') + ' v-' + String(o).replace(/[^a-z]/gi, '').toLowerCase(), onclick: function () {
        Array.prototype.forEach.call(wrap.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); onChange(o);
      } }, o);
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ================= home ================= */
  function viewHome() {
    var d = store.get(KEY.draft(S.session), null), n = myQueue().length, C = S.counts || {};
    var tile = function (icon, title, sub, onclick, cls, badge) {
      return h('button', { class: 'card tile ' + (cls || ''), onclick: onclick, disabled: !onclick },
        h('div', { class: 'tile-ic' }, icon), h('div', { class: 'tile-body' }, h('div', { class: 'tile-t' }, title), h('div', { class: 'tile-s' }, sub)),
        badge ? h('span', { class: 'tile-badge' }, badge) : null);
    };
    var inbox = function (f) { return function () { openList(f); }; };
    return h('div', null,
      h('h2', { class: 'page-t' }, 'Halo, ' + S.session.user.name.split(' ')[0]),
      d && can('mhcInput') ? h('div', { class: 'banner info' }, h('span', null, 'Ada draft MHC yang belum selesai' + (d.values && d.values.CUSTOMER ? ' (' + d.values.CUSTOMER + ')' : '') + '.'),
        h('button', { class: 'btn small', onclick: function () { startWizard(); } }, 'Lanjutkan')) : null,
      h('div', { class: 'tiles' },
        can('mhcInput') ? tile('＋', 'MHC Baru', 'Isi pemeriksaan unit · checklist · parts · foto', function () { startWizard(); }, 'accent') : null,
        can('partsJds') ? tile('⌕', 'Cari Part di JDS', 'Part yang tidak ada di Stock On Hand', inbox('jds'), '', C.jds) : null,
        can('quoteCreate') ? tile('Rp', 'Perlu Quotation', 'Buat quotation di SAP, isi nomornya di sini', inbox('needquote'), '', C.needquote) : null,
        can('quoteStatus') ? (isPssrOnly() ? tile('⇄', 'Quotation saya', 'Customer yang Anda pegang: update Negosiasi / PO / Invoice / Lose', inbox('myopen'), '', C.myopen)
          : tile('⇄', 'Quotation Berjalan', 'Update Negosiasi / Approved (PO) / Invoice / Lose', inbox('open'), '', C.open)) : null,
        tile('☰', 'Daftar MHC', 'Cari MHC, lihat detail, download PDF', inbox(defaultFilter())),
        tile('⇅', 'Antrean', n ? n + ' data menunggu dikirim' : 'Semua data sudah terkirim', function () { go('queue'); }, '', n || null)),
      h('h3', { class: 'sec-t' }, 'Segera hadir'),
      h('div', { class: 'tiles small' }, tile('◷', 'Mechanics Activity Report', 'Tahap berikutnya', null, 'soon'), tile('◫', 'Machine Yard Activity', 'Tahap berikutnya', null, 'soon'),
        tile('☏', 'Call Center', 'Tahap berikutnya', null, 'soon'), tile('⟳', 'Update Population', 'Tahap berikutnya', null, 'soon')));
  }
  function defaultFilter() { return can('partsJds') && (S.counts || {}).jds ? 'jds' : can('quoteCreate') ? 'needquote' : can('quoteStatus') ? (isPssrOnly() ? 'myopen' : 'open') : can('mhcInput') ? 'mine' : 'all'; }

  /* ================= wizard ================= */
  var STEPS = ['Unit', 'Checklist', 'Summary', 'Parts', 'Foto', 'Kirim'];
  function draftOwner() { return 'draft|' + S.session.company + '|' + S.session.user.username; }
  function newDraft() {
    var u = S.session.user;
    return { step: 0, values: { DATE: todayISO(), NIK: u.nik || store.get(KEY.nik, '') }, checklist: {}, captions: {}, photoSlots: [], parts: [], hasSig: false,
             branch: (S.boot.branches.indexOf(u.branch) >= 0 ? u.branch : S.boot.branches[0]) || u.branch, open: {} };
  }
  function startWizard() {
    if (!can('mhcInput')) return;
    var d = store.get(KEY.draft(S.session), null) || newDraft();
    S.wiz = { d: d, thumbs: {}, partHits: null, partQ: '' };
    S.view = 'mhc'; render(); window.scrollTo(0, 0); loadThumbs();
  }
  function saveDraft() { if (S.wiz) store.set(KEY.draft(S.session), S.wiz.d); }
  var saveDraftSoon = debounce(saveDraft, 300);
  function loadThumbs() {
    var d = S.wiz.d, keys = d.photoSlots.concat(d.hasSig ? ['sig'] : []);
    Promise.all(keys.map(function (slot) { return idb.get('photos', photoKey(draftOwner(), slot)).then(function (p) { if (p && S.wiz) S.wiz.thumbs[slot] = URL.createObjectURL(p.small || p.blob); }); }))
      .then(function () { if (S.view === 'mhc' && S.wiz && (S.wiz.d.step === 4 || S.wiz.d.step === 5)) render(); });
  }
  function discardDraft() {
    if (!confirm('Hapus draft MHC ini? Semua isian dan foto akan dihapus.')) return;
    var d = S.wiz.d, keys = d.photoSlots.concat(['sig']);
    Promise.all(keys.map(function (s) { return idb.del('photos', photoKey(draftOwner(), s)); })).then(function () { store.del(KEY.draft(S.session)); S.wiz = null; go('home'); });
  }
  function badCount(d) { var n = 0; mhc().groups.forEach(function (g) { g.items.forEach(function (it) { var x = d.checklist[it.col]; if (x && x.c === 'BAD') n++; }); }); return n; }
  function needsParts(d) { return badCount(d) > 0 || d.values.STATUS === 'BREAKDOWN' || d.values.STATUS === 'RUNNING WITH NOTE'; }
  function stepErrors(i) {
    var d = S.wiz.d, M = mhc(), e = [];
    if (i === 0) {
      if (!d.values.CUSTOMER) e.push('Customer'); if (!d.values.SN) e.push('Serial Number'); if (!d.values.DATE) e.push('Date');
      if (S.boot.branches.length > 1 && !d.branch) e.push('Branch');
      if (d.values.PSSR && !d.values.PSSR_ATTEND) e.push('PSSR ikut ke lokasi?');
    } else if (i === 1) {
      M.groups.forEach(function (g) { g.items.forEach(function (it) {
        var x = d.checklist[it.col];
        if (!x || !x.c) e.push(g.title + ': ' + it.label); else if (x.c === 'BAD' && !String(x.r || '').trim()) e.push('Remarks BAD: ' + it.label);
      }); });
    } else if (i === 2) {
      if (!d.values.STATUS) e.push('Machine Status'); if (!String(d.values.DETAIL || '').trim()) e.push('Detail Problem'); if (!String(d.values.ACTION || '').trim()) e.push('Action');
    } else if (i === 3) {
      d.parts.forEach(function (p, k) { if (!String(p.partNo || '').trim()) e.push('Part ' + (k + 1) + ': Part Number'); if (!(Number(p.qty) > 0)) e.push('Part ' + (k + 1) + ': Qty'); });
    } else if (i === 4) {
      M.photos.forEach(function (p) { if (p.required && d.photoSlots.indexOf(p.slot) < 0) e.push('Foto ' + p.label); });
    }
    return e;
  }
  function viewWizard() {
    var d = S.wiz.d, i = d.step;
    var steps = h('div', { class: 'steps' }, STEPS.map(function (t, k) {
      var errs = k < 5 ? stepErrors(k) : [], ok = k < 5 && !errs.length && (k !== 3 || d.parts.length || !needsParts(d));
      return h('button', { class: 'st' + (k === i ? ' cur' : '') + (ok ? ' done' : ''), onclick: function () { d.step = k; saveDraft(); render(); window.scrollTo(0, 0); } },
        h('span', { class: 'st-n' }, ok && k !== i ? '✓' : k + 1), h('span', { class: 'st-t' }, t));
    }));
    var body = [wizUnit, wizChecklist, wizSummary, wizParts, wizPhotos, wizReview][i]();
    var nav = h('div', { class: 'submit-bar two' },
      i > 0 ? h('button', { class: 'btn', onclick: function () { d.step--; saveDraft(); render(); window.scrollTo(0, 0); } }, '‹ Kembali') : h('button', { class: 'btn ghost', onclick: discardDraft }, 'Hapus draft'),
      i < 5 ? h('button', { class: 'btn primary', onclick: function () {
        var errs = stepErrors(i);
        if (errs.length) { toast('Lengkapi: ' + errs.slice(0, 3).join(', ') + (errs.length > 3 ? ' (+' + (errs.length - 3) + ')' : ''), 'err'); markBad(); return; }
        d.step++; saveDraft(); render(); window.scrollTo(0, 0);
      } }, 'Lanjut ›') : h('button', { class: 'btn primary', onclick: submitWizard }, 'Kirim ✓'));
    return h('div', null, h('div', { class: 'steps-wrap' }, steps), body, nav);
  }
  function markBad() { var el = document.querySelector('[data-missing="1"]'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  function field(label, key, opts) {
    opts = opts || {};
    var d = S.wiz.d, val = d.values[key] == null ? '' : d.values[key], inp;
    if (opts.textarea) { inp = h('textarea', { class: 'inp', rows: opts.rows || 3, placeholder: opts.ph || '' }); inp.value = val; }
    else inp = h('input', { class: 'inp' + (opts.num ? ' num' : ''), type: opts.type || 'text', inputmode: opts.num ? 'decimal' : (opts.tel ? 'tel' : null), value: val, placeholder: opts.ph || '', autocomplete: 'off', list: opts.list || null });
    inp.addEventListener('input', function () { d.values[key] = inp.value; inp.removeAttribute('data-missing'); saveDraftSoon(); if (key === 'NIK') store.set(KEY.nik, inp.value); });
    if (opts.required && !String(val).trim()) inp.setAttribute('data-missing', '1');
    inp.id = 'w-' + key;
    return h('div', { class: 'field' + (opts.half ? ' half' : '') }, h('label', { class: 'lbl', for: inp.id }, label, opts.required ? h('span', { class: 'req' }, ' *') : null), inp);
  }
  function setVals(obj) { var d = S.wiz.d; Object.keys(obj).forEach(function (k) { if (obj[k]) d.values[k] = obj[k]; }); saveDraft(); render(); }
  function popBySn(sn) { var s = String(sn || '').trim().toLowerCase(); return s ? (S.boot.population || []).find(function (r) { return String(r[0]).trim().toLowerCase() === s; }) : null; }
  function picker(label, rows, hayFn, renderRow, onPick, ph) {
    var inp = h('input', { class: 'inp', type: 'search', placeholder: ph, autocomplete: 'off', enterkeyhint: 'search' }), list = h('div', { class: 'picklist' });
    function run() {
      var q = inp.value.trim().toLowerCase(); list.innerHTML = '';
      if (q.length < 2) return;
      var terms = q.split(/\s+/), res = [];
      for (var i = 0; i < rows.length && res.length < 10; i++) { var hay = hayFn(rows[i]).toLowerCase(); if (terms.every(function (t) { return hay.indexOf(t) >= 0; })) res.push(rows[i]); }
      if (!res.length) { list.appendChild(h('div', { class: 'pick-empty' }, 'Tidak ditemukan — isi manual di bawah.')); return; }
      res.forEach(function (r) { list.appendChild(h('button', { type: 'button', class: 'pick', onclick: function () { onPick(r); } }, renderRow(r))); });
    }
    inp.addEventListener('input', debounce(run, 150));
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    return h('div', { class: 'picker' }, h('label', { class: 'lbl' }, label, h('span', { class: 'muted' }, ' (' + rows.length + ')')), inp, list);
  }
  function wizUnit() {
    var d = S.wiz.d, u = S.session.user;
    var scPick = picker('Pilih Call ID (Service Call SAP)', S.boot.serviceCalls || [], function (r) { return r.join(' '); },
      function (r) { return [h('div', { class: 'pick-main' }, h('b', null, r[0]), ' · ', r[1] || '-'), h('div', { class: 'pick-sub' }, [r[2] && 'SN ' + r[2], r[3], r[5], r[6], r[7]].filter(Boolean).join(' — '))]; },
      function (r) { var p = popBySn(r[2]) || []; setVals({ CALL_ID: r[0], CUSTOMER: r[1] || p[3], SN: r[2], LOCATION: r[4] || p[4], BRAND: p[1], MODEL: p[2] || r[3], ENG_NO: p[7], PHONE: p[6] }); toast('Data dari Call ID ' + r[0] + ' terisi — silakan cek', 'ok'); },
      'Ketik Call ID / customer / SN…');
    var popPick = picker('Atau cari unit dari Machine Population', S.boot.population || [], function (r) { return r.slice(0, 5).join(' '); },
      function (r) { return [h('div', { class: 'pick-main' }, h('b', null, r[0] || '(tanpa SN)'), ' · ', [r[1], r[2]].filter(Boolean).join(' ')), h('div', { class: 'pick-sub' }, [r[3], r[4], r[5] ? 'th ' + r[5] : ''].filter(Boolean).join(' — '))]; },
      function (r) { setVals({ SN: r[0], BRAND: r[1], MODEL: r[2], CUSTOMER: r[3], LOCATION: r[4], ENG_NO: r[7], PHONE: r[6] }); toast('Data unit terisi — silakan cek', 'ok'); },
      'Ketik SN / customer / model…');
    var branchField = S.boot.branches.length > 1
      ? h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Branch', h('span', { class: 'req' }, ' *')),
          h('select', { class: 'inp', onchange: function (e) { d.branch = e.target.value; saveDraft(); } }, S.boot.branches.map(function (b) { return h('option', { value: b, selected: b === d.branch }, b); })))
      : h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Branch'), h('div', { class: 'ro' }, S.boot.branches[0] || u.branch));
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '1 · Data Unit'), scPick, popPick),
      h('div', { class: 'card grid2' },
        field('Date', 'DATE', { type: 'date', required: true, half: true }), branchField,
        field('Call ID', 'CALL_ID', { half: true, ph: 'Dari SAP' }), field('Hours Meter', 'HM', { num: true, half: true, ph: '0' }),
        field('Customer', 'CUSTOMER', { required: true }), field('Location', 'LOCATION'),
        field('Contact Person', 'CONTACT', { half: true }), field('Phone', 'PHONE', { half: true, tel: true }),
        field('Brand', 'BRAND', { half: true }), field('Model', 'MODEL', { half: true }),
        field('Serial No.', 'SN', { required: true, half: true }), field('Engine Model', 'ENG_MODEL', { half: true }),
        field('Engine No.', 'ENG_NO', { half: true })),
      wizTeam());
  }
  function personSelect(label, key, list, exclude, ph) {
    var d = S.wiz.d, cur = d.values[key] || '';
    var opts = list.filter(function (p) { return exclude.indexOf(p.name) < 0 || p.name === cur; });
    if (cur && !opts.some(function (p) { return p.name === cur; })) opts.unshift({ name: cur, nik: '' });
    var sel = h('select', { class: 'inp', id: 'w-' + key, onchange: function (e) {
      d.values[key] = e.target.value;
      if (key === 'TECH2' && !e.target.value) d.values.TECH3 = '';
      if (key === 'PSSR' && !e.target.value) d.values.PSSR_ATTEND = '';
      saveDraft(); render();
    } }, h('option', { value: '' }, ph), opts.map(function (p) { return h('option', { value: p.name, selected: p.name === cur }, p.name + (p.nik ? ' · ' + p.nik : '')); }));
    return h('div', { class: 'field' }, h('label', { class: 'lbl', for: sel.id }, label), sel);
  }
  function wizTeam() {
    var d = S.wiz.d, u = S.session.user, M = mhc(), v = d.values;
    var mech = (M.mechanics || []).filter(function (p) { return p.name !== u.name; }), pssr = M.pssr || [];
    var pssrField = pssr.length || v.PSSR ? personSelect('PSSR penanggung jawab customer', 'PSSR', pssr, [], '— Tidak ada / belum ditentukan —')
      : field('PSSR penanggung jawab customer', 'PSSR');
    return h('div', { class: 'card' }, h('h2', null, 'Tim Pemeriksa'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Mekanik 1'), h('div', { class: 'ro' }, u.name), h('div', { class: 'muted small' }, 'Penanggung jawab (Anda)')),
        field('NIK', 'NIK', { half: true })),
      mech.length ? [
        personSelect('Mekanik 2 (pendamping)', 'TECH2', mech, [v.TECH3], '— Tidak ada —'),
        v.TECH2 ? personSelect('Mekanik 3 (cadangan)', 'TECH3', mech, [v.TECH2], '— Tidak ada —') : null
      ] : h('p', { class: 'hint' }, 'Daftar mekanik pendamping diambil dari tab Users (Form Role MEKANIK, cabang yang sama).'),
      pssrField,
      v.PSSR ? h('div', { 'data-missing': v.PSSR_ATTEND ? null : '1' }, h('label', { class: 'lbl' }, 'PSSR ikut ke lokasi?', h('span', { class: 'req' }, ' *')),
        segmented(['Ya', 'Tidak'], v.PSSR_ATTEND, function (x) { d.values.PSSR_ATTEND = x; saveDraft(); })) : null,
      h('p', { class: 'hint' }, 'PSSR tetap dipilih walaupun tidak ikut, karena PSSR inilah yang meng-follow up quotation.'));
  }
  function wizChecklist() {
    var d = S.wiz.d, M = mhc(), total = 0, filled = 0, bad = 0;
    var setCond = function (it, c) { var x = d.checklist[it.col] || {}; x.c = c; d.checklist[it.col] = x; saveDraftSoon(); };
    M.groups.forEach(function (g) { g.items.forEach(function (it) { total++; var x = d.checklist[it.col]; if (x && x.c) filled++; if (x && x.c === 'BAD') bad++; }); });
    var head = h('div', { class: 'card' }, h('h2', null, '2 · Checklist'),
      h('div', { class: 'prog' }, h('div', { class: 'prog-bar', style: 'width:' + Math.round(filled / total * 100) + '%' })),
      h('div', { class: 'muted small' }, filled + ' / ' + total + ' item terisi' + (bad ? ' · ' + bad + ' BAD' : '')));
    var cards = M.groups.map(function (g) {
      var gb = 0, gf = 0;
      g.items.forEach(function (it) { var x = d.checklist[it.col]; if (x && x.c) gf++; if (x && x.c === 'BAD') gb++; });
      var isOpen = d.open[g.key] !== undefined ? d.open[g.key] : gf < g.items.length;
      var all = function (c) { g.items.forEach(function (it) { var x = d.checklist[it.col]; if (!x || !x.c || c === 'N/A' || x.c !== 'BAD') setCond(it, c); }); d.open[g.key] = true; saveDraft(); render(); };
      var items = !isOpen ? null : g.items.map(function (it) {
        var x = d.checklist[it.col] || {};
        var rem = h('input', { class: 'inp sm' + (x.c === 'BAD' && !x.r ? ' bad' : ''), placeholder: x.c === 'BAD' ? 'Remarks wajib — jelaskan temuan' : 'Catatan (opsional)', value: x.r || '' });
        rem.addEventListener('input', function () { var y = d.checklist[it.col] || {}; y.r = rem.value; d.checklist[it.col] = y; rem.classList.toggle('bad', y.c === 'BAD' && !rem.value.trim()); saveDraftSoon(); });
        return h('div', { class: 'ck' + (x.c === 'BAD' ? ' is-bad' : ''), 'data-missing': !x.c || (x.c === 'BAD' && !x.r) ? '1' : null },
          h('div', { class: 'ck-top' }, h('div', { class: 'ck-l' }, it.label), segmented(M.conditions, x.c, function (c) { setCond(it, c); render(); }, 'cond')),
          x.c === 'BAD' || x.r || x.showRem ? rem : h('button', { type: 'button', class: 'linkbtn', onclick: function () { var y = d.checklist[it.col] || {}; y.showRem = true; d.checklist[it.col] = y; render(); } }, '+ catatan'));
      });
      return h('div', { class: 'card group' },
        h('button', { type: 'button', class: 'g-head', onclick: function () { d.open[g.key] = !isOpen; saveDraft(); render(); } },
          h('span', { class: 'g-t' }, g.title), h('span', { class: 'g-c' + (gb ? ' bad-t' : '') }, gf + '/' + g.items.length + (gb ? ' · ' + gb + ' BAD' : '')), h('span', { class: 'g-chev' }, isOpen ? '▾' : '▸')),
        isOpen ? h('div', { class: 'g-actions' }, h('button', { type: 'button', class: 'btn small', onclick: function () { all('GOOD'); } }, 'Sisa → GOOD'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: function () { all('N/A'); } }, 'Semua N/A')) : null, items);
    });
    return h('div', null, head, cards);
  }
  function wizSummary() {
    var d = S.wiz.d, M = mhc(), bads = [];
    M.groups.forEach(function (g) { g.items.forEach(function (it) { var x = d.checklist[it.col]; if (x && x.c === 'BAD') bads.push(it.label + ': ' + (x.r || '')); }); });
    return h('div', null, h('div', { class: 'card' }, h('h2', null, '3 · Summary Service Report'),
      bads.length ? h('div', { class: 'banner bad' }, h('div', null, h('b', null, bads.length + ' temuan BAD: '), bads.join(' · '))) : null,
      h('label', { class: 'lbl' }, 'Machine Status', h('span', { class: 'req' }, ' *')),
      h('div', { 'data-missing': d.values.STATUS ? null : '1' }, segmented(M.statusOptions, d.values.STATUS, function (v) { d.values.STATUS = v; saveDraft(); }, 'status')),
      field('Detail Problem / Report Customer', 'DETAIL', { textarea: true, required: true }), field('Actual Condition', 'ACTUAL', { textarea: true }),
      field('Action', 'ACTION', { textarea: true, required: true }), field('Final Machine Condition', 'FINAL', { textarea: true })));
  }
  function wizParts() {
    var d = S.wiz.d, W = S.wiz, need = needsParts(d);
    var q = h('input', { class: 'inp', type: 'search', placeholder: online() ? 'Cari part number / nama part…' : 'Offline — ketik part number di bawah', value: W.partQ, enterkeyhint: 'search', disabled: !online() });
    var hits = h('div', { class: 'picklist' });
    var drawHits = function () {
      hits.innerHTML = '';
      if (W.partLoading) { hits.appendChild(h('div', { class: 'pick-empty' }, 'Mencari di Stock On Hand…')); return; }
      if (!W.partHits) return;
      if (!W.partHits.length) { hits.appendChild(h('div', { class: 'pick-empty' }, 'Tidak ada di Stock On Hand — tambahkan manual di bawah, nanti dicari di JDS.')); return; }
      W.partHits.forEach(function (it) {
        hits.appendChild(h('button', { type: 'button', class: 'pick', onclick: function () {
          d.parts.push({ partNo: it.partNo, desc: it.desc, qty: 1, stockBranch: it.stockBranch, stockOther: it.otherText, bin: it.bin, found: true });
          W.partHits = null; W.partQ = ''; saveDraft(); render();
        } }, h('div', { class: 'pick-main' }, h('b', null, it.partNo), ' · ', it.desc),
          h('div', { class: 'pick-sub' }, (it.stockBranch > 0 ? 'Stock cabang: ' + it.stockBranch + (it.bin ? ' · Bin ' + it.bin : '') : 'Kosong di cabang') + (it.otherText ? ' — ada di ' + it.otherText : ''))));
      });
    };
    var search = debounce(function () {
      W.partQ = q.value.trim();
      if (W.partQ.length < 2) { W.partHits = null; drawHits(); return; }
      W.partLoading = true; drawHits();
      api('formSearchParts', { token: S.session.token, q: W.partQ, branch: d.branch }).then(function (r) { W.partLoading = false; W.partHits = r.items; drawHits(); })
        .catch(function (e) { W.partLoading = false; W.partHits = null; drawHits(); toast(e.message, 'err'); });
    }, 350);
    q.addEventListener('input', search);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    drawHits();
    var list = d.parts.map(function (p, k) {
      var qty = h('input', { class: 'inp sm num qty', inputmode: 'numeric', value: p.qty });
      qty.addEventListener('input', function () { p.qty = parseNum(qty.value) || ''; saveDraftSoon(); });
      var pn = p.found ? null : h('input', { class: 'inp sm', placeholder: 'Part number', value: p.partNo || '' });
      if (pn) pn.addEventListener('input', function () { p.partNo = pn.value.trim(); saveDraftSoon(); });
      var desc = p.found ? null : h('input', { class: 'inp sm', placeholder: 'Nama / deskripsi part', value: p.desc || '' });
      if (desc) desc.addEventListener('input', function () { p.desc = desc.value; saveDraftSoon(); });
      return h('div', { class: 'part' + (p.found ? '' : ' manual') },
        h('div', { class: 'part-top' }, h('span', { class: 'part-n' }, k + 1),
          p.found ? h('div', { class: 'part-main' }, h('b', null, p.partNo), h('div', { class: 'muted small' }, p.desc),
            h('div', { class: 'small' }, p.stockBranch > 0 ? h('span', { class: 'ok-text' }, 'Stock cabang ' + p.stockBranch) : h('span', { class: 'warn-text' }, 'Kosong di cabang'),
              p.stockOther ? h('span', { class: 'muted' }, ' · ' + p.stockOther) : null))
            : h('div', { class: 'part-main' }, h('div', { class: 'small warn-text' }, 'Manual — dicek ke Stock On Hand saat dikirim, jika tidak ada dicari di JDS'), pn, desc),
          h('label', { class: 'qty-l' }, 'Qty', qty),
          h('button', { type: 'button', class: 'icon-btn danger', title: 'Hapus', onclick: function () { d.parts.splice(k, 1); saveDraft(); render(); } }, '✕')));
    });
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '4 · Parts Rekomendasi'),
        need ? h('p', { class: 'muted small' }, 'Ada temuan BAD atau status unit ' + (d.values.STATUS || '') + '. Pilih part yang perlu diganti dari Stock On Hand.')
          : h('div', { class: 'banner ok' }, 'Tidak ada temuan — parts rekomendasi boleh dikosongkan.'),
        h('div', { class: 'picker' }, h('label', { class: 'lbl' }, 'Cari di Stock On Hand'), q, hits),
        h('button', { type: 'button', class: 'btn small', onclick: function () { d.parts.push({ partNo: W.partQ || '', desc: '', qty: 1, found: false }); W.partHits = null; saveDraft(); render(); } }, '+ Tambah part manual')),
      d.parts.length ? h('div', { class: 'card' }, h('h2', null, d.parts.length + ' part direkomendasikan'), list) : null);
  }
  function resize(file, max, q) {
    var load = window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (res, rej) { var img = new Image(); img.onload = function () { res(img); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
    return load.then(function (img) {
      var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', q); });
    });
  }
  function wizPhotos() {
    var d = S.wiz.d, M = mhc();
    var slotCard = function (p) {
      var has = d.photoSlots.indexOf(p.slot) >= 0;
      var input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file' });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0]; if (!f) return;
        toast('Memproses foto…');
        Promise.all([resize(f, 1600, 0.72), resize(f, 900, 0.6)]).then(function (b) {
          return idb.put('photos', { blob: b[0], small: b[1], at: Date.now() }, photoKey(draftOwner(), p.slot)).then(function () {
            if (d.photoSlots.indexOf(p.slot) < 0) d.photoSlots.push(p.slot);
            if (S.wiz.thumbs[p.slot]) URL.revokeObjectURL(S.wiz.thumbs[p.slot]);
            S.wiz.thumbs[p.slot] = URL.createObjectURL(b[1]); saveDraft(); render();
            toast('Foto tersimpan (' + Math.round(b[0].size / 1024) + ' KB)', 'ok');
          });
        }).catch(function () { toast('Foto gagal diproses, coba lagi', 'err'); });
      });
      var cap = null;
      if (p.defect && has) { cap = h('input', { class: 'inp sm', placeholder: 'Keterangan foto', value: d.captions[p.slot] || '' }); cap.addEventListener('input', function () { d.captions[p.slot] = cap.value; saveDraftSoon(); }); }
      return h('div', { class: 'ph-slot' + (has ? ' has' : '') + (p.required && !has ? ' need' : ''), 'data-missing': p.required && !has ? '1' : null },
        h('label', { class: 'ph-box' }, input, has && S.wiz.thumbs[p.slot] ? h('img', { src: S.wiz.thumbs[p.slot], alt: p.label }) : h('span', { class: 'ph-plus' }, has ? '✓' : '📷'), h('span', { class: 'ph-n' }, p.slot)),
        h('div', { class: 'ph-l' }, p.label, p.required ? h('span', { class: 'req' }, ' *') : null),
        has ? h('button', { type: 'button', class: 'linkbtn danger', onclick: function () {
          idb.del('photos', photoKey(draftOwner(), p.slot)).then(function () { d.photoSlots = d.photoSlots.filter(function (s) { return s !== p.slot; }); delete d.captions[p.slot]; saveDraft(); render(); });
        } }, 'Hapus') : null, cap);
    };
    var req = M.photos.filter(function (p) { return p.required; }), def = M.photos.filter(function (p) { return p.defect; });
    var filledDef = def.filter(function (p) { return d.photoSlots.indexOf(p.slot) >= 0; }), nextDef = def.find(function (p) { return d.photoSlots.indexOf(p.slot) < 0; });
    var showDef = filledDef.concat(nextDef ? [nextDef] : []).sort(function (a, b) { return a.slot - b.slot; });
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '5 · Foto wajib'), h('p', { class: 'muted small' }, 'Tap kotak untuk memotret. Foto dikecilkan otomatis dan disimpan di HP sampai terkirim.'), h('div', { class: 'ph-grid' }, req.map(slotCard))),
      h('div', { class: 'card' }, h('h2', null, 'Foto kerusakan (' + filledDef.length + ' / ' + def.length + ')'), h('p', { class: 'muted small' }, 'Kotak baru muncul setiap satu foto terisi.'), h('div', { class: 'ph-grid' }, showDef.map(slotCard))));
  }
  function signaturePad() {
    var d = S.wiz.d, cv = h('canvas', { class: 'sig', width: 600, height: 200 }), ctx = cv.getContext('2d'), drawing = false, dirty = false;
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    var pos = function (e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('pointerdown', function (e) { e.preventDefault(); drawing = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { } var p = pos(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); });
    cv.addEventListener('pointermove', function (e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p[0], p[1]); ctx.stroke(); dirty = true; });
    ['pointerup', 'pointercancel'].forEach(function (ev) { cv.addEventListener(ev, function () { if (!drawing) return; drawing = false; if (dirty) save(); }); });
    var save = debounce(function () {
      cv.toBlob(function (b) { idb.put('photos', { blob: b, at: Date.now() }, photoKey(draftOwner(), 'sig')).then(function () { d.hasSig = true; if (S.wiz.thumbs.sig) URL.revokeObjectURL(S.wiz.thumbs.sig); S.wiz.thumbs.sig = URL.createObjectURL(b); saveDraft(); }); }, 'image/png');
    }, 300);
    if (d.hasSig && S.wiz.thumbs.sig) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, cv.width, cv.height); }; img.src = S.wiz.thumbs.sig; }
    return h('div', { class: 'sig-wrap' }, cv, h('button', { type: 'button', class: 'linkbtn danger', onclick: function () {
      ctx.clearRect(0, 0, cv.width, cv.height); idb.del('photos', photoKey(draftOwner(), 'sig')).then(function () { d.hasSig = false; delete S.wiz.thumbs.sig; saveDraft(); });
    } }, 'Hapus tanda tangan'));
  }
  function getGps() {
    var d = S.wiz.d;
    if (!navigator.geolocation) return toast('HP tidak mendukung lokasi', 'warn');
    toast('Mengambil lokasi…');
    navigator.geolocation.getCurrentPosition(function (p) {
      d.values.GPS = p.coords.latitude.toFixed(6) + ',' + p.coords.longitude.toFixed(6) + ' (±' + Math.round(p.coords.accuracy) + ' m)'; saveDraft(); render(); toast('Lokasi tersimpan', 'ok');
    }, function () { toast('Lokasi tidak bisa diambil — izinkan akses lokasi di browser', 'warn'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  function wizReview() {
    var d = S.wiz.d, M = mhc(), all = [0, 1, 2, 3, 4].map(stepErrors), v = d.values, cnt = { GOOD: 0, BAD: 0, 'N/A': 0 };
    M.groups.forEach(function (g) { g.items.forEach(function (it) { var x = d.checklist[it.col]; if (x && cnt[x.c] !== undefined) cnt[x.c]++; }); });
    var issues = [];
    all.forEach(function (e, i) { if (e.length) issues.push(h('button', { class: 'issue', onclick: function () { d.step = i; saveDraft(); render(); window.scrollTo(0, 0); } }, h('b', null, STEPS[i] + ': '), e.slice(0, 4).join(', ') + (e.length > 4 ? ' (+' + (e.length - 4) + ')' : ''), ' ›')); });
    if (!v.GPS && !d.gpsTried) { d.gpsTried = true; setTimeout(getGps, 300); }
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '6 · Periksa & Kirim'),
        issues.length ? h('div', { class: 'banner warn col' }, h('b', null, 'Belum lengkap:'), issues) : h('div', { class: 'banner ok' }, 'Semua bagian sudah lengkap. Siap dikirim.'),
        kvRow('Customer', v.CUSTOMER), kvRow('Unit', [v.BRAND, v.MODEL, v.SN && 'SN ' + v.SN].filter(Boolean).join(' · ')), kvRow('Call ID', v.CALL_ID), kvRow('Hours Meter', v.HM),
        kvRow('Mekanik', [S.session.user.name, v.TECH2, v.TECH3].filter(Boolean).join(', ')), kvRow('PSSR', v.PSSR ? v.PSSR + (v.PSSR_ATTEND === 'Ya' ? ' (ikut)' : ' (tidak ikut)') : ''),
        kvRow('Checklist', cnt.GOOD + ' GOOD · ' + cnt.BAD + ' BAD · ' + cnt['N/A'] + ' N/A'), kvRow('Status', v.STATUS),
        kvRow('Parts', d.parts.length ? d.parts.length + ' part' : 'Tidak ada'), kvRow('Foto', d.photoSlots.length + ' foto')),
      h('div', { class: 'card' }, h('h2', null, 'Customer / Operator (opsional)'), field('Nama Customer PIC', 'CUST_PIC'),
        h('label', { class: 'lbl' }, 'Tanda tangan di layar'), signaturePad()),
      h('div', { class: 'card' }, h('h2', null, 'Lokasi GPS'), h('div', { class: 'row-btns' }, h('span', { class: v.GPS ? 'ok-text' : 'muted' }, v.GPS || 'Belum diambil'),
        h('button', { type: 'button', class: 'btn small', onclick: getGps }, v.GPS ? 'Ambil ulang' : 'Ambil lokasi'))),
      h('p', { class: 'hint' }, 'Setelah dikirim, nomor MHC, status, dan PDF report dibuat otomatis. Tanpa sinyal, data tersimpan di HP dan terkirim sendiri saat online.'));
  }
  function kvRow(k, v) { return v === '' || v == null ? null : h('div', { class: 'kv' }, h('span', null, k), h('b', null, String(v))); }
  function submitWizard() {
    var errs = [0, 1, 2, 3, 4].map(stepErrors).reduce(function (a, b) { return a.concat(b); }, []);
    if (errs.length) { toast('Masih ada ' + errs.length + ' isian yang belum lengkap', 'err'); return; }
    var d = S.wiz.d, v = Object.assign({}, d.values), id = uid();
    if (v.HM !== '' && v.HM != null) { var n = parseNum(v.HM); v.HM = isNaN(n) ? v.HM : n; }
    var checklist = {};
    Object.keys(d.checklist).forEach(function (c) { var x = d.checklist[c]; if (x && x.c) checklist[c] = { c: x.c, r: x.r || '' }; });
    var item = {
      id: id, kind: 'mhc', company: S.session.company, username: S.session.user.username, createdAt: Date.now(), status: 'pending',
      photoSlots: d.photoSlots.slice().sort(function (a, b) { return a - b; }), hasSig: !!d.hasSig, uploaded: {},
      payload: { values: v, checklist: checklist, captions: d.captions, branch: d.branch,
                 parts: d.parts.map(function (p) { return { partNo: p.partNo, desc: p.desc, qty: Number(p.qty) || 1 }; }) },
      summary: { title: v.CUSTOMER, sub: [fmtDate(v.DATE), v.MODEL, v.SN && 'SN ' + v.SN, v.STATUS, d.parts.length ? d.parts.length + ' part' : ''].filter(Boolean).join(' · ') }
    };
    var keys = item.photoSlots.concat(item.hasSig ? ['sig'] : []);
    Promise.all(keys.map(function (slot) {
      return idb.get('photos', photoKey(draftOwner(), slot)).then(function (p) { return idb.put('photos', p, photoKey(id, slot)).then(function () { return idb.del('photos', photoKey(draftOwner(), slot)); }); });
    })).then(function () { return saveItem(item); }).then(function () {
      store.del(KEY.draft(S.session)); Object.keys(S.wiz.thumbs).forEach(function (k) { URL.revokeObjectURL(S.wiz.thumbs[k]); }); S.wiz = null;
      toast(online() ? 'Tersimpan — mengirim ke Google Sheet…' : 'Tersimpan di HP — terkirim otomatis saat online', 'ok');
      go('queue'); syncQueue();
    }).catch(function (e) { toast('Gagal menyimpan: ' + e.message, 'err'); });
  }

  /* ================= daftar ================= */
  function isPssrOnly() { var R = S.session.user.roles || []; return R.indexOf('PSSR') >= 0 && R.indexOf('ADMIN_PARTS') < 0 && R.indexOf('ADMIN_HO') < 0; }
  var FILTERS = [['jds', 'Cari Part di JDS', 'partsJds'], ['needquote', 'Perlu Quotation', 'quoteCreate'], ['myopen', 'Quotation saya', 'pssrOnly'],
                 ['open', 'Quotation Berjalan', 'quoteStatus'],
                 ['mine', 'Milik saya', 'mhcInput'], ['all', 'Semua', '']];
  function openList(f) { S.list.filter = f; S.list.rows = null; go('list'); loadList(); }
  function loadList() {
    var L = S.list;
    if (!online()) { toast('Daftar MHC butuh koneksi internet', 'warn'); return; }
    L.loading = true; if (S.view === 'list') render();
    api('formListMhc', { token: S.session.token, q: L.q, filter: L.filter || 'all' }, 60000).then(function (r) { L.rows = r.rows; S.counts = r.counts; L.loading = false; if (S.view === 'list') render(); })
      .catch(function (e) { L.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'list') render(); });
  }
  function sideChips(r) {
    return [r.pStatus ? h('span', { class: 'chip ' + (STATUS_TONE[r.pStatus] || '') }, 'P: ' + r.pStatus) : null,
            r.sStatus ? h('span', { class: 'chip ' + (STATUS_TONE[r.sStatus] || '') }, 'S: ' + r.sStatus) : null];
  }
  function viewList() {
    var L = S.list, C = S.counts || {};
    if (!L.filter) L.filter = defaultFilter();
    var filters = FILTERS.filter(function (f) { return !f[2] || (f[2] === 'pssrOnly' ? isPssrOnly() : can(f[2])); });
    var q = h('input', { class: 'inp', type: 'search', placeholder: 'Cari MHC No / customer / SN / Call ID / No. Quotation…', value: L.q, enterkeyhint: 'search' });
    var head = h('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); L.q = q.value.trim(); loadList(); } },
      h('div', { class: 'chips filt' }, filters.map(function (f) {
        var n = C[f[0]];
        return h('button', { type: 'button', class: 'fchip' + (L.filter === f[0] ? ' on' : ''), onclick: function () { L.filter = f[0]; loadList(); } }, f[1], n ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q, h('button', { class: 'btn primary', type: 'submit' }, 'Cari')));
    var body;
    if (L.loading) body = h('div', { class: 'card center muted' }, 'Memuat…');
    else if (L.rows == null) body = h('div', { class: 'card center' }, h('button', { class: 'btn', onclick: loadList }, 'Tampilkan data'));
    else if (!L.rows.length) body = h('div', { class: 'card center muted' }, 'Tidak ada data.');
    else if (wide()) {
      body = h('div', { class: 'card table-card' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['MHC No', 'Tanggal', 'Customer', 'Unit', 'Mekanik', 'Mesin', 'MHC Status', 'Parts', 'Quotation P / S', 'Total Quotation'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, L.rows.map(function (r) {
          return h('tr', { onclick: function () { openDetail(r); } },
            h('td', null, h('b', null, r.mhcNo || 'Data lama')), h('td', null, fmtDate(r.date)), h('td', null, r.customer),
            h('td', null, [r.brand, r.model].filter(Boolean).join(' '), h('div', { class: 'muted small' }, r.sn)), h('td', null, r.tech),
            h('td', null, r.status ? chip(r.status, machineTone(r.status)) : null, r.bad ? h('div', { class: 'small bad-t' }, r.bad + ' BAD') : null),
            h('td', null, chip(r.mhcStatus)), h('td', { class: 'small' }, r.parts), h('td', null, sideChips(r)), h('td', { class: 'num' }, fmtRp(r.totalQ)));
        }))));
    } else body = L.rows.map(function (r) {
      return h('button', { class: 'card item', onclick: function () { openDetail(r); } },
        h('div', { class: 'item-top' }, h('b', null, r.customer || '(tanpa customer)'), h('span', { class: 'muted' }, fmtDate(r.date))),
        h('div', { class: 'muted small' }, [r.mhcNo || 'Data lama', [r.brand, r.model].filter(Boolean).join(' '), r.sn && 'SN ' + r.sn, r.tech].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, chip(r.mhcStatus), r.status ? chip(r.status, machineTone(r.status)) : null, r.bad ? chip(r.bad + ' BAD', 'bad') : null, sideChips(r)),
        r.parts ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Parts: ' + r.parts) : null);
    });
    return h('div', null, head, body);
  }

  /* ================= detail ================= */
  function openDetail(r) {
    S.detail = { row: r, values: null, loading: true }; go('detail');
    api('formGetMhc', { token: S.session.token, row: r.row }).then(function (x) {
      S.detail.values = x.values; S.detail.parts = x.parts; S.detail.sides = x.sides; S.detail.formulaCols = x.formulaCols; S.detail.loading = false;
      if (S.view === 'detail') render();
    }).catch(function (e) { S.detail.loading = false; toast(e.message, 'err'); if (S.view === 'detail') render(); });
  }
  function downloadPdf(r, regen) {
    toast(regen ? 'Membuat ulang PDF…' : 'Mengunduh PDF…');
    api('formGetPdf', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, regenerate: !!regen }, 120000).then(function (x) {
      var bin = atob(x.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      var a = h('a', { href: url, download: x.name }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      toast('PDF siap: ' + x.name, 'ok');
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function viewDetail() {
    var D = S.detail, r = D.row, M = mhc(), F = M.f, v = D.values;
    var back = h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { go('list'); } }, '‹ Kembali ke daftar');
    if (D.loading || !v) return h('div', null, back, h('div', { class: 'card center muted' }, D.loading ? 'Memuat detail…' : 'Gagal memuat.'));
    var g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
    var bads = [];
    M.groups.forEach(function (gr) { gr.items.forEach(function (it) { if (String(v[it.col]).toUpperCase() === 'BAD') bads.push({ g: gr.title, l: it.label, r: v[it.rem] }); }); });
    var info = h('div', { class: 'card summary' },
      h('h2', null, g('CUSTOMER') || '(tanpa customer)'),
      h('div', { class: 'chips', style: 'margin:-4px 0 8px' }, h('span', { class: 'chip' }, r.mhcNo || 'Data lama'), chip(g('MHC_STATUS')), g('STATUS') ? chip(g('STATUS'), machineTone(g('STATUS'))) : null),
      kvRow('Tanggal', fmtDate(g('DATE'))), kvRow('Unit', [g('BRAND'), g('MODEL'), g('SN') && 'SN ' + g('SN')].filter(Boolean).join(' · ')),
      kvRow('Engine', [g('ENG_MODEL'), g('ENG_NO')].filter(Boolean).join(' / ')), kvRow('Hours Meter', fmtNum(g('HM'))), kvRow('Location', g('LOCATION')),
      kvRow('Contact', [g('CONTACT'), g('PHONE')].filter(Boolean).join(' · ')), kvRow('Call ID', g('CALL_ID')), kvRow('Mekanik', [g('TECH'), g('TECH2'), g('TECH3')].filter(function (x) { return String(x || '').trim(); }).join(', ')),
      kvRow('PSSR', g('PSSR') ? g('PSSR') + (g('PSSR_ATTEND') === 'Ya' ? ' (ikut ke lokasi)' : g('PSSR_ATTEND') === 'Tidak' ? ' (tidak ikut)' : '') : ''),
      kvRow('Status terakhir', [g('STATUS_DATE') && fmtDate(g('STATUS_DATE')), g('STATUS_BY')].filter(Boolean).join(' · ')),
      !r.isOld ? h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: function () { downloadPdf(r); } }, '⬇ Download PDF'),
        h('button', { class: 'btn ghost small', onclick: function () { downloadPdf(r, true); } }, 'Buat ulang PDF')) : null);
    var findings = !r.isOld ? h('div', { class: 'card' }, h('h2', null, 'Temuan (' + bads.length + ' BAD)'),
      bads.length ? bads.map(function (b) { return h('div', { class: 'qitem' }, h('div', { class: 'qmain' }, h('b', null, b.l), h('div', { class: 'muted small' }, b.g), h('div', { class: 'small err-text' }, b.r))); }) : h('p', { class: 'muted' }, 'Tidak ada temuan.'),
      g('DETAIL') ? kvRow('Detail Problem', g('DETAIL')) : null, g('ACTION') ? kvRow('Action', g('ACTION')) : null) : null;
    var parts = (D.parts || []).length ? h('div', { class: 'card' }, h('h2', null, 'Parts Rekomendasi (' + D.parts.length + ')'), D.parts.map(function (p, k) {
      var jdsBox = null;
      if (p.found === 'Tidak') {
        if (can('partsJds')) {
          var jn = h('input', { class: 'inp sm', placeholder: 'JDS Parts Number', value: p.jdsNo || '' }), jt = h('input', { class: 'inp sm', placeholder: 'Catatan JDS', value: p.jdsNote || '' });
          jdsBox = h('div', { class: 'jds' }, jn, jt, h('button', { class: 'btn small primary', onclick: function () {
            if (!online()) return toast('Butuh koneksi internet', 'warn');
            api('formUpdatePartJds', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, partRow: p.row, jdsNo: jn.value.trim(), jdsNote: jt.value.trim() }).then(function (x) {
              D.parts = x.parts; v[F.PARTS_REC] = x.summary; v[F.MHC_STATUS] = x.mhcStatus; toast('Hasil JDS tersimpan · status: ' + x.mhcStatus, 'ok'); loadCounts(); render();
            }).catch(function (e) { toast(e.message, 'err'); });
          } }, 'Simpan JDS'));
        } else jdsBox = h('div', { class: 'small ' + (p.jdsNo ? 'ok-text' : 'err-text') }, p.jdsNo ? 'JDS: ' + p.jdsNo + (p.jdsNote ? ' · ' + p.jdsNote : '') : 'Belum ditemukan — sedang dicari di JDS');
      }
      return h('div', { class: 'part' + (p.found === 'Tidak' ? ' manual' : '') }, h('div', { class: 'part-top' }, h('span', { class: 'part-n' }, k + 1),
        h('div', { class: 'part-main' }, h('b', null, p.partNo), ' × ' + p.qty, h('div', { class: 'muted small' }, p.desc),
          p.found === 'Ya' ? h('div', { class: 'small' }, Number(p.stockBranch) > 0 ? h('span', { class: 'ok-text' }, 'Stock cabang ' + p.stockBranch) : h('span', { class: 'warn-text' }, 'Kosong di cabang'), p.stockOther ? h('span', { class: 'muted' }, ' · ' + p.stockOther) : null) : null,
          jdsBox)));
    })) : null;
    var office = viewOffice(D, r, v);
    var left = h('div', { class: 'col-left' }, info, findings, parts), right = h('div', { class: 'col-right' }, office);
    return h('div', null, back, h('div', { class: 'detail-grid' }, left, right));
  }
  function viewOffice(D, r, v) {
    var M = mhc(), F = M.f, fields = [], formula = {}, editAny = false;
    (D.formulaCols || []).forEach(function (c) { formula[c] = true; });
    var sections = M.office.map(function (sec) {
      var kids = sec.fields.map(function (fd) {
        if (formula[fd.col]) return null;
        var val = v[fd.col] == null ? '' : v[fd.col], editable = can(fd.perm), inp;
        if (!editable) return val === '' ? null : kvRow(fd.h.replace(/^(Parts|Service) /, ''), fd.type === 'number' ? fmtRp(val) : fd.type === 'date' ? fmtDate(val) : val);
        editAny = true;
        if (fd.type === 'select') inp = h('select', { class: 'inp' }, h('option', { value: '' }, '—'), fd.options.map(function (o) { return h('option', { value: o, selected: o === val }, o); }));
        else if (fd.type === 'date') inp = h('input', { class: 'inp', type: 'date', value: val });
        else if (fd.type === 'number') { inp = h('input', { class: 'inp num', inputmode: 'decimal', value: val === '' ? '' : fmtNum(val), placeholder: '0' }); inp.addEventListener('blur', function () { var n = parseNum(inp.value); if (!isNaN(n)) inp.value = fmtNum(n); }); }
        else if (fd.type === 'textarea') { inp = h('textarea', { class: 'inp', rows: 2 }); inp.value = val; }
        else inp = h('input', { class: 'inp', value: val });
        fields.push({ fd: fd, inp: inp, orig: String(inp.value).trim(), side: sec.side });
        return h('div', { class: 'field' + (fd.type === 'textarea' ? '' : ' half') }, h('label', { class: 'lbl' }, fd.h.replace(/^(Parts|Service) /, ''), h('span', { class: 'col-tag' }, fd.letter)), inp);
      }).filter(Boolean);
      if (!kids.length) return null;
      var eff = sec.side ? (D.sides || {})[sec.side] : '';
      return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, sec.title), eff ? chip(eff) : null), h('div', { class: 'grid2' }, kids));
    });
    if (!editAny) return h('div', null, h('h3', { class: 'sec-t' }, 'Quotation & Invoice'), sections, sections.every(function (s) { return !s; }) ? h('div', { class: 'card muted' }, 'Belum ada quotation.') : null);
    return h('form', { onsubmit: function (e) {
      e.preventDefault();
      var vals = {}, errs = [], next = {};
      fields.forEach(function (f) {
        var raw = String(f.inp.value).trim(); next[f.fd.key] = raw;
        if (raw === f.orig) return;
        if (f.fd.type === 'number' && raw) { var n = parseNum(raw); if (isNaN(n)) { errs.push(f.fd.h + ' harus angka'); return; } vals[f.fd.col] = n; } else vals[f.fd.col] = raw;
      });
      ['P', 'S'].forEach(function (s) {
        var st = next[s + '_STATUS'] !== undefined ? next[s + '_STATUS'] : v[F[s + '_STATUS']], rs = next[s + '_REASON'] !== undefined ? next[s + '_REASON'] : v[F[s + '_REASON']];
        if (st === 'Lose' && !String(rs || '').trim()) errs.push((s === 'P' ? 'Parts' : 'Service') + ' Reason For Lose wajib diisi bila status Lose');
      });
      if (errs.length) return toast(errs.join(' · '), 'err');
      if (!Object.keys(vals).length) return toast('Belum ada perubahan', 'warn');
      var key = r.mhcNo || (String(v[F.SN]).trim() + '|' + String(v[F.CUSTOMER]).trim());
      saveItem({ id: uid(), kind: 'mhcUpdate', company: S.session.company, username: S.session.user.username, createdAt: Date.now(), status: 'pending',
        payload: { row: r.row, expectKey: key, values: vals }, summary: { title: 'Update: ' + (v[F.CUSTOMER] || '-'), sub: (r.mhcNo || 'Baris ' + r.row) + ' · ' + Object.keys(vals).length + ' kolom' } })
        .then(function () {
          toast(online() ? 'Update dikirim…' : 'Update tersimpan — terkirim saat online', 'ok');
          syncQueue().then(function () { if (online()) openDetail(r); });
        });
    } }, h('h3', { class: 'sec-t' }, 'Quotation & Invoice'), sections,
      M.formulaCols.length ? h('p', { class: 'hint' }, M.formulaCols.map(function (x) { return x.h; }).join(', ') + ' dihitung otomatis oleh rumus di sheet.') : null,
      h('div', { class: 'submit-bar office-bar' }, h('button', { class: 'btn primary block', type: 'submit' }, 'Simpan')));
  }

  /* ================= antrean ================= */
  function viewQueue() {
    var q = myQueue(), sent = store.get(KEY.sent, []).filter(function (x) { return x.company === S.session.company && x.username === S.session.user.username; });
    return h('div', null,
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Belum terkirim (' + q.length + ')'),
          q.length ? h('button', { class: 'btn small', disabled: S.syncing, onclick: function () {
            Promise.all(q.filter(function (x) { return x.status === 'error'; }).map(function (x) { x.status = 'pending'; x.error = null; return idb.put('queue', x); }))
              .then(loadQueue).then(function () { if (!online()) toast('Masih offline — terkirim otomatis saat ada sinyal', 'warn'); return syncQueue(); }).then(render);
          } }, 'Kirim sekarang') : null),
        !q.length ? h('p', { class: 'muted' }, 'Semua data sudah terkirim ✓') : null,
        q.map(function (x) {
          var n = ((x.photoSlots || []).length * 2) + (x.hasSig ? 1 : 0), up = Object.keys(x.uploaded || {}).length;
          return h('div', { class: 'qitem ' + x.status },
            h('div', { class: 'qmain' }, h('b', null, x.summary && x.summary.title), h('div', { class: 'muted small' }, x.summary && x.summary.sub),
              h('div', { class: 'small' }, x.status === 'error' ? h('span', { class: 'err-text' }, '✕ ' + x.error)
                : h('span', { class: 'muted' }, x.progress || ((n ? 'File ' + up + '/' + n + ' terkirim · ' : '') + 'menunggu sinyal · ' + fmtTime(x.createdAt))))),
            h('button', { class: 'icon-btn danger', title: 'Hapus', onclick: function () { if (!confirm('Hapus data ini dari antrean? Data belum masuk ke Google Sheet dan akan hilang.')) return; removeItem(x).then(render); } }, '🗑'));
        })),
      h('div', { class: 'card' }, h('h2', null, 'Terkirim terakhir'), !sent.length ? h('p', { class: 'muted' }, 'Belum ada.') : null,
        sent.slice(0, 20).map(function (x) {
          return h('div', { class: 'qitem sent' }, h('div', { class: 'qmain' }, h('b', null, x.summary && x.summary.title), h('div', { class: 'muted small' }, x.summary && x.summary.sub),
            h('div', { class: 'small ok-text' }, '✓ ' + (x.mhcNo ? x.mhcNo + ' · ' : '') + (x.mhcStatus ? x.mhcStatus + ' · ' : '') + 'baris ' + x.row + ' · ' + fmtTime(x.sentAt)),
            x.notified ? h('div', { class: 'small muted' }, 'Email notifikasi JDS terkirim ke ' + x.notified + ' penerima') : null));
        })),
      S.boot ? h('p', { class: 'hint' }, 'Data unit & Call ID diperbarui ' + fmtTime(S.boot.fetchedAt) + ' · tekan ↻ untuk memperbarui.') : null);
  }

  /* ================= start ================= */
  window.addEventListener('online', function () { renderStatus(); syncQueue(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncQueue(); });
  var lastWide = wide();
  window.addEventListener('resize', debounce(function () { if (wide() !== lastWide) { lastWide = wide(); if (S.view !== 'mhc') render(); } }, 200));
  setInterval(syncQueue, 60000);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; renderHeader(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(function () { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  loadQueue().catch(function () { }).then(function () { render(); if (S.session && !S.session.expired) refreshBoot(false).then(syncQueue); });
})();
