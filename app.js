/* After Sales Input v2.1 — Machine Health Check. Offline-first (IndexedDB), tampilan HP & kantor. */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};

  /* ================= storage ================= */
  var KEY = {
    session: 'asi.session', lastLogin: 'asi.lastLogin', sent: 'asi.sent', nik: 'asi.nik',
    boot: function (s) { return 'asi.boot21.' + s.company + '.' + s.user.username; },
    counts: function (s) { return 'asi.counts.' + s.company + '.' + s.user.username; },
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
  if (S.session) { S.boot = store.get(KEY.boot(S.session), null); S.counts = store.get(KEY.counts(S.session), null); }

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
  var STATUS_TONE = { 'Menunggu Review SL': 'wait', 'Selesai Diperiksa': 'ok', 'Cari Part di JDS': 'bad', 'Perlu Quotation': 'wait', 'Quotation Dibuat': 'info',
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
      var cnt = r.counts; delete r.counts;
      S.boot = r; S.session.user = r.user; saveSession(); store.set(KEY.boot(S.session), r);
      if (cnt && Object.keys(cnt).length) setCounts(cnt);
      if (!had || manual) render(); else renderHeader();
      if (manual) toast('Data diperbarui · ' + r.population.length + ' unit · ' + r.serviceCalls.length + ' Call ID', 'ok');
      if (!cnt || !Object.keys(cnt).length) loadCounts();
    }).catch(function (e) { if (e.auth) return markExpired(); if (manual || !had) toast(e.message, 'err'); if (!had) render(); });
  }
  function setCounts(c) {
    var prev = S.counts || {};
    S.counts = Object.assign({}, prev, c || {});
    if (S.session) store.set(KEY.counts(S.session), S.counts);
    notifyNew(prev, S.counts);
    if (S.view === 'home' || S.view === 'list') render();
  }
  /* ---------- Notifikasi pekerjaan baru (angka kotak naik) + badge ikon aplikasi ---------- */
  function watchKeys() {
    var w = [];
    if (can('slReview')) w.push(['review', 'MHC menunggu review & tanda tangan Anda', 'review']);
    else if (can('partsJds')) w.push(['jds', 'part perlu dicari di JDS', 'jds']);
    if (can('quoteCreate')) w.push(['needquote', 'MHC sudah disetujui SL — perlu dibuatkan quotation', 'needquote']);
    if (can('marReview')) w.push(['marPending', 'hari MAR mekanik menunggu review', null]);
    if (can('marInput')) w.push(['marMissing', 'hari kerja MAR belum diisi', null]);
    if (isPssrOnly()) w.push(['myfudue', 'quotation perlu Anda follow up ke customer', 'myfudue']);
    if (can('callCenter')) w.push(['ccDue', 'survei customer perlu ditelepon', 'cc']);
    if (can('callCenter')) w.push(['callOutDue', 'Call Out (Livelink / Promo) perlu ditelepon', 'callOut']);
    if (can('callCenter')) w.push(['callInWa', 'Call In perlu diteruskan ke WA group', 'callIn']);
    else if (can('callInView')) w.push(['callInOpen', 'permintaan customer (Call In) baru untuk Anda', 'callIn']);
    if (can('complaintView')) w.push(['complaintsOpen', can('callCenter') ? 'keluhan customer belum selesai' : 'keluhan customer perlu Anda tindak lanjuti', 'complaints']);
    return w;
  }
  function notifyNew(prev, cur) {
    if (!S.session) return;
    var W = watchKeys(), total = 0, news = [];
    W.forEach(function (w) {
      var a = Number(prev[w[0]]), b = Number(cur[w[0]]) || 0; total += b;
      if (!isNaN(a) && w[0] in prev && b > a) news.push({ n: b - a, text: w[1], filter: w[2] });
    });
    try { if (navigator.setAppBadge) { if (total) navigator.setAppBadge(total); else navigator.clearAppBadge(); } } catch (e) { }
    if (!news.length) return;
    var msg = news.map(function (x) { return x.n + ' ' + x.text; }).join(' · ');
    if (!document.hidden) toast('🔔 ' + msg, 'ok');
    if (document.hidden && window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification('After Sales Input', { body: msg, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'asi-counts', renotify: true, data: { filter: news[0].filter } });
      }).catch(function () { });
    }
  }
  var lastPoll = Date.now();
  function pollCounts(force) {
    if (!S.session || S.session.expired || !online() || !watchKeys().length) return;
    if (!force && Date.now() - lastPoll < (document.hidden ? 170000 : 55000)) return;
    lastPoll = Date.now(); loadCounts();
  }
  setInterval(function () { pollCounts(false); }, 15000);
  function askNotify() {
    if (!window.Notification) return toast('Browser ini tidak mendukung notifikasi', 'warn');
    Notification.requestPermission().then(function (p) { store.set('asi.notifyAsked', 1); toast(p === 'granted' ? 'Notifikasi aktif di perangkat ini' : 'Notifikasi tidak diizinkan', p === 'granted' ? 'ok' : 'warn'); render(); });
  }
  function loadCounts() {
    if (!S.session || !online()) return;
    if (!canViewMhc()) { if (can('marReview')) loadMarCount(); return; }
    api('formListMhc', { token: S.session.token, filter: 'counts' }).then(function (r) { setCounts(r.counts); }).catch(function () { });
    if (can('marReview')) api('formListMar', { token: S.session.token, scope: 'branch', from: isoAdd(todayISO(), -13), to: todayISO(), pending: true })
      .then(function (r) { setCounts({ marPending: r.pendingDays }); }).catch(function () { });
  }
  function loadMarCount() { api('formListMar', { token: S.session.token, scope: 'branch', from: isoAdd(todayISO(), -13), to: todayISO(), pending: true }).then(function (r) { setCounts({ marPending: r.pendingDays }); }).catch(function () { }); }
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
  function sigSlotsOf(o) { return (o.hasSig ? ['sig'] : []).concat(o.hasTsig ? ['tsig'] : []); }
  function saveItem(item) { return idb.put('queue', item).then(loadQueue); }
  function removeItem(item) {
    var keys = (item.photoSlots || []).concat(sigSlotsOf(item));
    return Promise.all(keys.map(function (slot) { return idb.del('photos', photoKey(item.id, slot)); }))
      .then(function () { return idb.del('queue', item.id); }).then(loadQueue);
  }
  function blobToB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function runItem(item) {
    var tok = S.session.token;
    if (item.kind === 'mhcUpdate') return api('formUpdateMhc', Object.assign({ token: tok, clientId: item.id }, item.payload));
    if (item.kind === 'mar') return api('formSubmitMar', Object.assign({ token: tok, clientId: item.id }, item.payload));
    var done = item.uploaded || {}, jobs = [];
    (item.photoSlots || []).forEach(function (slot) { jobs.push([slot, 'full']); jobs.push([slot, 'small']); });
    sigSlotsOf(item).forEach(function (sl) { jobs.push([sl, 'full']); });
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
                                          mime: /sig$/.test(j[0]) ? 'image/png' : 'image/jpeg' }, 120000);
        }).then(function (r) { done[k] = { url: r.url }; item.uploaded = done; return idb.put('queue', item); });
      });
    });
    return chain.then(function () {
      item.progress = 'Menyimpan data…'; renderStatus(); if (S.view === 'queue') render();
      var photos = {};
      (item.photoSlots || []).forEach(function (slot) { photos[slot] = { url: done[slot + ':full'].url, caption: (item.payload.captions || {})[slot] || '' }; });
      sigSlotsOf(item).forEach(function (sl) { photos[sl] = { url: done[sl + ':full'].url }; });
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
                         row: r.row, mhcNo: r.mhcNo || r.marNo || '', mhcStatus: r.mhcStatus || '', notified: r.notified || 0, sentAt: Date.now(), marPrefill: item.marPrefill || null });
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
    var main = h('main', { class: 'main' + (S.view === 'mhc' ? ' with-steps' : '') + (['detail', 'list', 'quotes', 'cc', 'ccSurvey', 'complaints', 'ccRekap', 'callIn', 'callInNew', 'callOut', 'coForm'].indexOf(S.view) >= 0 ? ' office' : '') });
    if (S.session.expired) main.appendChild(h('div', { class: 'banner warn' }, h('div', null, h('b', null, 'Sesi login habis. '), 'Data antrean tetap aman di HP ini.'),
      h('button', { class: 'btn small', onclick: function () { logout(true); } }, 'Login ulang')));
    if (!S.boot) main.appendChild(h('div', { class: 'card center' }, h('p', null, online() ? 'Mengambil data form dari Google Sheet…' : 'Sambungkan ke internet sekali untuk mengunduh data form.'),
      h('button', { class: 'btn', onclick: function () { refreshBoot(true); } }, 'Coba lagi')));
    else if (S.view === 'mhc' && can('mhcInput')) main.appendChild(viewWizard());
    else if (S.view === 'list' && canViewMhc()) main.appendChild(viewList());
    else if (S.view === 'detail' && S.detail) main.appendChild(viewDetail());
    else if (S.view === 'queue') main.appendChild(viewQueue());
    else if (S.view === 'mar' && can('marInput')) main.appendChild(viewMar());
    else if (S.view === 'marTeam' && can('marReview|marExport')) main.appendChild(viewMarTeam());
    else if (S.view === 'quotes' && can('quoteMonitor')) main.appendChild(viewQuotes());
    else if (S.view === 'cc' && can('callCenter')) main.appendChild(viewCc());
    else if (S.view === 'ccSurvey' && can('callCenter') && S.ccs) main.appendChild(viewCcSurvey());
    else if (S.view === 'complaints' && can('complaintView')) main.appendChild(viewComplaints());
    else if (S.view === 'ccRekap' && can('ccRekap')) main.appendChild(viewCcRekap());
    else if (S.view === 'callIn' && can('callInView')) main.appendChild(viewCallIn());
    else if (S.view === 'callInNew' && can('callCenter') && S.cif) main.appendChild(viewCallInNew());
    else if (S.view === 'callOut' && can('callCenter')) main.appendChild(viewCallOut());
    else if (S.view === 'coForm' && can('callCenter') && S.cof && S.co) main.appendChild(viewCoForm());
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
      canViewMhc() ? tab('list', '☰', invoiceOnly() ? 'MHC Selesai' : 'Daftar MHC') : null, tab('queue', '⇅', 'Antrean', h('span', { id: 'qbadge', class: 'badge', style: n ? '' : 'display:none' }, n)));
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
        S.boot = store.get(KEY.boot(S.session), null); S.counts = store.get(KEY.counts(S.session), null); S.view = 'home'; render();
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
    var soon = NEXT_MENUS.filter(function (m) { return allowed(m[0], m[3]); });
    return h('div', null,
      h('h2', { class: 'page-t' }, 'Halo, ' + greetName(S.session.user.name)),
      watchKeys().length && window.Notification && Notification.permission === 'default' && !store.get('asi.notifyAsked', 0) ? h('div', { class: 'banner info' },
        h('span', null, '🔔 Aktifkan notifikasi supaya tahu saat ada MHC baru yang perlu Anda proses.'),
        h('div', { class: 'row-btns' }, h('button', { class: 'btn small primary', onclick: askNotify }, 'Aktifkan'),
          h('button', { class: 'btn small ghost', onclick: function () { store.set('asi.notifyAsked', 1); render(); } }, 'Nanti'))) : null,
      d && can('mhcInput') ? h('div', { class: 'banner info' }, h('span', null, 'Ada draft MHC yang belum selesai' + (d.values && d.values.CUSTOMER ? ' (' + d.values.CUSTOMER + ')' : '') + '.'),
        h('button', { class: 'btn small', onclick: function () { startWizard(); } }, 'Lanjutkan')) : null,
      h('div', { class: 'tiles' },
        can('mhcInput') ? tile('＋', 'MHC Baru', 'Isi pemeriksaan unit · checklist · parts · foto', function () { startWizard(); }, 'accent') : null,
        can('slReview') ? tile('✍', 'Review MHC', 'Cek temuan, tambah parts rekomendasi, isi JDS, tanda tangani', inbox('review'), C.review ? 'accent' : '', C.review)
          : can('partsJds') ? tile('⌕', 'Cari Part di JDS', 'Part yang tidak ada di Stock On Hand', inbox('jds'), '', C.jds) : null,
        can('quoteCreate|quoteStatus') ? (isPssrOnly() ? (C.mylate ? tile('⏰', 'Lewat ' + (mhc().submitDays || 3) + ' hari', 'Quotation belum dikirim ke customer — isi alasannya', inbox('mylate'), 'late', C.mylate) : null)
          : (C.late ? tile('⏰', 'Lewat ' + (mhc().submitDays || 3) + ' hari', 'Quotation belum dikirim ke customer — isi alasannya', inbox('late'), 'late', C.late) : null)) : null,
        can('quoteCreate') ? tile('Rp', 'Perlu Quotation', 'MHC sudah disetujui SL · upload quotation SAP (PDF), nomor & nilai terisi otomatis', inbox('needquote'), C.needquote ? 'accent' : '', C.needquote) : null,
        can('quoteMonitor') ? (isPssrOnly() ? tile('⇄', 'Quotation saya', (C.myfudue ? C.myfudue + ' perlu di-follow up · ' : '') + 'Follow up customer, catat hasilnya, update Negosiasi / PO / Lose', function () { openQuotes(); }, C.myfudue ? 'accent' : '', C.myfudue)
          : tile('⇄', 'Monitoring Quotation', 'Quotation berjalan per PSSR, umur, nilai & follow up' + (C.fudue ? ' · ' + C.fudue + ' perlu follow up' : ''), function () { openQuotes(); }, '', C.fudue)) : null,
        can('callCenter') ? tile('☏', 'Survei Kepuasan', (C.ccDue ? C.ccDue + ' perlu ditelepon · ' : '') + (C.ccLate ? C.ccLate + ' lewat batas · ' : '') + 'Parts & Service maks. ' + (ccCfg().dueWorkdays || 2) + ' hari kerja setelah invoice', function () { openCc(); }, C.ccDue ? 'accent' : '', C.ccDue) : null,
        can('callCenter') ? tile('📣', 'Call Out', (C.callOutDue ? C.callOutDue + ' perlu ditelepon · ' : '') + 'Livelink Service Reminder (JCB) & Promotion Program', function () { openCallOut(); }, C.callOutDue ? 'accent' : '', C.callOutDue) : null,
        can('callCenter') ? tile('☎', 'Call In', (C.callInWa ? C.callInWa + ' perlu diteruskan / diinfokan ke WA · ' : '') + 'Catat telepon / WA masuk: Part, Service, Unit, Keluhan, Lainnya', function () { openCallIn(); }, C.callInWa ? 'accent' : '', C.callInWa)
          : can('callInView') ? tile('☎', 'Permintaan Customer', (C.callInOpen ? C.callInOpen + ' untuk Anda · ' : '') + 'Permintaan Part / Service dari Call Center', function () { openCallIn('mine'); }, C.callInOpen ? 'accent' : '', C.callInOpen) : null,
        can('complaintView') ? tile('⚠', 'Keluhan Customer', can('callCenter') ? 'Pantau keluhan yang diteruskan ke cabang sampai Selesai' : (C.complaintsOpen ? C.complaintsOpen + ' perlu tindakan · ' : '') + 'Keluhan dari survei Call Center — isi tindakan sampai Selesai',
          function () { openComplaints(can('callCenter') ? 'open' : 'mine'); }, C.complaintsOpen && !can('callCenter') ? 'accent' : '', C.complaintsOpen) : null,
        can('ccRekap') ? tile('▦', 'Rekap Survei', 'CSAT & NPS per cabang, mekanik, PSSR · Excel', function () { openCcRekap(); }) : null,
        invoiceOnly() ? tile('☎', 'MHC Selesai (Invoice)', 'Daftar MHC ber-invoice · kontak customer & PDF', inbox('invoice'), '', null)
          : canViewMhc() ? tile('☰', 'Daftar MHC', 'Cari MHC, lihat detail, download PDF', inbox(defaultFilter())) : null,
        can('marInput') ? tile('◷', 'Mechanics Activity Report', C.marMissing ? C.marMissing + ' hari kerja belum diisi — isi kegiatan atau catat Tidak masuk' : 'Catat kegiatan harian: travel, working, training, reporting, standby', function () { openMar(); if (C.marMissing) { S.mar.mode = 'hist'; loadMarHist(); } }, C.marMissing ? 'accent' : '', C.marMissing) : null,
        can('marReview|marExport') ? tile('◷', can('marReview') ? 'Review MAR' : 'Download MAR', can('marReview') ? 'Cek jam kerja & overtime mekanik, OK / revisi per hari' : 'Rekap MAR mekanik cabang · download Excel',
          function () { openMarTeam(); }, C.marPending ? 'accent' : '', C.marPending) : null,
        tile('⇅', 'Antrean', n ? n + ' data menunggu dikirim' : 'Semua data sudah terkirim', function () { go('queue'); }, '', n || null)),
      soon.length ? h('h3', { class: 'sec-t' }, 'Segera hadir') : null,
      soon.length ? h('div', { class: 'tiles small' }, soon.map(function (m) { return tile(m[1], m[2], 'Tahap berikutnya', null, 'soon'); })) : null);
  }
  // Menu form berikutnya: tampil hanya untuk role yang mengisinya (ADMIN_HO selalu)
  var NEXT_MENUS = [
    ['yardInput', '◫', 'Machine Yard Activity', ['MEKANIK', 'SERVICE_LEADER', 'ADMIN_PS']],
    ['popUpdate', '⟳', 'Update Population', ['ADMIN_PS', 'PSSR']]
  ];
  function hasRole(list) { var R = S.session.user.roles || []; return R.indexOf('ADMIN_HO') >= 0 || list.some(function (r) { return R.indexOf(r) >= 0; }); }
  // hak akses dari server bila ada; cadangan dari role (untuk sesi login versi lama)
  function allowed(perm, roles) { var P = perms(); return perm in P ? !!P[perm] : hasRole(roles); }
  function invoiceOnly() { var P = perms(); if ('mhcViewInvoice' in P) return !P.mhcView && !!P.mhcViewInvoice; var R = S.session.user.roles || []; return R.length > 0 && R.every(function (r) { return r === 'CALL_CENTER'; }); }
  function canViewMhc() { var P = perms(); if ('mhcViewInvoice' in P) return !!(P.mhcView || P.mhcViewInvoice); return true; }
  function greetName(n) {
    var parts = String(n || '').split(/\s+/).filter(function (w) { return w.replace(/\./g, '').length > 1; });
    return parts[0] || String(n || '').split(' ')[0];
  }
  function defaultFilter() { if (invoiceOnly()) return 'invoice'; if (can('slReview')) return 'review'; return can('partsJds') && (S.counts || {}).jds ? 'jds' : can('quoteCreate') ? 'needquote' : can('quoteStatus') ? (isPssrOnly() ? 'myopen' : 'open') : can('mhcInput') ? 'mine' : 'all'; }

  /* ================= wizard ================= */
  var STEPS = ['Unit', 'Checklist', 'Summary', 'Parts', 'Foto', 'Kirim'];
  function draftOwner() { return 'draft|' + S.session.company + '|' + S.session.user.username; }
  function newDraft() {
    var u = S.session.user;
    return { step: 0, values: { DATE: todayISO(), NIK: u.nik || store.get(KEY.nik, '') }, checklist: {}, captions: {}, photoSlots: [], parts: [], hasSig: false, hasTsig: false,
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
    var d = S.wiz.d, keys = d.photoSlots.concat(sigSlotsOf(d));
    Promise.all(keys.map(function (slot) { return idb.get('photos', photoKey(draftOwner(), slot)).then(function (p) { if (p && S.wiz) S.wiz.thumbs[slot] = URL.createObjectURL(p.small || p.blob); }); }))
      .then(function () { if (S.view === 'mhc' && S.wiz && (S.wiz.d.step === 4 || S.wiz.d.step === 5)) render(); });
  }
  function discardDraft() {
    if (!confirm('Hapus draft MHC ini? Semua isian dan foto akan dihapus.')) return;
    var d = S.wiz.d, keys = d.photoSlots.concat(['sig', 'tsig']);
    Promise.all(keys.map(function (s) { return idb.del('photos', photoKey(draftOwner(), s)); })).then(function () { store.del(KEY.draft(S.session)); S.wiz = null; go('home'); });
  }
  function badCount(d) { var n = 0; mhc().groups.forEach(function (g) { g.items.forEach(function (it) { var x = d.checklist[it.col]; if (x && x.c === 'BAD') n++; }); }); return n; }
  function needsParts(d) { return badCount(d) > 0 || d.values.STATUS === 'BREAKDOWN' || d.values.STATUS === 'RUNNING WITH NOTE'; }
  function stepErrors(i) {
    var d = S.wiz.d, M = mhc(), e = [];
    if (i === 0) {
      if (!d.values.CUSTOMER) e.push('Customer'); if (!d.values.SN) e.push('Serial Number'); if (!d.values.DATE) e.push('Date');
      if (S.boot.branches.length > 1 && !d.branch) e.push('Branch');
      if (inspRole() !== 'PSSR' && d.values.PSSR && !d.values.PSSR_ATTEND) e.push('PSSR ikut ke lokasi?');
    } else if (i === 1) {
      M.groups.forEach(function (g) { g.items.forEach(function (it) {
        var x = d.checklist[it.col];
        if (!x || !x.c) e.push(g.title + ': ' + it.label); else if (x.c === 'BAD' && !String(x.r || '').trim()) e.push('Remarks BAD: ' + it.label);
      }); });
    } else if (i === 2) {
      if (!d.values.STATUS) e.push('Machine Status'); if (!String(d.values.DETAIL || '').trim()) e.push('Detail Problem'); if (!String(d.values.ACTION || '').trim()) e.push('Action');
    } else if (i === 3) {
      d.parts.forEach(function (p, k) { if (!String(p.partNo || '').trim()) e.push('Part ' + (k + 1) + ': Part Number'); if (!(Number(p.qty) > 0)) e.push('Part ' + (k + 1) + ': Qty'); if (!p.cat) e.push('Part ' + (k + 1) + ': Kategori'); });
    } else if (i === 4) {
      M.photos.forEach(function (p) { if (p.required && d.photoSlots.indexOf(p.slot) < 0) e.push('Foto ' + p.label); });
    } else if (i === 5) {
      if (!d.hasTsig) e.push('Tanda tangan Inspector');
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
      function (r) {
        var d = S.wiz.d;
        if (d.values.CALL_ID) {
          // customer/unit lain di jalur Service Call yang sama: ganti data unit, Call ID tetap
          ['SN', 'BRAND', 'MODEL', 'CUSTOMER', 'LOCATION', 'ENG_NO', 'ENG_MODEL', 'PHONE', 'CONTACT', 'HM'].forEach(function (k) { d.values[k] = ''; });
          d.values.SN = r[0]; d.values.BRAND = r[1]; d.values.MODEL = r[2]; d.values.CUSTOMER = r[3]; d.values.LOCATION = r[4]; d.values.ENG_NO = r[7]; d.values.PHONE = r[6];
          saveDraft(); render(); toast('Unit diganti ke ' + (r[3] || r[0]) + ' — Call ID ' + d.values.CALL_ID + ' tetap', 'ok');
        } else { setVals({ SN: r[0], BRAND: r[1], MODEL: r[2], CUSTOMER: r[3], LOCATION: r[4], ENG_NO: r[7], PHONE: r[6] }); toast('Data unit terisi — silakan cek', 'ok'); }
      },
      'Ketik SN / customer / model…');
    var callNote = d.values.CALL_ID ? h('div', { class: 'banner info col' },
      h('span', null, 'Call ID ', h('b', null, d.values.CALL_ID), ' dipilih. Customer/unit lain di jalur Service Call ini? Cari unitnya di bawah — Call ID tetap ', d.values.CALL_ID, '.'),
      h('button', { type: 'button', class: 'btn small', onclick: function () { var el = document.querySelector('#pop-pick input'); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); } } },
        'Unit / customer lain di jalur ini? Pilih unit (Call ID tetap)')) : null;
    popPick.id = 'pop-pick';
    var branchField = S.boot.branches.length > 1
      ? h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Branch', h('span', { class: 'req' }, ' *')),
          h('select', { class: 'inp', onchange: function (e) { d.branch = e.target.value; saveDraft(); } }, S.boot.branches.map(function (b) { return h('option', { value: b, selected: b === d.branch }, b); })))
      : h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Branch'), h('div', { class: 'ro' }, S.boot.branches[0] || u.branch));
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '1 · Data Unit'), scPick, callNote, popPick),
      h('div', { class: 'card grid2' },
        field('Date', 'DATE', { type: 'date', required: true, half: true }), branchField,
        field('Call ID', 'CALL_ID', { half: true, ph: inspRole() === 'PSSR' ? 'Boleh kosong — dipilih SL' : 'Dari SAP' }), field('Hours Meter', 'HM', { num: true, half: true, ph: '0' }),
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
    } }, h('option', { value: '' }, ph), opts.map(function (p) { return h('option', { value: p.name, selected: p.name === cur }, p.name + (p.nik ? ' · ' + p.nik : '') + (p.own === false ? ' · cabang ' + p.branch : '')); }));
    return h('div', { class: 'field' }, h('label', { class: 'lbl', for: sel.id }, label), sel);
  }
  function inspRole() { var R = S.session.user.roles || []; return R.indexOf('MEKANIK') >= 0 ? 'Mekanik' : R.indexOf('PSSR') >= 0 ? 'PSSR' : 'Mekanik'; }
  function wizTeam() {
    var d = S.wiz.d, u = S.session.user, M = mhc(), v = d.values, asPssr = inspRole() === 'PSSR';
    var mech = (M.mechanics || []).filter(function (p) { return p.name !== u.name; }), pssr = M.pssr || [];
    var pssrField = pssr.length || v.PSSR ? personSelect('PSSR penanggung jawab customer', 'PSSR', pssr, [], '— Tidak ada / belum ditentukan —')
      : field('PSSR penanggung jawab customer', 'PSSR');
    return h('div', { class: 'card' }, h('h2', null, 'Tim Pemeriksa'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Inspector'), h('div', { class: 'ro' }, u.name), h('div', { class: 'muted small' }, 'Penanggung jawab (Anda) · ' + inspRole())),
        field('NIK', 'NIK', { half: true })),
      mech.length ? [
        personSelect('Mekanik 2 (pendamping)', 'TECH2', mech, [v.TECH3], '— Tidak ada —'),
        v.TECH2 ? personSelect('Mekanik 3 (cadangan)', 'TECH3', mech, [v.TECH2], '— Tidak ada —') : null
      ] : h('p', { class: 'hint' }, 'Daftar mekanik pendamping diambil dari tab Users (Form Role MEKANIK, semua cabang).'),
      asPssr ? h('p', { class: 'hint' }, 'Anda sebagai PSSR otomatis tercatat sebagai PSSR yang meng-follow up quotation MHC ini.') : [pssrField,
      v.PSSR ? h('div', { 'data-missing': v.PSSR_ATTEND ? null : '1' }, h('label', { class: 'lbl' }, 'PSSR ikut ke lokasi?', h('span', { class: 'req' }, ' *')),
        segmented(['Ya', 'Tidak'], v.PSSR_ATTEND, function (x) { d.values.PSSR_ATTEND = x; saveDraft(); })) : null,
      h('p', { class: 'hint' }, 'PSSR tetap dipilih walaupun tidak ikut, karena PSSR inilah yang meng-follow up quotation.')]);
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
          h('button', { type: 'button', class: 'icon-btn danger', title: 'Hapus', onclick: function () { d.parts.splice(k, 1); saveDraft(); render(); } }, '✕')),
        h('div', { class: 'part-cat', 'data-missing': p.cat ? null : '1' }, catSelect(p.cat || '', function (c) { p.cat = c; saveDraft(); })));
    });
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '4 · Parts Rekomendasi'),
        need ? h('p', { class: 'muted small' }, 'Ada temuan BAD atau status unit ' + (d.values.STATUS || '') + '. Pilih part yang perlu diganti dari Stock On Hand, lalu pilih kategorinya.')
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
  /** Kanvas tanda tangan. opts: { get(): url|null, save(blob), clear() } */
  function sigCanvas(opts) {
    var cv = h('canvas', { class: 'sig', width: 600, height: 200 }), ctx = cv.getContext('2d'), drawing = false, dirty = false;
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    var pos = function (e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.addEventListener('pointerdown', function (e) { e.preventDefault(); drawing = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { } var p = pos(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); });
    cv.addEventListener('pointermove', function (e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p[0], p[1]); ctx.stroke(); dirty = true; });
    ['pointerup', 'pointercancel'].forEach(function (ev) { cv.addEventListener(ev, function () { if (!drawing) return; drawing = false; if (dirty) save(); }); });
    var save = debounce(function () { cv.toBlob(function (b) { opts.save(b); }, 'image/png'); }, 300);
    var cur = opts.get && opts.get();
    if (cur) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, cv.width, cv.height); }; img.src = cur; }
    return h('div', { class: 'sig-wrap' }, cv, h('button', { type: 'button', class: 'linkbtn danger', onclick: function () {
      ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; opts.clear();
    } }, 'Hapus tanda tangan'));
  }
  function signaturePad(slot) {
    var d = S.wiz.d, flag = slot === 'tsig' ? 'hasTsig' : 'hasSig';
    return sigCanvas({
      get: function () { return d[flag] ? S.wiz.thumbs[slot] : null; },
      save: function (b) { idb.put('photos', { blob: b, at: Date.now() }, photoKey(draftOwner(), slot)).then(function () { d[flag] = true; if (S.wiz.thumbs[slot]) URL.revokeObjectURL(S.wiz.thumbs[slot]); S.wiz.thumbs[slot] = URL.createObjectURL(b); saveDraft(); }); },
      clear: function () { idb.del('photos', photoKey(draftOwner(), slot)).then(function () { d[flag] = false; delete S.wiz.thumbs[slot]; saveDraft(); }); }
    });
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
    var d = S.wiz.d, M = mhc(), all = [0, 1, 2, 3, 4, 5].map(stepErrors), v = d.values, cnt = { GOOD: 0, BAD: 0, 'N/A': 0 };
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
      h('div', { class: 'card', 'data-missing': d.hasTsig ? null : '1' }, h('h2', null, 'Tanda tangan Inspector', h('span', { class: 'req' }, ' *')),
        h('p', { class: 'muted small' }, 'Diperiksa oleh: ' + [S.session.user.name, v.TECH2, v.TECH3].filter(Boolean).join(', ')), signaturePad('tsig')),
      h('div', { class: 'card' }, h('h2', null, 'Customer / Operator'), field('Nama Customer PIC', 'CUST_PIC'),
        h('label', { class: 'lbl' }, 'Tanda tangan customer'), signaturePad('sig')),
      h('div', { class: 'card' }, h('h2', null, 'Lokasi GPS'), h('div', { class: 'row-btns' }, h('span', { class: v.GPS ? 'ok-text' : 'muted' }, v.GPS || 'Belum diambil'),
        h('button', { type: 'button', class: 'btn small', onclick: getGps }, v.GPS ? 'Ambil ulang' : 'Ambil lokasi'))),
      h('p', { class: 'hint' }, 'Setelah dikirim, MHC masuk ke Service Leader untuk direview & ditandatangani; PDF report bisa dicetak setelah itu. Tanpa sinyal, data tersimpan di HP dan terkirim sendiri saat online.'));
  }
  function kvRow(k, v) { return v === '' || v == null ? null : h('div', { class: 'kv' }, h('span', null, k), h('b', null, String(v))); }
  function submitWizard() {
    var errs = [0, 1, 2, 3, 4, 5].map(stepErrors).reduce(function (a, b) { return a.concat(b); }, []);
    if (errs.length) { toast('Masih ada ' + errs.length + ' isian yang belum lengkap', 'err'); return; }
    var d = S.wiz.d, v = Object.assign({}, d.values), id = uid();
    if (v.HM !== '' && v.HM != null) { var n = parseNum(v.HM); v.HM = isNaN(n) ? v.HM : n; }
    var checklist = {};
    Object.keys(d.checklist).forEach(function (c) { var x = d.checklist[c]; if (x && x.c) checklist[c] = { c: x.c, r: x.r || '' }; });
    var item = {
      id: id, kind: 'mhc', company: S.session.company, username: S.session.user.username, createdAt: Date.now(), status: 'pending',
      photoSlots: d.photoSlots.slice().sort(function (a, b) { return a - b; }), hasSig: !!d.hasSig, hasTsig: !!d.hasTsig, uploaded: {},
      payload: { values: v, checklist: checklist, captions: d.captions, branch: d.branch,
                 parts: d.parts.map(function (p) { return { partNo: p.partNo, desc: p.desc, qty: Number(p.qty) || 1, cat: p.cat || '' }; }) },
      marPrefill: { DATE: v.DATE, CUSTOMER: v.CUSTOMER, BRAND: v.BRAND, MODEL: v.MODEL, SN: v.SN, LOCATION: v.LOCATION, CALL_ID: v.CALL_ID, DESC: 'Machine Health Check' },
      summary: { title: v.CUSTOMER, sub: [fmtDate(v.DATE), v.MODEL, v.SN && 'SN ' + v.SN, v.STATUS, d.parts.length ? d.parts.length + ' part' : ''].filter(Boolean).join(' · ') }
    };
    var keys = item.photoSlots.concat(sigSlotsOf(item));
    Promise.all(keys.map(function (slot) {
      return idb.get('photos', photoKey(draftOwner(), slot)).then(function (p) { return idb.put('photos', p, photoKey(id, slot)).then(function () { return idb.del('photos', photoKey(draftOwner(), slot)); }); });
    })).then(function () { return saveItem(item); }).then(function () {
      store.del(KEY.draft(S.session)); Object.keys(S.wiz.thumbs).forEach(function (k) { URL.revokeObjectURL(S.wiz.thumbs[k]); }); S.wiz = null;
      toast(online() ? 'Tersimpan — mengirim ke Google Sheet…' : 'Tersimpan di HP — terkirim otomatis saat online', 'ok');
      go('queue'); syncQueue();
    }).catch(function (e) { toast('Gagal menyimpan: ' + e.message, 'err'); });
  }

  /* ================= daftar ================= */
  function isPssrOnly() { var R = S.session.user.roles || []; return R.indexOf('PSSR') >= 0 && R.indexOf('ADMIN_PS') < 0 && R.indexOf('ADMIN_HO') < 0; }
  var FILTERS = [['review', 'Review MHC', 'slReview'], ['late', 'Lewat batas hari', 'lateAll'], ['mylate', 'Lewat batas hari', 'pssrOnly'], ['jds', 'Cari Part di JDS', 'partsJds'], ['needquote', 'Perlu Quotation', 'quoteCreate'], ['myopen', 'Quotation saya', 'pssrOnly'],
                 ['open', 'Quotation Berjalan', 'quoteStatus'], ['myfudue', 'Perlu follow up', 'pssrOnly'], ['fudue', 'Perlu follow up', 'lateAll'], ['invoice', 'Selesai (Invoice)', 'invOnly'],
                 ['mine', 'Milik saya', 'mhcInput'], ['all', 'Semua', '']];
  function openList(f) { S.list.filter = f; S.list.rows = null; go('list'); loadList(); }
  function loadList() {
    var L = S.list;
    if (!online()) { toast('Daftar MHC butuh koneksi internet', 'warn'); return; }
    L.loading = true; if (S.view === 'list') render();
    api('formListMhc', { token: S.session.token, q: L.q, filter: L.filter || 'all', limit: 50, old: !!L.old }, 60000).then(function (r) { L.rows = r.rows; L.hasMore = !!r.hasMore; L.loading = false; setCounts(r.counts); if (S.view === 'list') render(); })
      .catch(function (e) { L.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'list') render(); });
  }
  function sideChips(r) {
    return [r.pStatus ? h('span', { class: 'chip ' + (STATUS_TONE[r.pStatus] || '') }, 'P: ' + r.pStatus) : null,
            r.sStatus ? h('span', { class: 'chip ' + (STATUS_TONE[r.sStatus] || '') }, 'S: ' + r.sStatus) : null];
  }
  function viewList() {
    var L = S.list, C = S.counts || {};
    if (!L.filter) L.filter = defaultFilter();
    var filters = invoiceOnly() ? FILTERS.filter(function (f) { return f[0] === 'invoice'; })
      : FILTERS.filter(function (f) { return f[2] !== 'invOnly' && (!f[2] || (f[2] === 'pssrOnly' ? isPssrOnly() : f[2] === 'lateAll' ? can('quoteCreate|quoteStatus') && !isPssrOnly() : can(f[2]))); });
    var q = h('input', { class: 'inp', type: 'search', placeholder: 'Cari MHC No / customer / SN / Call ID / No. Quotation…', value: L.q, enterkeyhint: 'search' });
    var head = h('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); L.q = q.value.trim(); loadList(); } },
      h('div', { class: 'chips filt' }, filters.map(function (f) {
        var n = C[f[0]];
        return h('button', { type: 'button', class: 'fchip' + (L.filter === f[0] ? ' on' : ''), onclick: function () { L.filter = f[0]; loadList(); } }, f[1], n ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q, h('button', { class: 'btn primary', type: 'submit' }, 'Cari')),
      L.filter === 'invoice' ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', id: 'l-old', checked: !!L.old, onchange: function (e) { L.old = e.target.checked; loadList(); } }),
        'Tampilkan data lama — history sebelum aplikasi, tidak dihitung di angka & notifikasi') : null);
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
            h('td', null, chip(r.mhcStatus), r.needReason ? chip('Lewat ' + r.lateDays + ' hari', 'bad') : null, r.callCount > 1 ? chip('Call ID ' + r.callId + ' · ' + r.callCount + ' MHC', 'info') : null, !r.callId && !r.isOld && !r.approved ? chip('Call ID belum ada', 'wait') : null), h('td', { class: 'small' }, r.parts), h('td', null, sideChips(r)), h('td', { class: 'num' }, fmtRp(r.totalQ)));
        }))));
    } else body = L.rows.map(function (r) {
      return h('button', { class: 'card item', onclick: function () { openDetail(r); } },
        h('div', { class: 'item-top' }, h('b', null, r.customer || '(tanpa customer)'), h('span', { class: 'muted' }, fmtDate(r.date))),
        h('div', { class: 'muted small' }, [r.mhcNo || 'Data lama', [r.brand, r.model].filter(Boolean).join(' '), r.sn && 'SN ' + r.sn, r.tech].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, chip(r.mhcStatus), r.needReason ? chip('Lewat ' + r.lateDays + ' hari', 'bad') : null, r.callCount > 1 ? chip('Call ID sama · ' + r.callCount + ' MHC', 'info') : null, !r.callId && !r.isOld && !r.approved ? chip('Call ID belum ada', 'wait') : null, r.status ? chip(r.status, machineTone(r.status)) : null, r.bad ? chip(r.bad + ' BAD', 'bad') : null, sideChips(r)),
        r.parts ? h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Parts: ' + r.parts) : null);
    });
    var more = L.rows && L.rows.length && L.hasMore ? h('button', { class: 'btn block', style: 'margin-bottom:12px', disabled: !!L.moreLoading, onclick: function () {
      L.moreLoading = true; render();
      api('formListMhc', { token: S.session.token, q: L.q, filter: L.filter || 'all', limit: 50, offset: L.rows.length, old: !!L.old }, 60000)
        .then(function (r) { L.rows = L.rows.concat(r.rows); L.hasMore = !!r.hasMore; L.moreLoading = false; render(); })
        .catch(function (e) { L.moreLoading = false; toast(e.message, 'err'); render(); });
    } }, L.moreLoading ? 'Memuat…' : 'Muat 50 lagi') : null;
    return h('div', null, head, body, more);
  }

  /* ================= detail ================= */
  function openDetail(r) {
    var from = S.view === 'quotes' ? 'quotes' : S.view === 'detail' && S.detail ? S.detail.from : 'list';
    S.detail = { row: r, values: null, loading: true, from: from }; go('detail');
    api('formGetMhc', { token: S.session.token, row: r.row }).then(function (x) {
      S.detail.values = x.values; S.detail.parts = x.parts; S.detail.sides = x.sides; S.detail.formulaCols = x.formulaCols; S.detail.loading = false;
      S.detail.sameCall = x.sameCall || []; S.detail.approved = x.approved !== false; S.detail.late = x.late || {}; S.detail.quoteLocked = !!x.quoteLocked;
      S.detail.followUps = x.followUps || []; S.detail.fu = x.fu || {}; S.detail.checklist = x.checklist || null; S.detail.cc = x.cc || null;
      if (S.view === 'detail') render();
    }).catch(function (e) { S.detail.loading = false; toast(e.message, 'err'); if (S.view === 'detail') render(); });
  }
  function downloadPdf(r, regen, kind) {
    toast(regen ? 'Membuat ulang PDF…' : kind === 'quote' ? 'Mengunduh PDF quotation…' : 'Mengunduh PDF…');
    api('formGetPdf', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, regenerate: !!regen, kind: kind || '' }, 120000).then(function (x) {
      var bin = atob(x.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
      var a = h('a', { href: url, download: x.name }); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      toast((x.draft ? 'Draft PDF (belum disetujui SL): ' : 'PDF siap: ') + x.name, 'ok');
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  /* ---------- Excel (.xlsx) tanpa library: zip "store" + XML spreadsheet ---------- */
  var CRC_T = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), name);
      off += head.length + name.length + data.length;
    });
    var csize = central.reduce(function (a, x) { return a + x.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(off), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xmlEsc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function makeXlsx(sheets) {
    var col = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '</Relationships>' }
    ];
    sheets.forEach(function (sh, i) {
      var widths = sh.widths ? '<cols>' + sh.widths.map(function (w, j) { return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
      var rows = sh.rows.map(function (row, r) {
        return '<row r="' + (r + 1) + '">' + row.map(function (v, c) {
          var ref = col(c) + (r + 1);
          if (v === '' || v == null) return '';
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + widths + '<sheetData>' + rows + '</sheetData></worksheet>' });
    });
    return zipStore(files);
  }
  function exportPartsXlsx(r, v, parts) {
    var F = mhc().f, g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
    var num = function (x) { var n = Number(x); return x === '' || isNaN(n) ? (x || '') : n; };
    var sap = [['Item No.', 'Quantity']].concat(parts.map(function (p) { return [p.found === 'Tidak' && p.jdsNo ? p.jdsNo : p.partNo, num(p.qty)]; }));
    var detail = [['MHC No', r.mhcNo], ['Customer', g('CUSTOMER')], ['Unit', [g('BRAND'), g('MODEL'), g('SN') && 'SN ' + g('SN')].filter(Boolean).join(' · ')],
      ['Tanggal MHC', fmtDate(g('DATE'))], ['Cabang', g('BRANCH')], [],
      ['No', 'Part Number', 'Deskripsi', 'Kategori', 'Qty', 'Stock Cabang', 'Stock Cabang Lain', 'Ada di Stock On Hand', 'JDS Part Number', 'Catatan JDS', 'Direkomendasikan oleh']]
      .concat(parts.map(function (p, i) { return [i + 1, p.partNo, p.desc, p.cat || '', num(p.qty), num(p.stockBranch), p.stockOther, p.found, p.jdsNo, p.jdsNote, p.by]; }));
    var blob = makeXlsx([{ name: 'SAP Upload', rows: sap, widths: [22, 10] }, { name: 'Parts Rekomendasi', rows: detail, widths: [12, 20, 34, 30, 6, 12, 22, 18, 20, 26, 24] }]);
    var url = URL.createObjectURL(blob), a = h('a', { href: url, download: (r.mhcNo || 'MHC') + '_Parts.xlsx' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast('Excel parts diunduh', 'ok');
  }

  /* ---------- Kategori parts rekomendasi ---------- */
  var DEFAULT_CATS = ['Attachments', 'Bodyworks', 'Electrics Machine Cab & Engine', 'Controls, Machine Engine & Steering', 'Hydraulics', 'Transmission', 'Brakes', 'Engine Ancillaries'];
  function partCats() { var M = mhc(); return (M && M.partCategories) || DEFAULT_CATS; }
  function matchCat(x) {
    var s = String(x == null ? '' : x).trim(), L = partCats();
    if (!s) return '';
    if (/^\d+$/.test(s)) return L[Number(s) - 1] || '';
    var k = function (t) { return String(t).toUpperCase().replace(/[^A-Z]/g, ''); }, ks = k(s);
    for (var i = 0; i < L.length; i++) if (k(L[i]) === ks) return L[i];
    if (ks === 'HYDARAULICS' || ks === 'HYDRAULIC') return 'Hydraulics';
    for (var j = 0; j < L.length; j++) if (ks.length >= 4 && k(L[j]).indexOf(ks) === 0) return L[j];
    return '';
  }
  function catSelect(cur, onChange) {
    return h('select', { class: 'inp sm cat-sel' + (cur ? '' : ' missing'), 'aria-label': 'Kategori part', onchange: function (e) { e.target.classList.toggle('missing', !e.target.value); onChange(e.target.value); } },
      h('option', { value: '' }, '— Pilih kategori —'), partCats().map(function (c, i) { return h('option', { value: c, selected: c === cur }, (i + 1) + '. ' + c); }));
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ---------- Baca Excel (.xlsx) / CSV tanpa library ---------- */
  function readZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), eocd = -1, dec = new TextDecoder(), files = {};
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('File Excel tidak bisa dibaca');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    for (var k = 0; k < n && p + 46 <= u8.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nl + xl + cl;
    }
    return function (name) {
      var f = files[name];
      if (!f) return Promise.resolve(null);
      var start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return Promise.resolve(dec.decode(data));
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Browser ini belum bisa membaca .xlsx — di Excel pilih Save As › CSV, lalu upload file CSV-nya'));
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return dec.decode(b); });
    };
  }
  function xlsxRows(buf) {
    var get = readZip(buf), P = new DOMParser();
    var xml = function (t) { return t ? P.parseFromString(t, 'application/xml') : null; };
    var tags = function (el, tag) { return el ? Array.prototype.slice.call(el.getElementsByTagNameNS('*', tag)) : []; };
    return Promise.all([get('xl/workbook.xml'), get('xl/_rels/workbook.xml.rels'), get('xl/sharedStrings.xml')]).then(function (t) {
      var wb = xml(t[0]), rels = xml(t[1]);
      var ss = tags(xml(t[2]), 'si').map(function (si) { return tags(si, 't').filter(function (x) { return x.parentNode.localName !== 'rPh'; }).map(function (x) { return x.textContent; }).join(''); });
      var sheet = tags(wb, 'sheet')[0], target = 'worksheets/sheet1.xml';
      if (sheet) {
        var rid = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
        tags(rels, 'Relationship').forEach(function (r) { if (r.getAttribute('Id') === rid) target = r.getAttribute('Target'); });
      }
      var path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      return get(path).then(function (st) {
        if (!st) throw new Error('Sheet pertama tidak ditemukan di file Excel');
        var rows = [];
        tags(xml(st), 'row').forEach(function (rw) {
          var ri = Number(rw.getAttribute('r')) - 1, out = [];
          tags(rw, 'c').forEach(function (c, ci) {
            var m = String(c.getAttribute('r') || '').match(/^([A-Z]+)/), col = ci;
            if (m) { col = 0; for (var q = 0; q < m[1].length; q++) col = col * 26 + m[1].charCodeAt(q) - 64; col--; }
            var ty = c.getAttribute('t'), v = tags(c, 'v')[0];
            out[col] = ty === 's' ? (ss[Number(v && v.textContent)] || '') : ty === 'inlineStr' ? tags(c, 't').map(function (x) { return x.textContent; }).join('') : (v ? v.textContent : '');
          });
          for (var z = 0; z < out.length; z++) if (out[z] === undefined) out[z] = '';
          rows[isNaN(ri) || ri < 0 ? rows.length : ri] = out;
        });
        for (var y = 0; y < rows.length; y++) if (!rows[y]) rows[y] = [];
        return rows;
      });
    });
  }
  function csvRows(text) {
    text = String(text).replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var d = [';', '\t', ','].reduce(function (a, c) { return first.split(c).length > first.split(a).length ? c : a; }, ',');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function readTableFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (u8[0] === 0x50 && u8[1] === 0x4b) return xlsxRows(buf);
      if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('Format .xls lama belum didukung — di Excel pilih Save As › Excel Workbook (.xlsx)');
      return csvRows(new TextDecoder().decode(buf));
    });
  }
  /** baris tabel → daftar part (kolom dicari dari judulnya: Part Number / Deskripsi / Qty / Kategori) */
  function partsFromRows(rows) {
    var norm = function (x) { return String(x == null ? '' : x).trim().toLowerCase().replace(/\s+/g, ' '); };
    var isPn = function (s) { return !/jds/.test(s) && /part\s*(number|no\b|no\.|num|#|code)|^p\/?n$|^item\s*(no|code|number)|kode\s*part|no\.?\s*part|^part$/.test(s); };
    var hr = -1, C = {};
    for (var i = 0; i < Math.min(rows.length, 20) && hr < 0; i++) (rows[i] || []).some(function (x) { if (isPn(norm(x))) { hr = i; return true; } return false; });
    if (hr >= 0) rows[hr].forEach(function (x, j) {
      var s = norm(x);
      if (C.pn === undefined && isPn(s)) C.pn = j;
      else if (C.desc === undefined && /desc|deskripsi|nama|description|item name|uraian/.test(s)) C.desc = j;
      else if (C.qty === undefined && /^(qty|q'ty|quantity|jumlah|jml)/.test(s)) C.qty = j;
      else if (C.cat === undefined && /kategori|category|section/.test(s)) C.cat = j;
    });
    else C = { pn: 0, desc: 1, qty: 2, cat: 3 };
    var out = [], unknown = 0, seen = {};
    rows.slice(hr + 1).forEach(function (r) {
      var pn = String(r[C.pn] == null ? '' : r[C.pn]).trim();
      if (!pn) return;
      var qty = C.qty !== undefined ? parseNum(r[C.qty]) : 1, raw = C.cat !== undefined ? String(r[C.cat] == null ? '' : r[C.cat]).trim() : '', cat = matchCat(raw);
      if (raw && !cat) unknown++;
      var key = pn.toUpperCase() + '|' + cat;
      if (seen[key]) { seen[key].qty += qty > 0 ? qty : 1; return; }   // part sama di-gabung qty-nya
      out.push(seen[key] = { partNo: pn, desc: C.desc !== undefined ? String(r[C.desc] == null ? '' : r[C.desc]).trim() : '', qty: qty > 0 ? qty : 1, cat: cat, fromFile: true });
    });
    return { parts: out, header: hr >= 0, unknownCat: unknown, hasCat: C.cat !== undefined };
  }
  function downloadPartsTemplate() {
    var cats = partCats();
    saveBlob(makeXlsx([{ name: 'Parts', rows: [['Part Number', 'Deskripsi', 'Qty', 'Kategori']], widths: [22, 36, 8, 36] },
      { name: 'Daftar Kategori', rows: [['No', 'Kategori']].concat(cats.map(function (c, i) { return [i + 1, c]; }),
        [[], ['', 'Kolom Kategori boleh diisi nama kategori atau nomornya (1-' + cats.length + ').'], ['', 'Baris yang Part Number-nya kosong dilewati. Part yang sama digabung qty-nya.']]), widths: [6, 70] }]),
      'Template_Parts_Rekomendasi.xlsx');
    toast('Template Excel diunduh', 'ok');
  }

  /* ---------- Baca PDF quotation SAP (pdf.js dimuat hanya saat dibutuhkan) ---------- */
  var PDFJS_SRC = [['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'],
                   ['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js']];
  var pdfJsP = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsP) return pdfJsP;
    var tryOne = function (i) {
      if (i >= PDFJS_SRC.length) return Promise.reject(new Error('Pembaca PDF tidak bisa dimuat — isi nomor & nilai manual'));
      return new Promise(function (res, rej) {
        var s = document.createElement('script'); s.src = PDFJS_SRC[i][0]; s.async = true;
        s.onload = function () { if (window.pdfjsLib) res(); else rej(); }; s.onerror = rej; document.head.appendChild(s);
      }).then(function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_SRC[i][1]; return window.pdfjsLib; }, function () { return tryOne(i + 1); });
    };
    return (pdfJsP = tryOne(0).catch(function (e) { pdfJsP = null; throw e; }));
  }
  /** teks PDF per baris (potongan teks dengan posisi y yang sama digabung, urut kiri → kanan) */
  function pdfTextLines(buf) {
    return loadPdfJs().then(function (lib) { return lib.getDocument({ data: new Uint8Array(buf) }).promise; }).then(function (doc) {
      var pages = []; for (var i = 1; i <= Math.min(doc.numPages, 6); i++) pages.push(i);
      return Promise.all(pages.map(function (n) { return doc.getPage(n).then(function (pg) { return pg.getTextContent(); }); }));
    }).then(function (tcs) {
      var lines = [];
      tcs.forEach(function (tc) {
        var rows = [];
        tc.items.forEach(function (it) {
          if (!it.str || !String(it.str).trim()) return;
          var x = it.transform[4], y = it.transform[5], ht = Math.abs(it.transform[3]) || it.height || 8;
          var row = null;
          for (var k = 0; k < rows.length; k++) if (Math.abs(rows[k].y - y) <= Math.max(2, ht * 0.45)) { row = rows[k]; break; }
          if (!row) rows.push(row = { y: y, items: [] });
          row.items.push({ x: x, w: it.width || 0, s: String(it.str) });
        });
        rows.sort(function (a, b) { return b.y - a.y; }).forEach(function (r) {
          r.items.sort(function (a, b) { return a.x - b.x; });
          var txt = '', end = null;
          r.items.forEach(function (it) { if (end !== null) txt += it.x - end > 6 ? '   ' : it.x - end > 1.2 ? ' ' : ''; txt += it.s; end = it.x + it.w; });
          lines.push(txt.replace(/\s+$/, ''));
        });
      });
      return lines;
    });
  }
  var BULAN = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6,
    jul: 7, juli: 7, july: 7, agu: 8, ags: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10,
    nov: 11, nopember: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12 };
  function toIsoDate(s) {
    s = String(s || '').trim(); var m, y, a, b, mo;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
      y = +m[3]; if (y < 100) y += 2000; a = +m[1]; b = +m[2];
      if (a <= 12 && b > 12) { var t = a; a = b; b = t; }   // format bulan/tanggal
      return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? y + '-' + pad(b) + '-' + pad(a) : '';
    }
    if ((m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})\.?[\s\-\/.,]+(\d{4})$/))) { mo = BULAN[m[2].toLowerCase()]; return mo ? m[3] + '-' + pad(mo) + '-' + pad(+m[1]) : ''; }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) { mo = BULAN[m[1].toLowerCase()]; return mo ? m[3] + '-' + pad(mo) + '-' + pad(+m[2]) : ''; }
    return '';
  }
  var DATE_TOK = '(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\s\\-]+[A-Za-z]{3,9}\\.?[\\s\\-,]+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2},?\\s+\\d{4})';
  var AMT_RE = /-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?(?![\d.,]*\d)|-?\d+[.,]\d{2}(?!\d)/g;
  function amountsIn(line) {
    var s = String(line).replace(new RegExp('\\b' + DATE_TOK.slice(1, -1).split('|')[0], 'g'), ' '), out = [], m;
    AMT_RE.lastIndex = 0;
    while ((m = AMT_RE.exec(s))) { var n = parseNum(m[0]); if (!isNaN(n)) out.push(n); }
    return out;
  }
  var SVC_RE = /\b(jasa|service|servis|labou?r|man\s?power|man\s?hours?|ongkos|transport\w*|akomodasi|accomodation|accommodation|mobilisasi|demobilisasi|travel\w*|perjalanan|kunjungan|visit|upah|charge|fee)\b/i;
  var SVC_CODE_RE = /(^|\s)SVC[-\/][\w\-\/]+/i;
  var TOT_RE = /\b(sub\s?-?total|total|grand\s?total|amount\s+due|dpp|ppn|vat|tax|pajak|pph|discount|diskon|potongan|rounding|pembulatan|down\s?payment|uang\s?muka|terbilang)\b/i;
  var SKIP_RE = /\b(npwp|telp|telepon|phone|fax|hp|rekening|account|a\/c|ac\s*:|swift|kode\s?pos)\b/i;
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  /** Ambil No. quotation, tanggal & nilai dari teks PDF quotation SAP.
      Hasil: side 'P' (parts saja) / 'S' (jasa saja: kode SVC-…) / 'PS' (campur), nilai per sisi dalam 2 versi:
      values.net = setelah diskon, sebelum PPN · values.total = termasuk PPN */
  function parseQuoteText(lines, ctx) {
    ctx = ctx || {};
    var L = (lines || []).map(function (l) { return String(l == null ? '' : l).replace(/ /g, ' '); });
    var res = { qno: '', date: '', side: '', sub: 0, disc: 0, net: 0, tax: 0, total: 0, items: [], notes: [], values: { net: { P: 0, S: 0 }, total: { P: 0, S: 0 } } };
    var TOK = '([A-Z0-9][A-Z0-9\\/.\\-]*\\d[A-Z0-9\\/.\\-]*)';
    var bad = function (t) { return !t || t.length < 3 || /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(t) || (ctx.mhcNo && t === ctx.mhcNo); };
    var hasTitle = L.slice(0, 40).some(function (l) { return /quotation|penawaran|quote/i.test(l); });
    var pats = [
      new RegExp('(?:sales\\s*)?(?:quotation|penawaran|quoted?)\\s*(?:no\\.?|number|nomor|num\\.?|#)\\s*[:.]?\\s*' + TOK, 'i'),
      new RegExp('(?:no\\.?|nomor)\\s*(?:quotation|penawaran|sq)\\s*[:.]?\\s*' + TOK, 'i'),
      new RegExp('(?:doc(?:ument)?\\.?\\s*(?:no\\.?|number|num\\.?)|no\\.?\\s*dok(?:umen)?\\.?)\\s*[:.]?\\s*' + TOK, 'i')];
    if (hasTitle) pats.push(new RegExp('(?:^|\\s{2,})(?:no|number|nomor)\\.?\\s*:\\s*' + TOK, 'i'));
    var labelOnly = /(quotation|penawaran|quoted?)\s*(no\.?|number|nomor)\s*[:.]?\s*$|^(no\.?|nomor)\s*(quotation|penawaran)\s*[:.]?\s*$/i;
    pats.some(function (re) {
      return L.some(function (l, i) {
        var m = l.match(re);
        if (m && !bad(m[1])) { res.qno = m[1].replace(/[.\-\/]+$/, ''); return true; }
        if (labelOnly.test(l.trim()) && L[i + 1]) { var m2 = L[i + 1].match(new RegExp('^\\s*[:.]?\\s*' + TOK, 'i')); if (m2 && !bad(m2[1])) { res.qno = m2[1]; return true; } }
        return false;
      });
    });
    // tanggal dokumen (bukan tanggal berlaku / kirim / jatuh tempo)
    var dre = new RegExp('(quoted\\s*date|posting\\s*date|document\\s*date|doc\\.?\\s*date|quotation\\s*date|tanggal\\s*(?:dokumen|penawaran)?|tgl\\.?|date)\\s*[:.]?\\s*' + DATE_TOK, 'i');
    L.some(function (l) {
      var m = l.match(dre);
      if (!m) return false;
      var before = l.slice(0, m.index + m[1].length).toLowerCase();
      if (/valid|berlaku|delivery|kirim|due|jatuh|expir|required|until|thru|s\.?d/.test(before.slice(-30))) return false;
      var iso = toIsoDate(m[2]); if (iso) { res.date = iso; return true; } return false;
    });
    if (!res.date) L.slice(0, 30).some(function (l) { var m = l.match(new RegExp(DATE_TOK)); var iso = m && toIsoDate(m[1]); if (iso) { res.date = iso; return true; } return false; });
    // baris item (antara judul tabel dan baris total) + baris ringkasan
    var head = -1;
    L.forEach(function (l, i) { if (head < 0 && /(desc|deskripsi|description|uraian|item|nama\s*barang)/i.test(l) && /(qty|quantity|jumlah|jml)/i.test(l) && /(price|harga|total|amount)/i.test(l)) head = i; });
    var lab = { p: 0, s: 0 }, ended = false, sum = { P: 0, S: 0 };
    var pnList = (ctx.partNos || []).map(function (x) { return String(x || '').toUpperCase().trim(); }).filter(function (x) { return x.length >= 3; });
    L.forEach(function (l, i) {
      if (SKIP_RE.test(l)) return;
      var nums = amountsIn(l).filter(function (n) { return Math.abs(n) >= 100; });
      if (!nums.length) return;
      var v = nums[nums.length - 1], low = l.toLowerCase();
      if (TOT_RE.test(l)) {
        if (head >= 0 && i > head) ended = true;
        var tax = /\b(ppn|vat|tax|pajak|pph)\b/.test(low);
        if (/after\s*dis[ck]|setelah\s*(diskon|potongan)|net+\s*(total|amount)|total\s*after/.test(low)) { if (!res.net) res.net = v; }
        else if (/sub\s?-?total|total\s+before|before\s+(discount|tax)|\bdpp\b|jumlah\s+harga/.test(low)) { if (!res.sub) res.sub = v; }
        else if (/dis[ck]o(n|unt)|potongan/.test(low)) { if (!res.disc) res.disc = v; }
        else if (!tax && /(spare\s?parts?|sparepart|suku\s?cadang|\bparts?\b|material)/.test(low)) { if (!lab.p) lab.p = v; }
        else if (!tax && /\b(jasa|service|servis|labou?r)\b/.test(low)) { if (!lab.s) lab.s = v; }
        else if (tax) { if (!res.tax) res.tax = v; }
        else if (/grand\s?total|total\s+(amount|document|payment|quotation|penawaran)|amount\s+due|^\s*total\b|\s{2,}total\b/.test(low)) res.total = Math.max(res.total, v);
        return;
      }
      if ((head >= 0 && (i <= head || ended)) || v < 1000) return;
      var up = l.toUpperCase(), isPart = pnList.some(function (pn) { return up.indexOf(pn) >= 0; });
      var side = SVC_CODE_RE.test(l) ? 'S' : !isPart && SVC_RE.test(l) ? 'S' : 'P';
      sum[side] += v; res.items.push({ text: l.trim(), value: v, side: side });
    });
    if (lab.p || lab.s) { if (lab.p) sum.P = lab.p; if (lab.s) sum.S = lab.s; }
    var itemsTot = sum.P + sum.S;
    if (!res.sub) res.sub = itemsTot;
    if (!itemsTot && (res.sub || res.total)) {   // rincian tidak terbaca: semua ke satu sisi
      var k = ctx.hasParts === false ? 'S' : 'P'; sum[k] = res.sub || res.total; itemsTot = sum[k];
      res.notes.push('Rincian baris tidak terbaca — seluruh nilai dimasukkan ke ' + (k === 'P' ? 'Parts' : 'Service') + '. Pindahkan bila perlu.');
    }
    if (!res.net) res.net = res.sub ? r2(res.sub - res.disc) : 0;
    if (!res.total) res.total = r2(res.net + res.tax);
    res.side = sum.P && sum.S ? 'PS' : sum.S ? 'S' : 'P';
    var base = itemsTot || res.sub;
    ['net', 'total'].forEach(function (mode) {
      var tot = mode === 'net' ? res.net : res.total;
      ['P', 'S'].forEach(function (s) { res.values[mode][s] = base ? r2(tot * sum[s] / base) : 0; });
    });
    if (res.side === 'PS' && res.disc) res.notes.push('Satu PDF berisi parts & jasa — diskon / PPN dibagi sebanding nilainya.');
    if (itemsTot && res.sub && Math.abs(itemsTot - res.sub) > 1 && !lab.p && !lab.s) res.notes.push('Jumlah baris (' + fmtRp(itemsTot) + ') berbeda dengan Subtotal PDF (' + fmtRp(res.sub) + ') — mohon dicek.');
    if (!res.qno) res.notes.push('Nomor quotation tidak ditemukan — isi manual.');
    return res;
  }
  window.__asiTest = { parseQuote: parseQuoteText, pdfLines: pdfTextLines, poll: function () { pollCounts(true); } };   // untuk pengujian

  /* ---------- Service Leader: tambah parts & tanda tangan ---------- */
  function slAddParts(D, r, v, setParts) {
    var A = D.add || (D.add = { q: '', hits: null, staged: [], manual: { partNo: '', desc: '', qty: 1 }, bulk: '' }), F = mhc().f;
    var MAX = mhc().partsUploadMax || 300;
    var q = h('input', { class: 'inp', type: 'search', placeholder: 'Cari part number / nama part di Stock On Hand…', value: A.q, enterkeyhint: 'search' });
    var hits = h('div', { class: 'picklist' });
    var draw = function () {
      hits.innerHTML = '';
      if (A.loading) return hits.appendChild(h('div', { class: 'pick-empty' }, 'Mencari…'));
      if (!A.hits) return;
      if (!A.hits.length) return hits.appendChild(h('div', { class: 'pick-empty' }, 'Tidak ada di Stock On Hand — tambahkan manual di bawah.'));
      A.hits.forEach(function (it) {
        hits.appendChild(h('button', { type: 'button', class: 'pick', onclick: function () { A.staged.push({ partNo: it.partNo, desc: it.desc, qty: 1, cat: '', info: (it.stockBranch > 0 ? 'Stock cabang ' + it.stockBranch : 'Kosong di cabang') + (it.otherText ? ' · ' + it.otherText : '') }); A.hits = null; A.q = ''; render(); } },
          h('div', { class: 'pick-main' }, h('b', null, it.partNo), ' · ', it.desc), h('div', { class: 'pick-sub' }, (it.stockBranch > 0 ? 'Stock cabang ' + it.stockBranch : 'Kosong di cabang') + (it.otherText ? ' — ada di ' + it.otherText : ''))));
      });
    };
    q.addEventListener('input', debounce(function () {
      A.q = q.value.trim();
      if (A.q.length < 2) { A.hits = null; draw(); return; }
      A.loading = true; draw();
      api('formSearchParts', { token: S.session.token, q: A.q, branch: v[F.BRANCH] }).then(function (x) { A.loading = false; A.hits = x.items; draw(); }).catch(function (e) { A.loading = false; toast(e.message, 'err'); draw(); });
    }, 350));
    draw();
    var mpn = h('input', { class: 'inp sm', placeholder: 'Part number', value: A.manual.partNo }), mds = h('input', { class: 'inp sm', placeholder: 'Nama / deskripsi part', value: A.manual.desc });
    mpn.addEventListener('input', function () { A.manual.partNo = mpn.value; }); mds.addEventListener('input', function () { A.manual.desc = mds.value; });
    // upload dari Excel / CSV
    var pickFile = function () {
      var inp = h('input', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', style: 'display:none' });
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; inp.remove();
        if (!f) return;
        A.reading = true; render();
        readTableFile(f).then(function (rows) {
          var x = partsFromRows(rows); A.reading = false;
          if (!x.parts.length) { render(); return toast('Tidak ada part terbaca. Pastikan ada kolom "Part Number" (lihat Template Excel).', 'err'); }
          var room = MAX - A.staged.length, take = x.parts.slice(0, Math.max(0, room));
          A.staged = A.staged.concat(take); A.fileName = f.name;
          var noCat = take.filter(function (p) { return !p.cat; }).length;
          render();
          toast(take.length + ' part dibaca dari ' + f.name + (x.parts.length > take.length ? ' · ' + (x.parts.length - take.length) + ' dilewati (maks ' + MAX + ')' : '') +
            (noCat ? ' · ' + noCat + ' belum ada kategori' : ''), noCat || x.parts.length > take.length ? 'warn' : 'ok');
        }).catch(function (e) { A.reading = false; render(); toast(e.message, 'err'); });
      });
      document.body.appendChild(inp); inp.click();
    };
    var missing = A.staged.filter(function (p) { return !p.cat; }).length;
    var staged = A.staged.map(function (p, i) {
      var qty = h('input', { class: 'inp sm num qty', inputmode: 'numeric', value: p.qty });
      qty.addEventListener('input', function () { p.qty = parseNum(qty.value) || ''; });
      return h('div', { class: 'part' }, h('div', { class: 'part-top' }, h('span', { class: 'part-n' }, '+'),
        h('div', { class: 'part-main' }, h('b', null, p.partNo), h('div', { class: 'muted small' }, p.desc),
          p.info ? h('div', { class: 'small muted' }, p.info) : h('div', { class: 'small muted' }, p.fromFile ? 'Dari file — stock dicek ke Stock On Hand saat disimpan' : 'Manual — jika tidak ada di Stock On Hand, dicari di JDS')),
        h('label', { class: 'qty-l' }, 'Qty', qty), h('button', { type: 'button', class: 'icon-btn danger', onclick: function () { A.staged.splice(i, 1); render(); } }, '✕')),
        h('div', { class: 'part-cat', 'data-missing': p.cat ? null : '1' }, catSelect(p.cat || '', function (c) { p.cat = c; var m = A.staged.filter(function (x) { return !x.cat; }).length; if (!m || !c) render(); })));
    });
    var bulk = missing > 1 ? h('div', { class: 'banner warn col' }, h('span', null, missing + ' part belum ada kategori. Pilih kategori untuk semua yang kosong sekaligus:'),
      catSelect('', function (c) { if (!c) return; A.staged.forEach(function (p) { if (!p.cat) p.cat = c; }); render(); })) : null;
    return h('div', { class: 'sl-add' }, h('h3', { class: 'sec-t' }, 'Tambah parts rekomendasi (Service Leader)'),
      h('div', { class: 'upload-row' },
        h('button', { type: 'button', class: 'btn small', disabled: !!A.reading, onclick: pickFile }, A.reading ? 'Membaca file…' : '⬆ Upload Excel'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: downloadPartsTemplate }, '⬇ Template Excel'),
        h('span', { class: 'muted small' }, 'Kolom: Part Number, Deskripsi, Qty, Kategori')),
      h('div', { class: 'picker' }, q, hits),
      h('div', { class: 'jds' }, mpn, mds, h('button', { type: 'button', class: 'btn small', onclick: function () {
        if (!A.manual.partNo.trim()) return toast('Isi part number', 'warn');
        A.staged.push({ partNo: A.manual.partNo.trim(), desc: A.manual.desc.trim(), qty: 1, cat: '' }); A.manual = { partNo: '', desc: '', qty: 1 }; render();
      } }, '+ Manual')),
      A.staged.length ? h('div', { class: 'card-head', style: 'margin-top:10px' }, h('b', null, A.staged.length + ' part akan ditambahkan' + (A.fileName ? ' (dari ' + A.fileName + ')' : '')),
        h('button', { type: 'button', class: 'linkbtn danger', onclick: function () { if (A.staged.length > 3 && !confirm('Kosongkan ' + A.staged.length + ' part ini?')) return; A.staged = []; A.fileName = ''; render(); } }, 'Kosongkan')) : null,
      bulk, staged,
      A.staged.length ? h('button', { type: 'button', class: 'btn primary block', style: 'margin-top:10px', onclick: function (ev) {
        if (!online()) return toast('Butuh koneksi internet', 'warn');
        var noCat = A.staged.filter(function (p) { return !p.cat; }).length;
        if (noCat) { var el = document.querySelector('.sl-add .part-cat[data-missing="1"] select'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return toast(noCat + ' part belum dipilih kategorinya', 'warn'); }
        var btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Menyimpan ' + A.staged.length + ' part…';
        var n = A.staged.length;
        api('formAddParts', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, parts: A.staged.map(function (p) { return { partNo: p.partNo, desc: p.desc, qty: Number(p.qty) || 1, cat: p.cat }; }) }, 120000)
          .then(function (x) { D.add = null; setParts(x); toast(n + ' part ditambahkan · status: ' + x.mhcStatus, 'ok'); })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Simpan ' + n + ' part'; toast(e.message, 'err'); });
      } }, 'Simpan ' + A.staged.length + ' part') : null);
  }
  function slApproveCard(D, r, v) {
    var F = mhc().f, pend = (String(v[F.PARTS_REC] || '').match(/(\d+) belum ditemukan/) || [0, 0])[1];
    var pad = sigCanvas({ get: function () { return D.slSigUrl || null; }, save: function (b) { D.slSig = b; if (D.slSigUrl) URL.revokeObjectURL(D.slSigUrl); D.slSigUrl = URL.createObjectURL(b); }, clear: function () { D.slSig = null; D.slSigUrl = null; } });
    var cid = String(v[F.CALL_ID] || '').trim();
    var setCid = function (x) {
      if (!online()) return toast('Butuh koneksi internet', 'warn');
      api('formSetCallId', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, callId: x }).then(function (res) { v[F.CALL_ID] = res.callId; D.sameCall = res.sameCall || []; D.cidEdit = false; toast('Call ID ' + res.callId + ' disimpan', 'ok'); render(); })
        .catch(function (e) { toast(e.message, 'err'); });
    };
    var cidBox;
    if (cid && !D.cidEdit) cidBox = h('div', { class: 'kv' }, h('span', null, 'Call ID'), h('b', null, cid, ' ', h('button', { type: 'button', class: 'linkbtn', onclick: function () { D.cidEdit = true; render(); } }, 'ganti')));
    else {
      var cpick = picker('Pilih Call ID (Service Call SAP)', S.boot.serviceCalls || [], function (x) { return x.join(' '); },
        function (x) { return [h('div', { class: 'pick-main' }, h('b', null, x[0]), ' · ', x[1] || '-'), h('div', { class: 'pick-sub' }, [x[2] && 'SN ' + x[2], x[3], x[5], x[6]].filter(Boolean).join(' — '))]; },
        function (x) { setCid(x[0]); }, 'Ketik Call ID / customer / SN…');
      var man = h('input', { class: 'inp sm', id: 'sl-cid', placeholder: 'Call ID baru (belum ada di daftar)' });
      cidBox = h('div', { class: 'cid-box' + (cid ? '' : ' missing') },
        cid ? null : h('div', { class: 'banner warn' }, 'Call ID belum ada (mis. MHC dari kunjungan PSSR). Pilih Service Call yang sesuai — wajib sebelum disetujui.'),
        cpick, h('div', { class: 'jds' }, man, h('button', { type: 'button', class: 'btn small', onclick: function () { if (!man.value.trim()) return toast('Isi Call ID', 'warn'); setCid(man.value.trim()); } }, 'Simpan'),
          cid ? h('button', { type: 'button', class: 'linkbtn', onclick: function () { D.cidEdit = false; render(); } }, 'batal') : null),
        h('p', { class: 'hint' }, 'Daftar Service Call diperbarui dari tab Service Call. Service Call yang baru dibuat di SAP bisa diketik manual.'));
    }
    var btn = h('button', { type: 'button', class: 'btn primary block', disabled: !!Number(pend) || !cid, onclick: function () {
      if (!D.slSig) return toast('Tanda tangani dulu di kotak di atas', 'warn');
      if (!online()) return toast('Butuh koneksi internet', 'warn');
      btn.disabled = true; btn.textContent = 'Menyimpan & membuat PDF…';
      blobToB64(D.slSig).then(function (b64) {
        return api('formUploadPhoto', { token: S.session.token, clientId: 'sl-' + r.mhcNo, slot: 'slsig', data: b64, mime: 'image/png', branch: v[F.BRANCH] });
      }).then(function (up) {
        return api('formApproveMhc', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, sigUrl: up.url }, 180000);
      }).then(function (x) { toast('MHC disetujui · status: ' + x.mhcStatus + (x.pdf ? ' · PDF siap' : '') + (x.notified ? ' · Admin diberi tahu lewat email' : ''), 'ok'); loadCounts(); openDetail(r); })
        .catch(function (e) { btn.disabled = false; btn.textContent = 'Setujui & tanda tangani'; toast(e.message, 'err'); });
    } }, 'Setujui & tanda tangani');
    return h('div', { class: 'card review-card' }, h('h2', null, 'Review Service Leader'),
      h('p', { class: 'muted small' }, 'Periksa temuan & parts rekomendasi (tambahkan parts bila perlu, mis. untuk overhaul), lalu tanda tangani. Setelah disetujui, PDF report bisa dicetak dan MHC masuk ke Admin PS untuk dibuatkan quotation.'),
      Number(pend) ? h('div', { class: 'banner warn' }, pend + ' part belum ditemukan — isi JDS Parts Number atau hapus part-nya dulu.') : null,
      cidBox,
      h('label', { class: 'lbl' }, 'Tanda tangan Service Leader'), pad, btn);
  }
  function viewDetail() {
    var D = S.detail, r = D.row, M = mhc(), F = M.f, v = D.values;
    var back = h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { if (D.from === 'quotes') openQuotes(); else if (D.from === 'ccSurvey' && S.ccs) go('ccSurvey'); else go('list'); } }, D.from === 'quotes' ? '‹ Kembali ke monitoring' : D.from === 'ccSurvey' ? '‹ Kembali ke survei' : '‹ Kembali ke daftar');
    if (D.loading || !v) return h('div', null, back, h('div', { class: 'card center muted' }, D.loading ? 'Memuat detail…' : 'Gagal memuat.'));
    var g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
    var bads = [];
    M.groups.forEach(function (gr) { gr.items.forEach(function (it) { if (String(v[it.col]).toUpperCase() === 'BAD') bads.push({ g: gr.title, l: it.label, r: v[it.rem] }); }); });
    var tel = String(g('PHONE') || '').replace(/[^\d+]/g, '');
    var survey = invoiceOnly() ? h('div', { class: 'card' }, h('h2', null, 'Kontak untuk survei'),
      kvRow('Contact Person', g('CONTACT') || '—'), g('PHONE') ? h('div', { class: 'kv' }, h('span', null, 'Phone'), h('a', { href: 'tel:' + tel, class: 'tel' }, String(g('PHONE')))) : kvRow('Phone', '—'),
      kvRow('Tanggal Invoice', [g('P_INVDATE') && 'Parts ' + fmtDate(g('P_INVDATE')), g('S_INVDATE') && 'Service ' + fmtDate(g('S_INVDATE'))].filter(Boolean).join(' · '))) : null;
    var info = h('div', { class: 'card summary' },
      h('h2', null, g('CUSTOMER') || '(tanpa customer)'),
      h('div', { class: 'chips', style: 'margin:-4px 0 8px' }, h('span', { class: 'chip' }, r.mhcNo || 'Data lama'), chip(g('MHC_STATUS')), g('STATUS') ? chip(g('STATUS'), machineTone(g('STATUS'))) : null),
      kvRow('Tanggal', fmtDate(g('DATE'))), kvRow('Unit', [g('BRAND'), g('MODEL'), g('SN') && 'SN ' + g('SN')].filter(Boolean).join(' · ')),
      kvRow('Engine', [g('ENG_MODEL'), g('ENG_NO')].filter(Boolean).join(' / ')), kvRow('Hours Meter', fmtNum(g('HM'))), kvRow('Location', g('LOCATION')),
      kvRow('Contact', [g('CONTACT'), g('PHONE')].filter(Boolean).join(' · ')), kvRow('Call ID', g('CALL_ID') || (r.isOld ? '' : 'Belum ada — dipilih Service Leader')),
      kvRow('Inspector', g('TECH') ? g('TECH') + (g('INSPECTOR_ROLE') === 'PSSR' ? ' (PSSR)' : '') : ''), kvRow('Mekanik pendamping', [g('TECH2'), g('TECH3')].filter(function (x) { return String(x || '').trim(); }).join(', ')),
      kvRow('PSSR', g('PSSR') ? g('PSSR') + (g('PSSR_ATTEND') === 'Ya' ? ' (ikut ke lokasi)' : g('PSSR_ATTEND') === 'Tidak' ? ' (tidak ikut)' : '') : ''),
      kvRow('Status terakhir', [g('STATUS_DATE') && fmtDate(g('STATUS_DATE')), g('STATUS_BY')].filter(Boolean).join(' · ')),
      can('marInput') && !r.isOld && [g('TECH'), g('TECH2'), g('TECH3')].indexOf(S.session.user.name) >= 0 ? h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () {
        openMar({ DATE: String(g('DATE') || '').slice(0, 10), CUSTOMER: g('CUSTOMER'), BRAND: g('BRAND'), MODEL: g('MODEL'), SN: g('SN'), LOCATION: g('LOCATION'), CALL_ID: g('CALL_ID'), MHC_NO: r.mhcNo, DESC: 'Machine Health Check' });
      } }, '◷ Buat MAR dari MHC ini')) : null,
      kvRow('Disetujui SL', g('SL_DATE') ? [g('SL_NAME'), fmtDate(g('SL_DATE'))].filter(Boolean).join(' · ') : ''),
      kvRow('No. Quotation', quoteNos(g)), kvRow('Nilai Quotation', quoteValText(g)),
      r.isOld ? null : D.approved ? h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: function () { downloadPdf(r); } }, '⬇ Download PDF'),
          invoiceOnly() ? null : h('button', { class: 'btn ghost small', onclick: function () { downloadPdf(r, true); } }, 'Buat ulang PDF'),
          can('quoteCreate') ? h('button', { class: 'btn small accent-btn', onclick: function () { pickQuotePdf(D, r, v); } }, quoteNos(g) ? '⬆ Upload / Ganti Quotation (PDF)' : '⬆ Upload Quotation (PDF)') : null,
          /drive/.test(String(g('P_QPDF'))) ? h('button', { class: 'btn small', onclick: function () { downloadPdf(r, false, 'quoteP'); } }, String(g('P_QPDF')) === String(g('S_QPDF')) ? '⬇ Quotation PDF' : '⬇ Quotation Parts') : null,
          /drive/.test(String(g('S_QPDF'))) && String(g('P_QPDF')) !== String(g('S_QPDF')) ? h('button', { class: 'btn small', onclick: function () { downloadPdf(r, false, 'quoteS'); } }, '⬇ Quotation Service') : null,
          /drive/.test(String(g('Q_PDF'))) ? h('button', { class: 'btn small', onclick: function () { downloadPdf(r, false, 'quote'); } }, '⬇ Quotation PDF') : null)
        : can('slReview') ? h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () { downloadPdf(r); } }, 'Lihat draft PDF'), h('span', { class: 'muted small' }, 'PDF final dibuat setelah Anda menandatangani.'))
        : h('p', { class: 'hint' }, 'PDF report bisa dicetak setelah direview & ditandatangani Service Leader.'));
    var lt = D.late || {};
    var lateBanner = lt.needReason ? h('div', { class: 'banner bad col' }, h('b', null, 'Sudah ' + lt.days + ' hari sejak MHC — melewati batas ' + (mhc().submitDays || 3) + ' hari ' + (lt.submitted ? 'submit quotation ke customer.' : 'dan quotation belum dikirim ke customer.')),
      h('span', null, can('quoteCreate|quoteStatus') ? 'Isi "Submit Late Reason" di bagian Quotation (kanan / bawah).' : 'Admin PS / PSSR perlu mengisi alasan keterlambatan.')) : null;
    var findings = !r.isOld ? h('div', { class: 'card' }, h('h2', null, 'Temuan (' + bads.length + ' BAD)'),
      bads.length ? bads.map(function (b) { return h('div', { class: 'qitem' }, h('div', { class: 'qmain' }, h('b', null, b.l), h('div', { class: 'muted small' }, b.g), h('div', { class: 'small err-text' }, b.r))); }) : h('p', { class: 'muted' }, 'Tidak ada temuan.'),
      g('DETAIL') ? kvRow('Detail Problem', g('DETAIL')) : null, g('ACTION') ? kvRow('Action', g('ACTION')) : null) : null;
    var slEdit = can('slReview') && !r.isOld && !D.quoteLocked;
    var setParts = function (x) { D.parts = x.parts; v[F.PARTS_REC] = x.summary; v[F.MHC_STATUS] = x.mhcStatus; loadCounts(); render(); };
    var partRows = (D.parts || []).map(function (p, k) {
      var jdsBox = null;
      if (p.found === 'Tidak') {
        if (can('partsJds') && !D.quoteLocked) {
          var jn = h('input', { class: 'inp sm', placeholder: 'JDS Parts Number', value: p.jdsNo || '' }), jt = h('input', { class: 'inp sm', placeholder: 'Catatan JDS', value: p.jdsNote || '' });
          jdsBox = h('div', { class: 'jds' }, jn, jt, h('button', { class: 'btn small primary', onclick: function () {
            if (!online()) return toast('Butuh koneksi internet', 'warn');
            api('formUpdatePartJds', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, partRow: p.row, jdsNo: jn.value.trim(), jdsNote: jt.value.trim() }).then(function (x) {
              setParts(x); toast('Hasil JDS tersimpan · status: ' + x.mhcStatus, 'ok');
            }).catch(function (e) { toast(e.message, 'err'); });
          } }, 'Simpan JDS'));
        } else jdsBox = h('div', { class: 'small ' + (p.jdsNo ? 'ok-text' : 'err-text') }, p.jdsNo ? 'JDS: ' + p.jdsNo + (p.jdsNote ? ' · ' + p.jdsNote : '') : 'Belum ditemukan — sedang dicari di JDS');
      }
      var del = slEdit ? h('button', { type: 'button', class: 'icon-btn danger', title: 'Hapus part', onclick: function () {
        if (!confirm('Hapus part ' + p.partNo + ' dari rekomendasi?')) return;
        api('formRemovePart', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, partRow: p.row, partNo: p.partNo }).then(function (x) { setParts(x); toast('Part dihapus', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
      } }, '✕') : null;
      return h('div', { class: 'part' + (p.found === 'Tidak' ? ' manual' : '') }, h('div', { class: 'part-top' }, h('span', { class: 'part-n' }, k + 1),
        h('div', { class: 'part-main' }, h('b', null, p.partNo), ' × ' + p.qty, h('div', { class: 'muted small' }, p.desc),
          p.found === 'Ya' ? h('div', { class: 'small' }, Number(p.stockBranch) > 0 ? h('span', { class: 'ok-text' }, 'Stock cabang ' + p.stockBranch) : h('span', { class: 'warn-text' }, 'Kosong di cabang'), p.stockOther ? h('span', { class: 'muted' }, ' · ' + p.stockOther) : null) : null,
          p.by ? h('div', { class: 'small muted' }, 'Oleh: ' + p.by) : null, jdsBox), del),
        can('slReview') && !r.isOld ? h('div', { class: 'part-cat', 'data-missing': p.cat ? null : '1' }, catSelect(p.cat || '', function (c) {
          if (!online()) return toast('Butuh koneksi internet', 'warn');
          api('formSetPartCat', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, partRow: p.row, cat: c }).then(function (x) { p.cat = x.cat; toast('Kategori ' + p.partNo + ' disimpan', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
        })) : h('div', { class: 'part-cat' }, p.cat ? h('span', { class: 'chip cat' }, p.cat) : h('span', { class: 'muted small' }, 'Kategori belum diisi')));
    });
    var parts = (D.parts || []).length || slEdit ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Parts Rekomendasi (' + (D.parts || []).length + ')'),
        (D.parts || []).length && !invoiceOnly() ? h('button', { class: 'btn small', onclick: function () { exportPartsXlsx(r, v, D.parts); } }, '⬇ Excel') : null),
      partRows, slEdit ? slAddParts(D, r, v, setParts) : null) : null;
    var review = can('slReview') && !r.isOld && !D.approved ? slApproveCard(D, r, v) : null;
    var office = viewOffice(D, r, v);
    var same = (D.sameCall || []).length ? h('div', { class: 'card' }, h('h2', null, 'Satu Service Call (' + g('CALL_ID') + ') dengan ' + D.sameCall.length + ' MHC lain'),
      h('p', { class: 'muted small' }, 'MHC ini dikerjakan dalam perjalanan Service Call yang sama. Cek biaya jasa/perjalanan supaya tidak ditagih dua kali.'),
      D.sameCall.map(function (x) {
        return h('button', { type: 'button', class: 'qitem linkrow', onclick: function () { openDetail({ row: x.row, mhcNo: x.mhcNo, isOld: false }); } },
          h('div', { class: 'qmain' }, h('b', null, x.customer || '-'), h('div', { class: 'muted small' }, [x.mhcNo, x.sn && 'SN ' + x.sn, fmtDate(x.date), x.tech].filter(Boolean).join(' · '))), chip(x.mhcStatus));
      })) : null;
    var qcard = can('quoteCreate') && D.approved && !r.isOld ? quoteCard(D, r, v) : null;
    var fuc = r.isOld && !quoteNos(g) ? null : [ckCard(D, r, v), fuCard(D, r, v)], fuTop = fuc && !wide();   // di HP: kartu follow up langsung di bawah ringkasan
    var left = h('div', { class: 'col-left' }, lateBanner, survey, info, ccMhcCard(D), fuTop ? fuc : null, same, findings, parts, review), right = h('div', { class: 'col-right' }, qcard, fuTop ? null : fuc, office);
    return h('div', null, back, h('div', { class: 'detail-grid' }, left, right));
  }
  /* ---------- Quotation SAP: upload PDF (Parts & Service terpisah) → No. & nilai terisi otomatis ---------- */
  function quoteNos(g) { var a = [g('P_QNO'), g('S_QNO')].map(function (x) { return String(x || '').trim(); }).filter(Boolean); return a.filter(function (x, i) { return a.indexOf(x) === i; }).join(' · '); }
  function quoteValText(g) {
    var p = Number(g('P_QVAL')) || 0, s = Number(g('S_QVAL')) || 0;
    if (!p && !s) return '';
    return [p ? 'Parts ' + fmtRp(p) : '', s ? 'Service ' + fmtRp(s) : '', p && s ? 'Total ' + fmtRp(p + s) : ''].filter(Boolean).join(' · ');
  }
  var QMODES = [['net', 'Setelah diskon (sebelum PPN)'], ['total', 'Total termasuk PPN']];
  function quoteSideVal(res, s, mode) { return res.side === 'PS' ? res.values[mode][s] : (mode === 'total' ? res.total : res.net); }
  function quoteApply(Q, s) {
    var x = Q.sides[s], V = Q.vals;
    if (!x || !x.res) return;
    V[s + '_QNO'] = x.res.qno || V[s + '_QNO'] || ''; V[s + '_QDATE'] = x.res.date || V[s + '_QDATE'] || todayISO();
    var n = quoteSideVal(x.res, s, Q.mode); V[s + '_QVAL'] = n ? String(n) : '';
    V.QTYPE = V.P_QNO && V.S_QNO ? 'Parts & Service' : V.S_QNO ? 'Service' : 'Parts';
  }
  function pickQuotePdf(D, r, v, force) {
    var inp = h('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
    if (!force) inp.multiple = true;
    inp.addEventListener('change', function () {
      var list = Array.prototype.slice.call(inp.files || []); inp.remove();
      if (!list.length) return;
      if (list.length > 2) return toast('Pilih maksimal 2 PDF (Parts & Service)', 'err');
      var badF = list.filter(function (f) { return (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) || f.size > 10 * 1024 * 1024; })[0];
      if (badF) return toast(badF.name + ': harus PDF, maks 10 MB', 'err');
      var F = mhc().f, g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
      if (!D.q) {
        var vals = {};
        ['QTYPE', 'P_QNO', 'P_QDATE', 'P_QVAL', 'S_QNO', 'S_QDATE', 'S_QVAL'].forEach(function (k) { vals[k] = g(k) == null ? '' : String(g(k)); });
        D.q = { vals: vals, mode: 'net', sides: { P: null, S: null }, same: false, reading: 0, notes: [], lines: [] };
      }
      var Q = D.q; Q.reading += list.length; Q.err = ''; render();
      var card = document.querySelector('.quote-card'); if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      var pn = []; (D.parts || []).forEach(function (p) { pn.push(p.partNo); if (p.jdsNo) pn.push(p.jdsNo); });
      var chain = Promise.resolve(), msgs = [];
      list.forEach(function (f) {
        chain = chain.then(function () { return f.arrayBuffer().then(pdfTextLines); }).then(function (lines) {
          if (D.q !== Q) return;
          Q.lines = lines;
          if (!lines.join('').trim()) { Q.sides[force || 'P'] = { file: f, name: f.name, res: null }; Q.err = f.name + ' berupa gambar / hasil scan — teksnya tidak bisa dibaca. Isi nomor & nilai manual.'; return; }
          var x = parseQuoteText(lines, { partNos: pn, hasParts: (D.parts || []).length > 0, mhcNo: r.mhcNo });
          var side = force || x.side, item = { file: f, name: f.name, res: x };
          if (force && x.side !== 'PS' && x.side !== force) msgs.push(f.name + ' terbaca sebagai quotation ' + (x.side === 'S' ? 'Service' : 'Parts') + ' — tetap dimasukkan ke ' + (force === 'S' ? 'Service' : 'Parts'));
          if (side === 'PS') { Q.sides.P = Q.sides.S = item; Q.same = true; quoteApply(Q, 'P'); quoteApply(Q, 'S'); }
          else { Q.sides[side] = item; Q.same = false; quoteApply(Q, side); }
          msgs.unshift((side === 'PS' ? 'Parts & Service' : side === 'S' ? 'Service' : 'Parts') + ' ' + (x.qno || '(nomor tidak terbaca)'));
          Q.notes = Q.notes.concat(x.notes.map(function (n) { return f.name + ': ' + n; }));
        }).catch(function (e) { if (D.q === Q) Q.err = f.name + ': ' + e.message; }).then(function () { if (D.q === Q) Q.reading--; });
      });
      chain.then(function () { if (D.q !== Q) return; render(); if (msgs.length) toast('Terbaca: ' + msgs.join(' · ') + ' — cek lalu simpan', Q.err ? 'warn' : 'ok'); });
    });
    document.body.appendChild(inp); inp.click();
  }
  function quoteCard(D, r, v) {
    var M = mhc(), F = M.f, g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; }, Q = D.q;
    if (!Q) {
      var pno = String(g('P_QNO') || '').trim(), sno = String(g('S_QNO') || '').trim(), qt = String(g('QTYPE') || '');
      if ((pno && sno) || (qt === 'Parts' && pno) || (qt === 'Service' && sno)) return null;
      var st = function (lbl, no) { return h('div', { class: 'kv' }, h('span', null, lbl), no ? h('b', { class: 'ok-text' }, '✓ ' + no) : h('span', { class: 'muted' }, 'belum')); };
      return h('div', { class: 'card quote-card prompt' }, h('h2', null, 'Quotation SAP'),
        h('p', { class: 'muted small' }, 'Buat quotation di SAP dari MHC ini (⬇ Excel parts untuk upload ke SAP), lalu upload PDF-nya di sini — quotation Parts dan Service boleh dipilih sekaligus. No. quotation, tanggal dan nilai terisi otomatis.'),
        pno || sno ? [st('Parts', pno), st('Service', sno)] : null,
        h('button', { type: 'button', class: 'btn primary block', onclick: function () { pickQuotePdf(D, r, v); } }, '⬆ Upload Quotation (PDF)'));
    }
    var V = Q.vals;
    var fld = function (label, key, type) {
      var inp;
      if (type === 'number') {
        inp = h('input', { class: 'inp num', inputmode: 'decimal', id: 'q-' + key, value: V[key] === '' ? '' : fmtNum(V[key]), placeholder: '0' });
        inp.addEventListener('input', function () { var n = parseNum(inp.value); V[key] = inp.value.trim() === '' ? '' : isNaN(n) ? inp.value : String(n); });
        inp.addEventListener('blur', function () { var n = parseNum(inp.value); if (!isNaN(n)) inp.value = fmtNum(n); });
      } else {
        inp = h('input', { class: 'inp', id: 'q-' + key, type: type || 'text', value: V[key] || '' });
        inp.addEventListener('input', function () { V[key] = inp.value.trim(); });
      }
      return h('div', { class: 'field half' }, h('label', { class: 'lbl' }, label), inp);
    };
    var sideBlock = function (s) {
      var nm = s === 'P' ? 'Parts' : 'Service', x = Q.sides[s], res = x && x.res;
      var brk = res ? [['Subtotal', res.sub], ['Diskon', res.disc], ['Setelah diskon', res.net], ['PPN', res.tax], ['Total', res.total]]
        .filter(function (p, i) { return p[1] || i === 0; }).map(function (p) { return p[0] + ' ' + fmtNum(p[1]); }).join(' · ') : '';
      return h('div', { class: 'qside' },
        h('div', { class: 'card-head' }, h('h3', { class: 'sec-t' }, nm),
          x ? h('span', { class: 'qfile small' }, '📄 ' + x.name + (Q.same ? ' (Parts & Service)' : ''), h('button', { type: 'button', class: 'linkbtn', onclick: function () { pickQuotePdf(D, r, v, s); } }, 'ganti'))
            : h('button', { type: 'button', class: 'btn small', onclick: function () { pickQuotePdf(D, r, v, s); } }, '⬆ PDF ' + nm)),
        h('div', { class: 'grid2' }, fld('No. Quotation ' + nm, s + '_QNO'), fld('Tanggal', s + '_QDATE', 'date'), fld('Nilai ' + nm + ' (IDR)', s + '_QVAL', 'number')),
        brk ? h('div', { class: 'small muted qbrk' }, 'Dari PDF: ' + brk + (res.side === 'PS' ? ' — dibagi sebanding Parts/Service' : '')) : null);
    };
    var qt2 = h('select', { class: 'inp', id: 'q-QTYPE', onchange: function (e) { V.QTYPE = e.target.value; } },
      (M.qtypeOptions || ['Parts', 'Service', 'Parts & Service']).map(function (o) { return h('option', { value: o, selected: o === V.QTYPE }, o); }));
    var save = function (ev) {
      var btn = ev.currentTarget, errs = [], out = {};
      ['P', 'S'].forEach(function (s) {
        var nm = s === 'P' ? 'Parts' : 'Service', no = String(V[s + '_QNO'] || '').trim(), raw = String(V[s + '_QVAL'] || '').trim(), n = raw === '' ? '' : parseNum(raw);
        if (raw !== '' && isNaN(n)) errs.push('Nilai ' + nm + ' harus angka');
        if (no && raw === '') errs.push('Nilai quotation ' + nm + ' belum diisi');
        if (!no && Number(n) > 0) errs.push('No. quotation ' + nm + ' belum diisi');
        out[s + '_QNO'] = no; out[s + '_QVAL'] = raw === '' ? '' : n; out[s + '_QDATE'] = no ? (V[s + '_QDATE'] || todayISO()) : '';
      });
      if (!out.P_QNO && !out.S_QNO) errs.push('Isi No. Quotation Parts dan/atau Service');
      out.QTYPE = V.QTYPE || (out.P_QNO && out.S_QNO ? 'Parts & Service' : out.S_QNO ? 'Service' : 'Parts');
      if (errs.length) return toast(errs.join(' · '), 'err');
      if (!online()) return toast('Butuh koneksi internet untuk upload PDF', 'warn');
      btn.disabled = true; btn.textContent = 'Mengupload & menyimpan…';
      var enc = function (s) { var x = Q.sides[s]; return x && x.file ? blobToB64(x.file).then(function (b) { return { data: b, name: x.name }; }) : Promise.resolve(null); };
      Promise.all([enc('P'), Q.same ? Promise.resolve(null) : enc('S')]).then(function (f) {
        var files = {}; if (f[0]) files.P = f[0]; if (f[1]) files.S = f[1];
        return api('formSaveQuote', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, values: out, files: files, same: Q.same }, 180000);
      }).then(function (x) { D.q = null; toast('Quotation tersimpan · status: ' + x.mhcStatus, 'ok'); loadCounts(); openDetail(r); })
        .catch(function (e) { btn.disabled = false; btn.textContent = 'Simpan quotation'; toast(e.message, 'err'); });
    };
    var items = [];
    ['P', 'S'].forEach(function (s) { var x = Q.sides[s]; if (x && x.res && (s === 'P' || !Q.same)) items = items.concat(x.res.items); });
    return h('div', { class: 'card quote-card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Quotation SAP'), h('button', { type: 'button', class: 'linkbtn', onclick: function () { D.q = null; render(); } }, 'Batal')),
      Q.reading ? h('div', { class: 'banner info' }, 'Membaca isi PDF…')
        : Q.err ? h('div', { class: 'banner warn' }, Q.err)
        : h('div', { class: 'banner ok col' }, h('b', null, 'Terisi otomatis dari PDF — cek dulu sebelum simpan.'), Q.notes.map(function (n) { return h('span', { class: 'small' }, '• ' + n); })),
      h('p', { class: 'hint' }, 'Nilai yang dicatat: setelah diskon, sebelum PPN (baris "After Diskon" di PDF SAP).'),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Quotation Type'), qt2),
      sideBlock('P'), sideBlock('S'),
      items.length ? h('details', { class: 'qread' }, h('summary', null, items.length + ' baris item yang terbaca'),
        items.map(function (it) { return h('div', { class: 'qline' }, h('span', { class: 'chip ' + (it.side === 'S' ? 'info' : 'ok') }, it.side === 'S' ? 'Service' : 'Parts'), h('span', { class: 'qtext' }, it.text), h('b', null, fmtNum(it.value))); })) : null,
      Q.lines && Q.lines.length ? h('details', { class: 'qread' }, h('summary', null, 'Teks PDF terakhir'), h('pre', { class: 'qraw' }, Q.lines.join('\n'))) : null,
      h('p', { class: 'hint' }, 'Status Parts / Service otomatis menjadi "Quotation Dibuat". PDF disimpan di Google Drive dan bisa diunduh dari detail MHC.'),
      h('button', { type: 'button', class: 'btn primary block', disabled: !!Q.reading, onclick: save }, 'Simpan quotation'));
  }
  /* ================= Monitoring quotation & follow up (PSSR / Admin PS / SL) ================= */
  var Q_OPEN = ['Quotation Dibuat', 'Negosiasi', 'Approved (PO)'];
  var QFILTERS = [['due', 'Perlu follow up'], ['open', 'Semua berjalan'], ['qd', 'Quotation Dibuat'], ['nego', 'Negosiasi'], ['po', 'Approved (PO)'], ['won', 'Invoice'], ['lose', 'Lose']];
  function qSides(r) { return [r.P && Object.assign({ k: 'P', label: 'Parts' }, r.P), r.S && Object.assign({ k: 'S', label: 'Service' }, r.S)].filter(Boolean); }
  function qHas(r, st) { return qSides(r).some(function (s) { return s.status === st; }); }
  function qMatch(r, f) {
    if (f === 'due') return r.fu.due;
    if (f === 'open') return r.open;
    if (f === 'qd') return qHas(r, 'Quotation Dibuat');
    if (f === 'nego') return qHas(r, 'Negosiasi');
    if (f === 'po') return qHas(r, 'Approved (PO)');
    if (f === 'won') return qHas(r, 'Invoice');
    if (f === 'lose') return qSides(r).length > 0 && qSides(r).every(function (s) { return s.status === 'Lose'; });
    return true;
  }
  function qSum(rows, st) { var n = 0, v = 0; rows.forEach(function (r) { var hit = false; qSides(r).forEach(function (s) { if (st.indexOf(s.status) >= 0) { v += s.val; hit = true; } }); if (hit) n++; }); return { n: n, v: v }; }
  function fmtRpShort(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
    if (n >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
    return fmtRp(n);
  }
  function fuText(fu) {
    if (!fu || !fu.active) return '';
    if (fu.due) return fu.next ? 'Jadwal follow up ' + fmtDate(fu.next) + (fu.overdue ? ' · lewat ' + fu.overdue + ' hari' : ' · hari ini') : 'Belum ada follow up ' + fu.since + ' hari';
    return fu.next ? 'Follow up berikutnya ' + fmtDate(fu.next) : 'Aktivitas terakhir ' + fu.since + ' hari lalu';
  }
  function openQuotes(f) {
    var Q = S.quotes || (S.quotes = { filter: 'due', pssr: '', q: '', rows: null });
    if (f) Q.filter = f;
    go('quotes'); loadQuotes();
  }
  function loadQuotes() {
    var Q = S.quotes;
    if (!online()) { toast('Monitoring quotation butuh koneksi internet', 'warn'); return; }
    Q.loading = true; render();
    api('formListQuotes', { token: S.session.token }, 60000).then(function (x) {
      Q.loading = false; Q.rows = x.rows; Q.meta = x;
      if (Q.filter === 'due' && !x.rows.some(function (r) { return r.fu.due; })) Q.filter = 'open';
      setCounts(isPssrOnly() ? { myfudue: x.rows.filter(function (r) { return r.fu.due; }).length } : { fudue: x.rows.filter(function (r) { return r.fu.due; }).length });
      if (S.view === 'quotes') render();
    }).catch(function (e) { Q.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'quotes') render(); });
  }
  function exportQuotesXlsx(rows) {
    var head = ['MHC No', 'Tanggal MHC', 'Cabang', 'Customer', 'Unit', 'PSSR', 'Sisi', 'No. Quotation', 'Tgl Quotation', 'Nilai Quotation (IDR)', 'Status',
      'PO No', 'PO Date', 'Invoice No', 'Invoice Date', 'Invoice Value (IDR)', 'Reason For Lose', 'Umur (hari)', 'Follow up terakhir', 'Catatan follow up', 'Jadwal follow up', 'Jumlah follow up', 'Perlu follow up', 'Cek list', 'Prospek (%)'];
    var out = [head];
    rows.forEach(function (r) {
      qSides(r).forEach(function (s) {
        out.push([r.mhcNo || 'Data lama', r.date, r.branch, r.customer, r.unit, r.pssr, s.label, s.no, s.date, s.val || '', s.status, s.po, s.poDate, s.inv, s.invDate, s.invVal || '', s.reason,
          r.aging, r.fu.last, r.fu.note, r.fu.next, r.fu.count || '', r.fu.due ? 'Ya' : '', r.ck ? r.ck.answered : '', r.ck && r.ck.prospect != null ? r.ck.prospect : '']);
      });
    });
    saveBlob(makeXlsx([{ name: 'Monitoring Quotation', rows: out, widths: [20, 12, 8, 28, 26, 22, 9, 22, 12, 16, 15, 16, 12, 18, 12, 16, 24, 10, 14, 40, 14, 10, 10] }]),
      'Monitoring_Quotation_' + S.session.company + '_' + todayISO() + '.xlsx');
    toast('Excel monitoring diunduh', 'ok');
  }
  function viewQuotes() {
    var Q = S.quotes, M = Q.meta || {};
    var title = isPssrOnly() ? 'Quotation saya' : 'Monitoring Quotation';
    if (Q.loading && !Q.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center muted' }, 'Memuat quotation…'));
    if (!Q.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center' }, h('button', { class: 'btn', onclick: loadQuotes }, 'Tampilkan')));
    var nOld = Q.rows.filter(function (r) { return r.isOld; }).length;
    var base = Q.rows.filter(function (r) { return (Q.old || !r.isOld) && (!Q.pssr || (Q.pssr === '—' ? !r.pssr : r.pssr === Q.pssr)); });
    var ql = Q.q.toLowerCase();
    var rows = base.filter(function (r) { return qMatch(r, Q.filter) && (!ql || [r.mhcNo, r.customer, r.unit, r.pssr, r.P && r.P.no, r.S && r.S.no, r.callId].join(' ').toLowerCase().indexOf(ql) >= 0); });
    rows.sort(function (a, b) { return (b.fu.due - a.fu.due) || (b.fu.overdue - a.fu.overdue) || (b.open - a.open) || (b.aging - a.aging); });
    var open = qSum(base, ['Quotation Dibuat', 'Negosiasi', 'Approved (PO)']), nego = qSum(base, ['Negosiasi']), po = qSum(base, ['Approved (PO)']);
    var won = { n: 0, v: 0 }, lose = qSum(base, ['Lose']);
    base.forEach(function (r) { var hit = false; qSides(r).forEach(function (s) { if (s.status === 'Invoice') { won.v += s.invVal || s.val; hit = true; } }); if (hit) won.n++; });
    var due = base.filter(function (r) { return r.fu.due; }).length;
    var kpi = function (label, big, sub, tone, f) {
      return h('button', { type: 'button', class: 'kpi ' + (tone || '') + (Q.filter === f ? ' on' : ''), onclick: function () { Q.filter = f; render(); } },
        h('span', { class: 'kpi-l' }, label), h('b', { class: 'kpi-v' }, big), h('span', { class: 'kpi-s' }, sub));
    };
    var kpis = h('div', { class: 'kpis' },
      kpi('Perlu follow up', String(due), 'jadwal lewat / ' + (M.followUpDays || 7) + ' hari tanpa kabar', due ? 'bad' : 'ok', 'due'),
      kpi('Berjalan', String(open.n), fmtRpShort(open.v), '', 'open'),
      kpi('Negosiasi', String(nego.n), fmtRpShort(nego.v), '', 'nego'),
      kpi('Approved (PO)', String(po.n), fmtRpShort(po.v) + ' · tunggu invoice', '', 'po'),
      kpi('Invoice', String(won.n), fmtRpShort(won.v) + ' · ' + (M.closedDays || 120) + ' hari', 'ok', 'won'),
      kpi('Lose', String(lose.n), fmtRpShort(lose.v) + ' · ' + (M.closedDays || 120) + ' hari', '', 'lose'));
    var pssrNames = {}; Q.rows.forEach(function (r) { if (Q.old || !r.isOld) pssrNames[r.pssr || '—'] = 1; });
    var pssrSel = !isPssrOnly() ? h('select', { class: 'inp sm', id: 'q-pssr', onchange: function (e) { Q.pssr = e.target.value; render(); } },
      h('option', { value: '' }, 'Semua PSSR'), Object.keys(pssrNames).sort().map(function (n) { return h('option', { value: n, selected: n === Q.pssr }, n === '—' ? '(belum ada PSSR)' : n); })) : null;
    var q = h('input', { class: 'inp sm', type: 'search', id: 'q-search', placeholder: 'Cari customer / MHC / No. quotation…', value: Q.q });
    q.addEventListener('input', debounce(function () { Q.q = q.value.trim(); render(); var el = document.getElementById('q-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    var head = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, title), h('div', { class: 'row-btns' },
        h('button', { class: 'btn small ghost', onclick: loadQuotes, disabled: !!Q.loading }, Q.loading ? 'Memuat…' : '↻ Muat ulang'),
        h('button', { class: 'btn small', onclick: function () { exportQuotesXlsx(rows); } }, '⬇ Excel'))),
      kpis,
      h('div', { class: 'chips filt' }, QFILTERS.map(function (f) {
        var n = base.filter(function (r) { return qMatch(r, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip' + (Q.filter === f[0] ? ' on' : ''), onclick: function () { Q.filter = f[0]; render(); } }, f[1], n ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q, pssrSel),
      nOld ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', id: 'q-old', checked: !!Q.old, onchange: function (e) { Q.old = e.target.checked; render(); } }),
        'Tampilkan data lama (' + nOld + ') — history sebelum aplikasi, tidak dihitung di notifikasi') : null);
    // rekap per PSSR (Admin PS / SL)
    var recap = null;
    if (!isPssrOnly() && !Q.pssr) {
      var by = {};
      Q.rows.forEach(function (r) {
        if (r.isOld && !Q.old) return;
        var k = r.pssr || '—', x = by[k] || (by[k] = { name: k, open: 0, openV: 0, due: 0, po: 0, wonV: 0, lose: 0 });
        if (r.open) x.open++; if (r.fu.due) x.due++;
        qSides(r).forEach(function (s) { if (Q_OPEN.indexOf(s.status) >= 0) x.openV += s.val; if (s.status === 'Approved (PO)') x.po++; if (s.status === 'Invoice') x.wonV += s.invVal || s.val; if (s.status === 'Lose') x.lose++; });
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.openV - a.openV; });
      if (list.length > 1 || (list[0] && list[0].name === '—')) recap = h('details', { class: 'card recap', open: wide() }, h('summary', null, 'Rekap per PSSR'),
        h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['PSSR', 'Berjalan', 'Nilai berjalan', 'Perlu follow up', 'Approved (PO)', 'Invoice (' + (M.closedDays || 120) + ' hari)', 'Lose'].map(function (t) { return h('th', null, t); }))),
          h('tbody', null, list.map(function (x) {
            return h('tr', { onclick: function () { Q.pssr = x.name; render(); } }, h('td', null, h('b', null, x.name === '—' ? '(belum ada PSSR)' : x.name)), h('td', { class: 'num' }, x.open),
              h('td', { class: 'num' }, fmtRp(x.openV)), h('td', { class: 'num' }, x.due ? h('span', { class: 'chip bad' }, x.due) : '0'), h('td', { class: 'num' }, x.po), h('td', { class: 'num' }, fmtRp(x.wonV)), h('td', { class: 'num' }, x.lose));
          })))));
    }
    var sideLine = function (s) {
      return h('div', { class: 'qs' }, h('span', { class: 'qs-k' }, s.label), h('span', { class: 'qs-no' }, s.no), h('b', { class: 'qs-v' }, fmtRp(s.val)), chip(s.status));
    };
    var body;
    if (!rows.length) body = h('div', { class: 'card center muted' }, Q.filter === 'due' ? 'Tidak ada quotation yang perlu di-follow up. 👍' : 'Tidak ada quotation di filter ini.');
    else body = h('div', { class: 'qlist' }, rows.map(function (r) {
      var ft = fuText(r.fu);
      return h('button', { type: 'button', class: 'card item qitem2' + (r.fu.due ? ' due' : ''), onclick: function () { openDetail({ row: r.row, mhcNo: r.mhcNo, isOld: r.isOld }); } },
        h('div', { class: 'item-top' }, h('b', null, r.customer || '(tanpa customer)'), h('span', { class: 'chip ' + (r.aging > 30 && r.open ? 'bad' : r.aging > 14 && r.open ? 'wait' : '') }, r.aging + ' hari')),
        h('div', { class: 'muted small' }, [r.mhcNo || 'Data lama', r.unit, !isPssrOnly() ? (r.pssr ? 'PSSR ' + r.pssr : 'PSSR belum ada') : ''].filter(Boolean).join(' · ')),
        qSides(r).map(sideLine),
        ft ? h('div', { class: 'qfu small ' + (r.fu.due ? 'err-text' : 'muted') }, (r.fu.due ? '⏰ ' : '') + ft) : null,
        r.fu.note ? h('div', { class: 'small muted qnote' }, (r.fu.last ? fmtDate(r.fu.last) + ' · ' : '') + r.fu.note) : null,
        r.late ? h('div', { class: 'small err-text' }, 'Lewat ' + r.lateDays + ' hari sejak MHC — isi Submit Late Reason') : null,
        !r.isOld ? h('div', { class: 'small ' + (r.ck && /^(\d+)\/\1$/.test(r.ck.answered) ? 'muted' : 'warn-text') }, r.ck && r.ck.answered ? 'Cek list ' + r.ck.answered + ' · prospek ' + (r.ck.prospect == null ? '—' : r.ck.prospect + '%') : 'Cek list belum diisi') : null);
    }));
    return h('div', null, head, recap, body);
  }

  /* ---------- Cek List Quotation (pertanyaan PSSR ke customer) ---------- */
  function qckList() { return (mhc() && mhc().qcheck) || []; }
  function ckCard(D, r, v) {
    var M = mhc(), F = M.f, g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
    if (!can('quoteMonitor') || !quoteNos(g) || r.isOld || !D.checklist) return null;
    var ck = D.checklist, Q = qckList(), edit = can('qcheckFill');
    var W = D.ckEdit || (D.ckEdit = { ans: Object.assign({}, ck.ans), notes: Object.assign({}, ck.notes), dirty: false });
    var qual = Q.filter(function (q) { return q.kind === 'qual'; }), close = Q.filter(function (q) { return q.kind === 'close'; });
    var answered = qual.filter(function (q) { return W.ans[q.id] === 'Ya' || W.ans[q.id] === 'Tidak'; }).length;
    var scored = qual.filter(function (q) { return q.good; }), good = scored.filter(function (q) { return W.ans[q.id] === q.good; }).length;
    var prospect = scored.length ? Math.round(good / scored.length * 100) : 0;
    var item = function (q, i) {
      var a = W.ans[q.id] || '', bad = q.good && a && a !== q.good, needNote = q.note && a === q.note;
      var note = null;
      if (needNote) {
        note = h('input', { class: 'inp sm ck-note', id: 'ck-note-' + q.id, placeholder: q.notePh, value: W.notes[q.id] || '', disabled: !edit || q.kind === 'close' });
        note.addEventListener('input', function () { W.notes[q.id] = note.value; W.dirty = true; });
      }
      return h('div', { class: 'ck-q' + (a ? '' : ' empty') + (bad ? ' bad' : '') },
        h('div', { class: 'ck-qt' }, h('span', { class: 'ck-n' }, q.id.toUpperCase()), h('span', null, q.text)),
        edit && q.kind === 'qual' ? segmented(['Ya', 'Tidak'], a, function (x) { W.ans[q.id] = x; W.dirty = true; render(); }, 'ck-yn')
          : h('b', { class: a ? (bad ? 'err-text' : 'ok-text') : 'muted' }, a || (q.kind === 'close' ? 'Saat status akhir' : 'Belum')),
        note);
    };
    var save = function (ev) {
      var miss = qual.filter(function (q) { return q.note && W.ans[q.id] === q.note && !String(W.notes[q.id] || '').trim(); });
      if (miss.length) return toast(miss.map(function (q) { return q.id.toUpperCase() + ': ' + q.notePh; }).join(' · '), 'err');
      if (!online()) return toast('Butuh koneksi internet', 'warn');
      var btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Menyimpan…';
      var ans = {}, notes = {}; qual.forEach(function (q) { ans[q.id] = W.ans[q.id] || ''; if (q.note) notes[q.id] = W.notes[q.id] || ''; });
      api('formSaveChecklist', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, answers: ans, notes: notes }).then(function (x) {
        D.checklist = x.checklist; D.ckEdit = null; if (S.quotes) S.quotes.rows = null; toast('Cek List tersimpan · ' + x.checklist.answered + '/' + x.checklist.total + ' · prospek ' + x.checklist.prospect + '%', 'ok'); render();
      }).catch(function (e) { btn.disabled = false; btn.textContent = 'Simpan Cek List'; toast(e.message, 'err'); });
    };
    var open = D.ckOpen !== undefined ? D.ckOpen : (ck.answered < qual.length || W.dirty);   // tetap terbuka selama sedang diisi
    return h('div', { class: 'card ck-card' + (answered < qual.length ? ' todo' : '') },
      h('button', { type: 'button', class: 'g-head', onclick: function () { D.ckOpen = !open; render(); } },
        h('span', { class: 'g-t' }, 'Cek List Quotation', h('div', { class: 'muted small' }, (edit ? 'Pertanyaan PSSR ke customer' : 'Diisi oleh PSSR · Anda hanya melihat') + ' · wajib lengkap sebelum Approved (PO) / Lose')),
        h('span', { class: 'ck-sum' }, h('b', null, answered + '/' + qual.length), h('span', { class: 'small muted' }, ' · prospek ' + prospect + '%')), h('span', { class: 'g-chev' }, open ? '▾' : '▸')),
      h('div', { class: 'ck-bar' }, h('span', { style: 'width:' + Math.round(answered / qual.length * 100) + '%' })),
      open ? [qual.map(item),
        h('h3', { class: 'sec-t' }, 'Pertanyaan penutup (diisi saat memilih status akhir)'), close.map(item),
        ck.updated ? h('p', { class: 'hint' }, 'Terakhir diubah ' + fmtDate(ck.updated) + ' oleh ' + ck.by) : null,
        edit ? h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Simpan Cek List') : null] : null);
  }
  /* ---------- Detail MHC: kartu follow up ---------- */
  function fuCard(D, r, v) {
    var M = mhc(), F = M.f, g = function (k) { return F[k] >= 0 ? v[F[k]] : ''; };
    if (!can('quoteMonitor') || !quoteNos(g)) return null;
    var fu = D.fu || {}, sides = [['P', 'Parts'], ['S', 'Service']].filter(function (s) { return String(g(s[0] + '_QNO') || '').trim(); });
    var cur = function (s) { return (D.sides || {})[s] || ''; };
    var canAdd = can('quoteStatus') && sides.some(function (s) { return Q_OPEN.indexOf(cur(s[0])) >= 0; });
    var meths = M.fuMethods || ['Telepon', 'WhatsApp', 'Kunjungan', 'Email', 'Meeting'];
    var FF = D.fuForm || (D.fuForm = { date: todayISO(), method: '', note: '', next: '', st: {} });
    // PSSR yang memegang
    var pssrRow;
    if (can('quoteCreate')) {
      var opts = (M.pssr || []).map(function (p) { return p.name; }); if (g('PSSR') && opts.indexOf(g('PSSR')) < 0) opts.unshift(g('PSSR'));
      pssrRow = h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'PSSR yang follow up'),
        h('select', { class: 'inp', id: 'fu-pssr', onchange: function (e) {
          var name = e.target.value;
          api('formSetPssr', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, pssr: name }).then(function () { v[F.PSSR] = name; toast(name ? 'PSSR diganti: ' + name : 'PSSR dikosongkan', 'ok'); render(); })
            .catch(function (er) { toast(er.message, 'err'); render(); });
        } }, h('option', { value: '' }, '— Belum ada —'), opts.map(function (n) { return h('option', { value: n, selected: n === g('PSSR') }, n); })));
    } else pssrRow = kvRow('PSSR', g('PSSR') || 'Belum ada');
    var form = null;
    if (canAdd) {
      var dt = h('input', { class: 'inp', type: 'date', id: 'fu-date', value: FF.date, max: todayISO() }); dt.addEventListener('change', function () { FF.date = dt.value; });
      var note = h('textarea', { class: 'inp', id: 'fu-note', rows: 3, placeholder: 'Hasil pembicaraan dengan customer: tanggapan, keberatan, rencana PO…' }); note.value = FF.note;
      note.addEventListener('input', function () { FF.note = note.value; });
      var nx = h('input', { class: 'inp', type: 'date', id: 'fu-next', value: FF.next, min: isoAdd(FF.date || todayISO(), 1) }); nx.addEventListener('change', function () { FF.next = nx.value; });
      var quick = [3, 7, 14].map(function (d) { return h('button', { type: 'button', class: 'btn small ghost', onclick: function () { FF.next = isoAdd(todayISO(), d); render(); } }, '+' + d + ' hari'); });
      var stBlocks = sides.filter(function (s) { return Q_OPEN.indexOf(cur(s[0])) >= 0; }).map(function (s) {
        var k = s[0], x = FF.st[k] || (FF.st[k] = { status: '', po: '', poDate: '', reason: '' });
        var opts2 = ['Negosiasi', 'Approved (PO)', 'Lose'].filter(function (o) { return o !== cur(k); });
        var sel = h('select', { class: 'inp', id: 'fu-st-' + k, onchange: function (e) { x.status = e.target.value; render(); } },
          h('option', { value: '' }, 'Tetap ' + cur(k)), opts2.map(function (o) { return h('option', { value: o, selected: o === x.status }, o); }));
        var extra = [];
        if (x.status === 'Approved (PO)') {
          var po = h('input', { class: 'inp', id: 'fu-po-' + k, value: x.po, placeholder: 'No. PO customer' }); po.addEventListener('input', function () { x.po = po.value; });
          var pd = h('input', { class: 'inp', type: 'date', id: 'fu-pod-' + k, value: x.poDate || todayISO() }); x.poDate = x.poDate || todayISO(); pd.addEventListener('change', function () { x.poDate = pd.value; });
          extra.push(h('div', { class: 'grid2' }, h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'PO No'), po), h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'PO Date'), pd)));
        } else if (x.status === 'Lose') {
          var CL = FF.close || (FF.close = { q14: '', q14note: '', q15: '', q15note: '' });
          qckList().filter(function (q) { return q.id === 'q14' || q.id === 'q15'; }).forEach(function (q) {
            var nt = null;
            if (CL[q.id] === 'Ya') { nt = h('input', { class: 'inp sm', id: 'fu-' + q.id + 'note', placeholder: q.notePh, value: CL[q.id + 'note'] }); nt.addEventListener('input', function () { CL[q.id + 'note'] = nt.value; }); }
            extra.push(h('div', { class: 'ck-q' + (CL[q.id] ? '' : ' empty') }, h('div', { class: 'ck-qt' }, h('span', { class: 'ck-n' }, q.id.toUpperCase()), h('span', null, q.text)),
              segmented(['Ya', 'Tidak'], CL[q.id], function (a) { CL[q.id] = a; render(); }, 'ck-yn fu-' + q.id), nt));
          });
          extra.push(h('p', { class: 'hint' }, 'Jawaban "mengapa" (Q15) / kompetitor (Q14) otomatis menjadi Reason For Lose.'));
        }
        return h('div', { class: 'fu-st' }, h('label', { class: 'lbl' }, 'Status ' + s[1] + ' · ' + g(k + '_QNO')), sel, extra);
      });
      var save = function (ev) {
        var btn = ev.currentTarget, vals = {}, errs = [];
        if (!FF.method) errs.push('Pilih cara follow up');
        if (!String(FF.note || '').trim()) errs.push('Isi hasil follow up');
        Object.keys(FF.st).forEach(function (k) {
          var x = FF.st[k]; if (!x.status) return;
          vals[k + '_STATUS'] = x.status;
          if (x.status === 'Approved (PO)') { if (!String(x.po || '').trim()) errs.push('PO No ' + (k === 'P' ? 'Parts' : 'Service') + ' belum diisi'); vals[k + '_PO'] = x.po.trim(); vals[k + '_PODATE'] = x.poDate || todayISO(); }
          if (x.status === 'Lose') { var CL = FF.close || {};
            if (!CL.q14 || !CL.q15) errs.push('Jawab Q14 dan Q15 untuk status Lose');
            else if ((CL.q14 === 'Ya' && !String(CL.q14note || '').trim()) || (CL.q15 === 'Ya' && !String(CL.q15note || '').trim())) errs.push('Isi keterangan Q14 / Q15 yang dijawab Ya');
            else if (CL.q14 !== 'Ya' && CL.q15 !== 'Ya') errs.push('Status Lose: minimal Q14 atau Q15 dijawab Ya (alasan Lose)'); }
        });
        if (FF.next && FF.next <= (FF.date || todayISO())) errs.push('Jadwal berikutnya harus setelah tanggal follow up');
        var finalPick = Object.keys(FF.st).some(function (k) { return FF.st[k].status === 'Approved (PO)' || FF.st[k].status === 'Lose'; });
        if (finalPick && D.checklist && D.checklist.answered < D.checklist.total) errs.push(can('qcheckFill') ? 'Lengkapi Cek List Quotation dulu (' + D.checklist.answered + '/' + D.checklist.total + ')' : 'Cek List Quotation belum lengkap (' + D.checklist.answered + '/' + D.checklist.total + ') — minta PSSR mengisinya dulu');
        if (errs.length) return toast(errs.join(' · '), 'err');
        if (!online()) return toast('Butuh koneksi internet', 'warn');
        btn.disabled = true; btn.textContent = 'Menyimpan…';
        var hasLose = Object.keys(FF.st).some(function (k) { return FF.st[k].status === 'Lose'; });
        api('formAddFollowUp', { token: S.session.token, row: r.row, mhcNo: r.mhcNo, fu: { date: FF.date, method: FF.method, note: FF.note.trim(), next: FF.next }, values: vals, close: hasLose ? FF.close : null })
          .then(function (x) { toast('Follow up tersimpan' + (Object.keys(vals).length ? ' · status: ' + x.mhcStatus : ''), 'ok'); D.fuForm = null; if (S.quotes) S.quotes.rows = null; loadCounts(); openDetail(r); })
          .catch(function (e) { btn.disabled = false; btn.textContent = 'Simpan follow up'; toast(e.message, 'err'); });
      };
      form = h('div', { class: 'fu-form' }, h('h3', { class: 'sec-t' }, 'Catat follow up'),
        h('div', { class: 'grid2' }, h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Tanggal'), dt)),
        h('label', { class: 'lbl' }, 'Cara'), segmented(meths, FF.method, function (m) { FF.method = m; }, 'fu-method'),
        h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Hasil follow up'), note),
        stBlocks,
        h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Jadwal follow up berikutnya (kosongkan bila tidak perlu)'), h('div', { class: 'next-row' }, nx, quick)),
        h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Simpan follow up'));
    }
    var hist = (D.followUps || []).map(function (x) {
      return h('div', { class: 'fu-item' }, h('div', { class: 'fu-top' }, h('b', null, fmtDate(x.date)), h('span', { class: 'chip' }, x.method), h('span', { class: 'muted small' }, x.by)),
        h('div', null, x.result),
        h('div', { class: 'small muted' }, [x.pStatus && 'Parts: ' + x.pStatus, x.sStatus && 'Service: ' + x.sStatus, x.next && 'Jadwal berikutnya ' + fmtDate(x.next)].filter(Boolean).join(' · ')));
    });
    var ft = fuText(fu);
    return h('div', { class: 'card fu-card' + (fu.due ? ' due' : '') },
      h('div', { class: 'card-head' }, h('h2', null, 'Follow Up Quotation'), fu.due ? h('span', { class: 'chip bad' }, 'Perlu follow up') : fu.next ? h('span', { class: 'chip info' }, 'Jadwal ' + fmtDate(fu.next)) : null),
      ft ? h('p', { class: 'small ' + (fu.due ? 'err-text' : 'muted') }, ft) : null,
      pssrRow, form,
      h('h3', { class: 'sec-t' }, 'Riwayat (' + hist.length + ')'),
      hist.length ? hist : h('p', { class: 'muted small' }, 'Belum ada follow up.'));
  }
  function viewOffice(D, r, v) {
    var M = mhc(), F = M.f, fields = [], formula = {}, editAny = false;
    if (!D.approved && !r.isOld) return h('div', null, h('h3', { class: 'sec-t' }, 'Quotation & Invoice'),
      h('div', { class: 'card muted' }, 'Menunggu review & tanda tangan Service Leader. Quotation bisa dibuat setelah MHC disetujui.'));
    (D.formulaCols || []).forEach(function (c) { formula[c] = true; });
    var sections = M.office.map(function (sec) {
      var kids = sec.fields.map(function (fd) {
        if (formula[fd.col]) return null;
        var val = v[fd.col] == null ? '' : v[fd.col], editable = can(fd.perm), inp;
        if (!editable) return val === '' ? null : kvRow(fd.h.replace(/^(Parts|Service) /, ''), fd.type === 'number' ? fmtRp(val) : fd.type === 'date' ? fmtDate(val) : val);
        editAny = true;
        if (fd.type === 'select') inp = h('select', { class: 'inp' }, h('option', { value: '' }, '—'), fd.options.filter(function (o) { return o !== 'Invoice' || val === 'Invoice'; }).map(function (o) { return h('option', { value: o, selected: o === val }, o); }));
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

  /* ================= MAR (Mechanic Activity Report) ================= */
  function isoAdd(iso, n) { var p = String(iso).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); }
  function marCfg() { return (S.boot && S.boot.mar) || { jobTypes: {}, categories: ['Travel', 'Working', 'Training', 'Reporting', 'Standby'], status: [], workStart: '08:30', workEnd: '17:30', workDays: [1, 2, 3, 4, 5], holidays: {}, noCustomerCats: ['Training', 'Reporting', 'Standby'], days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'], review: { OK: 'OK', REVISE: 'Perlu Revisi', WAIT: 'Menunggu Review' } }; }
  function hm2min(t) { var m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : NaN; }
  function marDur(a, b) { var s = hm2min(a), e = hm2min(b); if (isNaN(s) || isNaN(e) || s === e) return NaN; if (e <= s) e += 1440; return Math.round((e - s) / 60 * 100) / 100; }
  function fmtH(h) { if (!h && h !== 0) return '—'; var m = Math.round(h * 60); return Math.floor(m / 60) + ' j' + (m % 60 ? ' ' + (m % 60) + ' m' : ''); }
  function dowOf(iso) { var p = String(iso).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
  var MAR_CAT_TONE = { Travel: 'info', Working: 'ok', Training: 'wait', Reporting: '', Standby: 'bad' };
  function newMarForm(prefill) {
    var f = { DATE: todayISO(), CAT: 'Working', START: '', STOP: '', JOB_TYPE: '', SUB_TYPE: '', STATUS: 'In Progress', CUSTOMER: '', BRAND: '', MODEL: '', SN: '', LOCATION: '', CALL_ID: '', MHC_NO: '', DESC: '', REMARKS: '' };
    return Object.assign(f, prefill || {});
  }
  function openMar(prefill) {
    var M = S.mar || (S.mar = { date: todayISO(), rows: null, form: newMarForm() });
    if (prefill) { M.form = newMarForm(prefill); M.date = M.form.DATE || todayISO(); toast('Data dari MHC terisi — isi jam & jenis waktunya', 'ok'); }
    go('mar'); loadMarDay();
  }
  function loadMarDay() {
    var M = S.mar; M.rows = null;
    if (!online()) { render(); return; }
    M.loading = true; if (S.view === 'mar') render();
    api('formListMar', { token: S.session.token, scope: 'mine', from: M.date, to: M.date }).then(function (r) { M.loading = false; M.rows = r.rows; M.sum = r.summary[0] || null; if (S.view === 'mar') render(); })
      .catch(function (e) { M.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'mar') render(); });
  }
  function marQueued(date) {
    return myQueue().filter(function (x) { return x.kind === 'mar' && x.payload.values.DATE === date; }).map(function (x) {
      var v = x.payload.values;
      if (v.ABSENCE) return { queued: true, item: x, absence: v.ABSENCE, start: '', stop: '', cat: '', hours: 0, desc: v.REMARKS, review: x.status === 'error' ? 'Gagal: ' + x.error : 'Belum terkirim' };
      return { queued: true, item: x, start: v.START, stop: v.STOP, cat: v.CAT, hours: marDur(v.START, v.STOP), customer: v.CUSTOMER, desc: v.DESC, jobType: v.JOB_TYPE, subType: v.SUB_TYPE, status: v.STATUS, callId: v.CALL_ID, review: x.status === 'error' ? 'Gagal: ' + x.error : 'Belum terkirim' };
    });
  }
  /** jam kerja normal tanggal itu: { start, end } menit, atau { off: 'alasan' } */
  function marDayInfo(date) {
    var cfg = marCfg(), dow = dowOf(date), hol = (cfg.holidays || {})[date];
    if (hol) return { off: 'Libur: ' + hol };
    if ((cfg.workDays || [1, 2, 3, 4, 5]).indexOf(dow) < 0) return { off: 'Libur (' + cfg.days[dow] + ')' };
    return { start: hm2min(cfg.workStart || '08:30'), end: hm2min(cfg.workEnd || '17:30') };
  }
  function marOt(date, start, hours) {
    var a = hm2min(start); if (isNaN(a) || isNaN(hours)) return 0;
    var b = a + hours * 60, inside = 0;
    [0, 1].forEach(function (k) {
      var w = marDayInfo(k ? isoAdd(date, 1) : date); if (w.off) return;
      inside += Math.max(0, Math.min(b, w.end + k * 1440) - Math.max(a, w.start + k * 1440));
    });
    return Math.round((b - a - inside) / 60 * 100) / 100;
  }
  function marDayTotals(list, date) {
    var t = 0, ot = 0, cats = {};
    list.forEach(function (x) { if (!isNaN(x.hours) && !x.absence) { t += x.hours; cats[x.cat] = (cats[x.cat] || 0) + x.hours; ot += x.queued ? marOt(date, x.start, x.hours) : (x.ot || 0); } });
    return { total: Math.round(t * 100) / 100, info: marDayInfo(date), ot: Math.round(ot * 100) / 100, cats: cats };
  }
  function viewMar() {
    var M = S.mar, C = S.counts || {};
    var modes = h('div', { class: 'mar-modes' }, segmented(['Harian', 'Riwayat'], M.mode === 'hist' ? 'Riwayat' : 'Harian', function (x) {
      M.mode = x === 'Riwayat' ? 'hist' : 'day'; if (M.mode === 'hist') loadMarHist(); else loadMarDay(); }, 'mar-mode'),
      C.marMissing ? h('div', { class: 'banner bad', style: 'margin-top:8px' }, h('span', null, '⏰ ' + C.marMissing + ' hari kerja belum diisi MAR'),
        h('button', { class: 'btn small', onclick: function () { M.mode = 'hist'; loadMarHist(); } }, 'Lihat')) : null);
    if (M.mode === 'hist') return h('div', null, modes, viewMarHist());
    return h('div', null, modes, viewMarDay());
  }
  function viewMarDay() {
    var M = S.mar, cfg = marCfg(), f = M.form, date = M.date;
    var list = (M.rows || []).concat(marQueued(date)).sort(function (a, b) { return (a.absence ? -1 : hm2min(a.start)) - (b.absence ? -1 : hm2min(b.start)); });
    var T = marDayTotals(list, date), dow = dowOf(date);
    var nav = h('div', { class: 'card mar-nav' },
      h('button', { type: 'button', class: 'icon-btn', onclick: function () { M.date = isoAdd(date, -1); loadMarDay(); } }, '‹'),
      h('div', { class: 'mar-date' }, h('b', null, cfg.days[dow] + ', ' + fmtDate(date)), h('input', { class: 'inp sm', type: 'date', value: date, max: todayISO(), onchange: function (e) { if (e.target.value) { M.date = e.target.value; loadMarDay(); } } })),
      h('button', { type: 'button', class: 'icon-btn', disabled: date >= todayISO(), onclick: function () { M.date = isoAdd(date, 1); loadMarDay(); } }, '›'));
    var sumCard = h('div', { class: 'card' },
      h('div', { class: 'mar-tot' },
        h('div', null, h('div', { class: 'muted small' }, 'Total jam'), h('div', { class: 'big' }, fmtH(T.total))),
        h('div', null, h('div', { class: 'muted small' }, 'Jam normal'), h('div', { class: 'big' + (T.info.off ? ' small-big' : '') }, T.info.off ? T.info.off : (marCfg().workStart || '08:30').replace(':', '.') + '–' + (marCfg().workEnd || '17:30').replace(':', '.'))),
        h('div', null, h('div', { class: 'muted small' }, 'Overtime'), h('div', { class: 'big' + (T.ot ? ' bad-t' : '') }, fmtH(T.ot)))),
      h('div', { class: 'chips' }, cfg.categories.map(function (c) { return T.cats[c] ? chip(c + ' ' + fmtH(T.cats[c]), MAR_CAT_TONE[c]) : null; })),
      M.sum && M.sum.review === cfg.review.REVISE ? h('div', { class: 'banner bad col', style: 'margin-top:10px' }, h('b', null, 'Perlu revisi dari Service Leader'),
        h('span', null, (M.rows || []).map(function (r) { return r.reviewNote; }).filter(Boolean)[0] || ''), h('span', { class: 'small' }, 'Hapus kegiatan yang salah lalu input ulang.')) : null,
      M.sum && M.sum.wait === 0 && M.sum.n ? h('div', { class: 'banner ok', style: 'margin-top:10px' }, '✓ Sudah di-review OK oleh Service Leader') : null);
    var acts = h('div', { class: 'card' }, h('h2', null, 'Kegiatan (' + list.length + ')'),
      M.loading ? h('p', { class: 'muted' }, 'Memuat…') : !online() && !M.rows ? h('p', { class: 'muted small' }, 'Offline — kegiatan yang sudah terkirim tidak bisa ditampilkan. Kegiatan baru tetap bisa dicatat.') : null,
      !list.length && !M.loading ? h('p', { class: 'muted' }, 'Belum ada kegiatan di tanggal ini.') : null,
      list.map(function (x) {
        var canDel = x.queued || x.review !== cfg.review.OK;
        if (x.absence) return h('div', { class: 'qitem mar-act' }, h('div', { class: 'mar-time' }, h('b', null, '—')),
          h('div', { class: 'qmain' }, h('div', null, chip(x.absence, 'info'), ' ', h('b', null, 'Tidak masuk')), x.desc ? h('div', { class: 'small muted' }, x.desc) : null,
            x.queued ? h('div', { class: 'small warn-text' }, x.review) : x.review && x.review !== cfg.review.OK ? h('div', { class: 'small muted' }, x.review) : null),
          canDel ? h('button', { type: 'button', class: 'icon-btn danger', title: 'Hapus', onclick: function () {
            if (!confirm('Hapus catatan ' + x.absence + '?')) return;
            if (x.queued) return removeItem(x.item).then(render);
            api('formDeleteMar', { token: S.session.token, row: x.row, marNo: x.marNo }).then(function () { toast('Catatan dihapus', 'ok'); loadCounts(); loadMarDay(); }).catch(function (e) { toast(e.message, 'err'); });
          } }, '✕') : null);
        return h('div', { class: 'qitem mar-act' },
          h('div', { class: 'mar-time' }, h('b', null, x.start), h('span', { class: 'muted small' }, x.stop)),
          h('div', { class: 'qmain' }, h('div', null, chip(x.cat, MAR_CAT_TONE[x.cat]), ' ', h('b', null, fmtH(x.hours))),
            h('div', { class: 'small' }, [x.jobType && x.jobType + (x.subType && x.subType !== x.jobType ? ' · ' + x.subType : ''), x.status].filter(Boolean).join(' · ')),
            h('div', { class: 'small muted' }, [x.customer, x.callId && 'Call ID ' + x.callId, x.desc].filter(Boolean).join(' · ')),
            x.queued ? h('div', { class: 'small warn-text' }, x.review) : x.review && x.review !== cfg.review.OK ? h('div', { class: 'small muted' }, x.review) : null),
          canDel ? h('button', { type: 'button', class: 'icon-btn danger', title: 'Hapus', onclick: function () {
            if (!confirm('Hapus kegiatan ' + x.start + '–' + x.stop + '?')) return;
            if (x.queued) return removeItem(x.item).then(render);
            if (!online()) return toast('Butuh koneksi internet', 'warn');
            api('formDeleteMar', { token: S.session.token, row: x.row, marNo: x.marNo }).then(function () { toast('Kegiatan dihapus', 'ok'); loadMarDay(); }).catch(function (e) { toast(e.message, 'err'); });
          } }, '✕') : null);
      }));
    var fullAbs = list.filter(function (x) { return x.absence && !marIsHalf(x.absence); })[0];
    var kind = h('div', { class: 'card mar-kind' }, segmented(['＋ Kegiatan', 'Tidak masuk'], M.kind === 'abs' ? 'Tidak masuk' : '＋ Kegiatan', function (x) { M.kind = x === 'Tidak masuk' ? 'abs' : 'act'; if (M.kind === 'abs') M.abs = { DATE: M.date, ABSENCE: '', REMARKS: '' }; render(); }, 'mar-kindsel'));
    var form = fullAbs ? h('div', { class: 'banner info' }, 'Tanggal ini tercatat ' + fullAbs.absence + '. Hapus catatan itu bila ternyata Anda bekerja.') : M.kind === 'abs' ? marAbsForm(list) : marForm(list);
    return h('div', null, nav, sumCard, fullAbs ? null : kind, form, acts);
  }
  function marForm(list) {
    var M = S.mar, cfg = marCfg(), f = M.form;
    if (!f.START && list.length) { var last = list.slice().sort(function (a, b) { return hm2min(b.stop) - hm2min(a.stop); })[0]; if (last && last.stop) f.START = last.stop; }
    var fld = function (label, key, o) {
      o = o || {};
      var inp = o.textarea ? h('textarea', { class: 'inp', rows: 2 }) : h('input', { class: 'inp', type: o.type || 'text', value: f[key] || '', placeholder: o.ph || '' });
      if (o.textarea) inp.value = f[key] || '';
      inp.id = 'mar-' + key;
      inp.addEventListener('input', function () { f[key] = inp.value; if (o.live) o.live(); });
      return h('div', { class: 'field' + (o.half ? ' half' : '') }, h('label', { class: 'lbl', for: inp.id }, label, o.req ? h('span', { class: 'req' }, ' *') : null), inp);
    };
    var durEl = h('div', { class: 'mar-dur' });
    var showDur = function () { var d = marDur(f.START, f.STOP); durEl.textContent = isNaN(d) ? '' : 'Durasi ' + fmtH(d) + (hm2min(f.STOP) <= hm2min(f.START) ? ' (lewat tengah malam)' : ''); };
    showDur();
    var subs = (cfg.jobTypes[f.JOB_TYPE] || []);
    var jt = h('select', { class: 'inp', id: 'mar-JOB_TYPE', onchange: function (e) {
      f.JOB_TYPE = e.target.value; var st = cfg.jobTypes[f.JOB_TYPE] || []; f.SUB_TYPE = st.length === 1 ? st[0] : '';
      if (f.JOB_TYPE === 'Training') f.CAT = 'Training';
      render();
    } }, h('option', { value: '' }, '— Pilih —'), Object.keys(cfg.jobTypes).map(function (k) { return h('option', { value: k, selected: k === f.JOB_TYPE }, k); }));
    var st = h('select', { class: 'inp', id: 'mar-SUB_TYPE', disabled: !subs.length, onchange: function (e) { f.SUB_TYPE = e.target.value; } },
      h('option', { value: '' }, subs.length ? '— Pilih —' : 'Pilih Job Type dulu'), subs.map(function (k) { return h('option', { value: k, selected: k === f.SUB_TYPE }, k); }));
    var stat = h('select', { class: 'inp', id: 'mar-STATUS', onchange: function (e) { f.STATUS = e.target.value; } }, cfg.status.map(function (k) { return h('option', { value: k, selected: k === f.STATUS }, k); }));
    var needCust = cfg.noCustomerCats.indexOf(f.CAT) < 0 && f.JOB_TYPE !== 'Training';
    var setUnit = function (o) { Object.keys(o).forEach(function (k) { f[k] = o[k] || ''; }); render(); };
    var scPick = picker('Pilih Call ID (Service Call SAP)', S.boot.serviceCalls || [], function (r) { return r.join(' '); },
      function (r) { return [h('div', { class: 'pick-main' }, h('b', null, r[0]), ' · ', r[1] || '-'), h('div', { class: 'pick-sub' }, [r[2] && 'SN ' + r[2], r[3], r[5]].filter(Boolean).join(' — '))]; },
      function (r) { var p = popBySn(r[2]) || []; setUnit({ CALL_ID: r[0], CUSTOMER: r[1] || p[3], SN: r[2], LOCATION: r[4] || p[4], BRAND: p[1], MODEL: p[2] || r[3] }); }, 'Ketik Call ID / customer / SN…');
    var popPick = picker('Atau cari unit dari Machine Population', S.boot.population || [], function (r) { return r.slice(0, 5).join(' '); },
      function (r) { return [h('div', { class: 'pick-main' }, h('b', null, r[0] || '(tanpa SN)'), ' · ', [r[1], r[2]].filter(Boolean).join(' ')), h('div', { class: 'pick-sub' }, [r[3], r[4]].filter(Boolean).join(' — '))]; },
      function (r) { setUnit({ SN: r[0], BRAND: r[1], MODEL: r[2], CUSTOMER: r[3], LOCATION: r[4] }); }, 'Ketik SN / customer / model…');
    var save = function () {
      var errs = [];
      if (!f.DATE) errs.push('Tanggal'); if (isNaN(marDur(f.START, f.STOP))) errs.push('Start/Stop Time');
      if (!f.JOB_TYPE) errs.push('Job Type'); if (!f.SUB_TYPE) errs.push('Job Sub Type'); if (!f.STATUS) errs.push('Status');
      if (!String(f.DESC || '').trim()) errs.push('Jobs Description'); if (needCust && !String(f.CUSTOMER || '').trim()) errs.push('Customer');
      if (errs.length) return toast('Lengkapi: ' + errs.join(', '), 'err');
      var d = marDur(f.START, f.STOP); if (d > 16) return toast('Satu kegiatan maksimal 16 jam — pecah jadi beberapa kegiatan', 'err');
      var s0 = hm2min(f.START), e0 = s0 + d * 60, all = (M.date === f.DATE ? (M.rows || []) : []).concat(marQueued(f.DATE));
      var clash = all.filter(function (x) { var a = hm2min(x.start), b = a + (x.hours || 0) * 60; return a < e0 && s0 < b; })[0];
      if (clash) return toast('Bertabrakan dengan ' + clash.start + '–' + clash.stop + ' (' + clash.cat + ')', 'err');
      var v = Object.assign({}, f), id = uid();
      saveItem({ id: id, kind: 'mar', company: S.session.company, username: S.session.user.username, createdAt: Date.now(), status: 'pending',
        payload: { values: v, branch: S.session.user.branch }, summary: { title: 'MAR ' + fmtDate(v.DATE) + ' · ' + v.START + '–' + v.STOP, sub: [v.CAT, v.SUB_TYPE, v.CUSTOMER || v.DESC].filter(Boolean).join(' · ') } })
        .then(function () {
          // kegiatan berikutnya biasanya lanjutan pekerjaan yang sama
          M.form = Object.assign(newMarForm(), { DATE: v.DATE, START: v.STOP, JOB_TYPE: v.JOB_TYPE, SUB_TYPE: v.SUB_TYPE, STATUS: v.STATUS, CUSTOMER: v.CUSTOMER, BRAND: v.BRAND, MODEL: v.MODEL, SN: v.SN, LOCATION: v.LOCATION, CALL_ID: v.CALL_ID, MHC_NO: v.MHC_NO, DESC: v.DESC });
          M.date = v.DATE; render(); toast(online() ? 'Kegiatan disimpan — mengirim…' : 'Tersimpan di HP — terkirim saat online', 'ok');
          syncQueue().then(function () { if (S.view === 'mar') loadMarDay(); });
        });
    };
    return h('div', { class: 'card mar-form' }, h('h2', null, '＋ Tambah kegiatan'),
      h('label', { class: 'lbl' }, 'Jenis waktu', h('span', { class: 'req' }, ' *')),
      segmented(cfg.categories, f.CAT, function (c) { f.CAT = c; render(); }, 'mar-cat'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Tanggal'), h('input', { class: 'inp', type: 'date', value: f.DATE, max: todayISO(), onchange: function (e) { f.DATE = e.target.value; } })),
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Hari'), h('div', { class: 'ro' }, f.DATE ? cfg.days[dowOf(f.DATE)] : '—')),
        fld('Start Time', 'START', { type: 'time', half: true, req: true, live: showDur }), fld('Stop Time', 'STOP', { type: 'time', half: true, req: true, live: showDur })),
      durEl,
      h('div', { class: 'grid2' },
        h('div', { class: 'field half' }, h('label', { class: 'lbl', for: 'mar-JOB_TYPE' }, 'Job Type', h('span', { class: 'req' }, ' *')), jt),
        h('div', { class: 'field half' }, h('label', { class: 'lbl', for: 'mar-SUB_TYPE' }, 'Job Sub Type', h('span', { class: 'req' }, ' *')), st),
        h('div', { class: 'field half' }, h('label', { class: 'lbl', for: 'mar-STATUS' }, 'Status', h('span', { class: 'req' }, ' *')), stat)),
      h('h3', { class: 'sec-t' }, 'Customer & unit' + (needCust ? '' : ' (opsional)')),
      scPick, popPick,
      h('div', { class: 'grid2' },
        fld('Customer', 'CUSTOMER', { req: needCust }), fld('Call ID', 'CALL_ID', { half: true }), fld('Serial Number', 'SN', { half: true }),
        fld('Brand', 'BRAND', { half: true }), fld('Model', 'MODEL', { half: true }), fld('Location', 'LOCATION')),
      f.MHC_NO ? h('div', { class: 'banner info' }, 'Terhubung ke ' + f.MHC_NO, h('button', { type: 'button', class: 'linkbtn', onclick: function () { f.MHC_NO = ''; render(); } }, 'lepas')) : null,
      fld('Jobs Description', 'DESC', { textarea: true, req: true }), fld('Remarks', 'REMARKS', { textarea: true }),
      h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Simpan kegiatan'));
  }

  /* ---------- Review / download MAR tim ---------- */
  /* ---------- MAR: tidak masuk, riwayat, rekap utilisasi ---------- */
  function marAbsList() { return marCfg().absence || ['Cuti', 'Sakit', 'Ijin', 'Ijin ½ hari', 'Dinas / Training luar']; }
  function marIsHalf(t) { return (marCfg().halfDay || ['Ijin ½ hari']).indexOf(t) >= 0; }
  function marAbsForm(list) {
    var M = S.mar, A = M.abs || (M.abs = { DATE: M.date, ABSENCE: '', REMARKS: '' });
    var rem = h('input', { class: 'inp', id: 'mar-abs-rem', placeholder: 'Keterangan (opsional)', value: A.REMARKS });
    rem.addEventListener('input', function () { A.REMARKS = rem.value; });
    var save = function () {
      if (!A.DATE) return toast('Pilih tanggal', 'warn');
      if (!A.ABSENCE) return toast('Pilih jenis tidak masuk', 'warn');
      var dayActs = (A.DATE === M.date ? list : []).filter(function (x) { return !x.absence; });
      if (!marIsHalf(A.ABSENCE) && dayActs.length) return toast('Tanggal ini sudah ada kegiatan. Untuk sebagian hari pilih "Ijin ½ hari".', 'err');
      if ((A.DATE === M.date ? list : []).some(function (x) { return x.absence; })) return toast('Tanggal ini sudah tercatat tidak masuk', 'err');
      var v = { DATE: A.DATE, ABSENCE: A.ABSENCE, REMARKS: String(A.REMARKS || '').trim() };
      saveItem({ id: uid(), kind: 'mar', company: S.session.company, username: S.session.user.username, createdAt: Date.now(), status: 'pending',
        payload: { values: v, branch: S.session.user.branch }, summary: { title: 'MAR ' + fmtDate(v.DATE) + ' · ' + v.ABSENCE, sub: v.REMARKS || 'Tidak masuk' } })
        .then(function () {
          M.abs = null; M.kind = 'act'; M.date = v.DATE; render(); toast(online() ? v.ABSENCE + ' dicatat — mengirim…' : 'Tersimpan di HP — terkirim saat online', 'ok');
          syncQueue().then(function () { loadCounts(); if (S.view === 'mar') loadMarDay(); });
        });
    };
    return h('div', { class: 'card mar-form' }, h('h2', null, 'Tidak masuk'),
      h('p', { class: 'muted small' }, 'Catat bila Anda tidak bekerja di hari kerja. Hari itu dianggap sudah terisi dan direview SL. "Ijin ½ hari" tetap mengisi kegiatan di setengah hari lainnya.'),
      h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Tanggal'), h('input', { class: 'inp', type: 'date', id: 'mar-abs-date', value: A.DATE, max: isoAdd(todayISO(), 60), onchange: function (e) { A.DATE = e.target.value; } })),
      h('label', { class: 'lbl' }, 'Jenis', h('span', { class: 'req' }, ' *')),
      segmented(marAbsList(), A.ABSENCE, function (t) { A.ABSENCE = t; }, 'mar-abs'),
      h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Keterangan'), rem),
      h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Simpan tidak masuk'));
  }
  function marPeriod(p) {
    var t = todayISO(), y = +t.slice(0, 4), m = +t.slice(5, 7);
    if (p === 'week') { var d = dowOf(t) || 7; return [isoAdd(t, 1 - d), t]; }
    if (p === 'prev') { var pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y, last = new Date(Date.UTC(py, pm, 0)).getUTCDate(); return [py + '-' + pad(pm) + '-01', py + '-' + pad(pm) + '-' + pad(last)]; }
    return [y + '-' + pad(m) + '-01', t];
  }
  function marUtil(c) {
    var num = (c.Travel || 0) + (c.Working || 0) + (c.Reporting || 0), den = num + (c.Training || 0) + (c.Standby || 0);
    return den ? Math.round(num / den * 1000) / 10 : null;
  }
  function utilBand(u) {
    var U = marCfg().util || { low: 70, high: 80 };
    if (u == null) return null;
    return u < U.low ? { t: 'Kurang beban', tone: 'wait' } : u < U.high ? { t: 'Cukup', tone: 'ok' } : { t: 'Overload', tone: 'bad' };
  }
  function marWorkdays(from, to) {
    var req = marCfg().requiredFrom || '', n = 0, d = from > req ? from : req;
    for (; d <= to; d = isoAdd(d, 1)) if (!marDayInfo(d).off) n++;
    return n;
  }
  function loadMarHist() {
    var M = S.mar, Hh = M.hist || (M.hist = { period: 'month' }), p = marPeriod(Hh.period);
    Hh.from = p[0]; Hh.to = p[1]; Hh.loading = true; render();
    api('formListMar', { token: S.session.token, scope: 'mine', from: Hh.from, to: Hh.to }).then(function (r) { Hh.loading = false; Hh.data = r; if (S.view === 'mar') render(); })
      .catch(function (e) { Hh.loading = false; toast(e.message, 'err'); if (S.view === 'mar') render(); });
  }
  function viewMarHist() {
    var M = S.mar, Hh = M.hist || {}, cfg = marCfg(), D = Hh.data;
    var per = h('div', { class: 'card' }, h('h2', null, 'Riwayat MAR'),
      segmented(['Minggu ini', 'Bulan ini', 'Bulan lalu'], { week: 'Minggu ini', month: 'Bulan ini', prev: 'Bulan lalu' }[Hh.period || 'month'], function (x) {
        Hh.period = { 'Minggu ini': 'week', 'Bulan ini': 'month', 'Bulan lalu': 'prev' }[x]; loadMarHist(); }, 'mar-per'));
    if (Hh.loading || !D) return h('div', null, per, h('div', { class: 'card center muted' }, Hh.loading ? 'Memuat…' : online() ? '' : 'Riwayat butuh koneksi internet'));
    var byDate = {}; D.summary.forEach(function (s) { byDate[s.date] = s; });
    var miss = {}; ((D.missing || {})[S.session.user.name] || []).forEach(function (d) { miss[d] = 1; });
    var cats = {}, ot = 0, abs = {};
    D.summary.forEach(function (s) { Object.keys(s.cats).forEach(function (c) { cats[c] = (cats[c] || 0) + s.cats[c]; }); ot += s.ot; if (s.absence) abs[s.absence] = (abs[s.absence] || 0) + 1; });
    var yday = isoAdd(todayISO(), -1), wd = marWorkdays(Hh.from, Hh.to < yday ? Hh.to : yday), nMiss = Object.keys(miss).length, util = marUtil(cats), band = utilBand(util);
    var tot = 0; Object.keys(cats).forEach(function (c) { tot += cats[c]; });
    var head = h('div', { class: 'card' },
      h('div', { class: 'mar-tot' },
        h('div', null, h('div', { class: 'muted small' }, 'Belum diisi'), h('div', { class: 'big' + (nMiss ? ' bad-t' : '') }, nMiss + ' hari')),
        h('div', null, h('div', { class: 'muted small' }, 'Total jam · OT'), h('div', { class: 'big' }, fmtH(Math.round(tot * 100) / 100)), h('div', { class: 'small bad-t' }, ot ? 'OT ' + fmtH(Math.round(ot * 100) / 100) : '')),
        h('div', null, h('div', { class: 'muted small' }, 'Utilisasi'), h('div', { class: 'big' }, util == null ? '—' : util + '%'), band ? chip(band.t, band.tone) : null)),
      h('div', { class: 'chips' }, cfg.categories.map(function (c) { return cats[c] ? chip(c + ' ' + fmtH(Math.round(cats[c] * 100) / 100), MAR_CAT_TONE[c]) : null; }),
        Object.keys(abs).map(function (a) { return chip(a + ' ' + abs[a] + ' hari', 'info'); })),
      h('p', { class: 'hint' }, wd + ' hari kerja sampai kemarin · utilisasi = (Travel + Working + Reporting) ÷ total jam'));
    var rows = [], req = cfg.requiredFrom || '';
    for (var d = Hh.to; d >= Hh.from; d = isoAdd(d, -1)) {
      var s = byDate[d], info = marDayInfo(d), st;
      if (s && s.absence && !s.n) st = chip(s.absence, 'info');
      else if (s) st = [h('b', null, fmtH(s.total)), s.ot ? h('span', { class: 'bad-t small' }, ' OT ' + fmtH(s.ot)) : null, s.absence ? chip(s.absence, 'info') : null];
      else if (miss[d]) st = chip('Belum diisi', 'bad');
      else if (d === todayISO()) st = h('span', { class: 'muted small' }, 'Hari ini');
      else if (info.off) st = h('span', { class: 'muted small' }, info.off);
      else st = h('span', { class: 'muted small' }, d < req ? 'Sebelum MAR wajib' : '—');
      var rv = s ? chip(s.wait ? s.review : 'OK', s.wait ? (s.review === cfg.review.REVISE ? 'bad' : 'wait') : 'ok') : null;
      (function (dd) {
        rows.push(h('button', { type: 'button', class: 'qitem mar-hrow' + (miss[dd] ? ' miss' : ''), onclick: function () { M.mode = 'day'; M.date = dd; loadMarDay(); } },
          h('div', { class: 'mar-hd' }, h('b', null, cfg.days[dowOf(dd)].slice(0, 3) + ', ' + fmtDate(dd))), h('div', { class: 'mar-hs' }, st), rv));
      })(d);
    }
    return h('div', null, per, head, h('div', { class: 'card' }, rows));
  }
  /** Rekap per mekanik + utilisasi untuk SL / Admin PS */
  function marRekap(D, from, to) {
    var cfg = marCfg(), yday = isoAdd(todayISO(), -1), wd = marWorkdays(from, to < yday ? to : yday), by = {};
    var names = (D.mechanics || []).map(function (m) { return m.name; });
    D.rows.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
    names.forEach(function (n) { by[n] = { name: n, cats: {}, ot: 0, abs: {}, missing: ((D.missing || {})[n] || []).length }; });
    D.rows.forEach(function (r) { var x = by[r.name]; if (r.cat) x.cats[r.cat] = (x.cats[r.cat] || 0) + r.hours; x.ot += r.ot || 0; });
    D.summary.forEach(function (s) { if (s.absence && by[s.name]) by[s.name].abs[s.absence] = (by[s.name].abs[s.absence] || 0) + 1; });
    var list = names.map(function (n) {
      var x = by[n], tot = 0; cfg.categories.forEach(function (c) { tot += x.cats[c] || 0; });
      x.total = Math.round(tot * 100) / 100; x.ot = Math.round(x.ot * 100) / 100; x.util = marUtil(x.cats); x.wd = wd; x.filled = Math.max(0, wd - x.missing);
      x.comply = wd ? Math.round(x.filled / wd * 100) : null; return x;
    }).sort(function (a, b) { return (b.util || -1) - (a.util || -1); });
    var all = { name: 'Total cabang', cats: {}, ot: 0, abs: {}, missing: 0, wd: 0, filled: 0 };
    list.forEach(function (x) { cfg.categories.forEach(function (c) { all.cats[c] = (all.cats[c] || 0) + (x.cats[c] || 0); }); all.ot += x.ot; all.missing += x.missing; all.wd += x.wd; all.filled += x.filled;
      Object.keys(x.abs).forEach(function (a) { all.abs[a] = (all.abs[a] || 0) + x.abs[a]; }); });
    var t = 0; cfg.categories.forEach(function (c) { t += all.cats[c] || 0; }); all.total = Math.round(t * 100) / 100; all.ot = Math.round(all.ot * 100) / 100;
    all.util = marUtil(all.cats); all.comply = all.wd ? Math.round(all.filled / all.wd * 100) : null;
    return { list: list, all: all, wd: wd };
  }
  function viewMarRekap(T) {
    var D = T.data, cfg = marCfg(), R = marRekap(D, D.from, D.to), U = cfg.util || { low: 70, high: 80 };
    var h1 = function (x) { return x ? Math.round(x * 10) / 10 : ''; };
    var absTxt = function (a) { return Object.keys(a).map(function (k) { return k + ' ' + a[k]; }).join(', ') || '—'; };
    var row = function (x, isAll) {
      var b = utilBand(x.util);
      return h('tr', { class: isAll ? 'tot' : '' }, h('td', null, h('b', null, x.name)), h('td', { class: 'num' }, x.util == null ? '—' : x.util + '%'), h('td', null, b ? chip(b.t, b.tone) : ''),
        h('td', { class: 'num' }, x.wd), h('td', { class: 'num' }, x.missing ? h('span', { class: 'chip bad' }, x.missing) : '0'), h('td', { class: 'num' }, x.comply == null ? '—' : x.comply + '%'), h('td', { class: 'small' }, absTxt(x.abs)),
        cfg.categories.map(function (c) { return h('td', { class: 'num' }, h1(x.cats[c])); }), h('td', { class: 'num' }, h('b', null, h1(x.total))), h('td', { class: 'num' }, h1(x.ot)));
    };
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, 'Rekap utilisasi ' + fmtDate(D.from) + ' – ' + fmtDate(D.to)),
        h('div', { class: 'chips util-legend' }, chip('< ' + U.low + '% Kurang beban kerja', 'wait'), chip(U.low + '–' + U.high + '% Cukup', 'ok'), chip('≥ ' + U.high + '% Overload — perlu bantuan mekanik cabang lain', 'bad')),
        h('p', { class: 'hint' }, 'Utilisasi = (Travel + Working + Reporting) ÷ (Travel + Working + Training + Reporting + Standby). Kepatuhan = hari kerja terisi ÷ hari kerja (sampai kemarin, mulai ' + fmtDate(cfg.requiredFrom || '') + '). Jam dalam satuan jam.'),
        h('div', { class: 'tblwrap' }, h('table', { class: 'tbl rekap-tbl' },
          h('thead', null, h('tr', null, ['Mekanik', 'Utilisasi', '', 'Hari kerja', 'Belum isi', 'Kepatuhan', 'Tidak masuk'].concat(cfg.categories, ['Total', 'OT']).map(function (t) { return h('th', null, t); }))),
          h('tbody', null, R.list.map(function (x) { return row(x); }), R.list.length > 1 ? row(R.all, true) : null)))));
  }
  function exportRekapSheet(T) {
    var D = T.data; if (!D) return null;
    var cfg = marCfg(), R = marRekap(D, D.from, D.to);
    var r1 = function (x) { var b = utilBand(x.util); return [x.name, x.util == null ? '' : x.util / 100, b ? b.t : '', x.wd, x.missing, x.comply == null ? '' : x.comply / 100, Object.keys(x.abs).map(function (k) { return k + ' ' + x.abs[k]; }).join(', ')]
      .concat(cfg.categories.map(function (c) { return Math.round((x.cats[c] || 0) * 100) / 100; }), [x.total, x.ot]); };
    return { name: 'Rekap Utilisasi', rows: [['Mekanik', 'Utilisasi', 'Kategori', 'Hari kerja', 'Belum isi', 'Kepatuhan', 'Tidak masuk'].concat(cfg.categories, ['Total jam', 'Overtime'])]
      .concat(R.list.map(r1), [r1(R.all)]), widths: [24, 10, 14, 10, 9, 10, 22, 8, 8, 8, 9, 8, 9, 9] };
  }
  function openMarTeam() { var T = S.marTeam || (S.marTeam = { from: isoAdd(todayISO(), -6), to: todayISO(), pending: can('marReview'), name: '', open: {}, mode: can('marReview') ? 'day' : 'rekap' }); if (T.mode === 'rekap') T.pending = false; go('marTeam'); loadMarTeam(); }
  function loadMarTeam() {
    var T = S.marTeam; if (!online()) return toast('Butuh koneksi internet', 'warn');
    T.loading = true; render();
    api('formListMar', { token: S.session.token, scope: 'branch', from: T.from, to: T.to, pending: T.pending, name: T.name }, 60000)
      .then(function (r) { T.loading = false; T.data = r; if (can('marReview')) { S.counts = Object.assign(S.counts || {}, {}); } render(); })
      .catch(function (e) { T.loading = false; toast(e.message, 'err'); render(); });
  }
  function marReview(s, status) {
    var note = '';
    if (status === 'revise') { note = prompt('Catatan revisi untuk ' + s.name + ' (' + fmtDate(s.date) + '):', ''); if (note === null) return; if (!note.trim()) return toast('Catatan revisi wajib diisi', 'warn'); }
    api('formReviewMar', { token: S.session.token, name: s.name, date: s.date, status: status, note: note }).then(function (x) {
      toast((status === 'ok' ? 'Review OK · ' : 'Dikembalikan untuk revisi · ') + x.updated + ' kegiatan', 'ok'); loadMarTeam(); loadMarCount();
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function exportMarXlsx() {
    var T = S.marTeam, R = (T.data && T.data.rows) || [];
    if (!R.length) return toast('Tidak ada data untuk diunduh', 'warn');
    var cats = marCfg().categories;
    var head = ['Day', 'Date', 'Branch', 'Name', 'NIK', 'Customer', 'Brand', 'Model', 'Serial Number', 'Location', 'Jobs Description', 'Call Id', 'Job Type', 'Job Sub Type', 'Status', 'Start Time', 'Stop Time'].concat(cats, ['Total Hours', 'Overtime', 'MAR No', 'MHC No', 'Remarks', 'Review Status', 'Reviewed By', 'Review Note']);
    var sorted = R.slice().sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.name !== b.name ? (a.name < b.name ? -1 : 1) : hm2min(a.start) - hm2min(b.start); });
    var rows = [head].concat(sorted.map(function (r) {
      return [r.day, r.date, r.branch, r.name, r.nik, r.customer, r.brand, r.model, r.sn, r.location, r.absence ? r.absence + ' (tidak masuk)' : r.desc, r.callId, r.jobType, r.subType, r.status, r.start, r.stop]
        .concat(cats.map(function (c) { return r.cat === c ? r.hours : ''; }), [r.hours, r.ot || 0, r.marNo, r.mhcNo, r.remarks, r.review, r.reviewBy, r.reviewNote]);
    }));
    var rekap = [['Name', 'Date', 'Day'].concat(cats, ['Total Hours', 'Overtime', 'Kegiatan', 'Review', 'Tidak masuk'])].concat(((T.data && T.data.summary) || []).map(function (s) {
      return [s.name, s.date, s.day].concat(cats.map(function (c) { return s.cats[c] || ''; }), [s.total, s.ot, s.n, s.wait ? s.review : 'OK', s.absence || '']);
    }));
    var shs = [{ name: 'MAR', rows: rows, widths: [9, 11, 8, 22, 14, 26, 8, 10, 14, 16, 34, 12, 10, 22, 12, 8, 8, 8, 8, 8, 9, 8, 9, 9, 20, 18, 20, 14, 18, 24] },
               { name: 'Rekap per hari', rows: rekap, widths: [22, 11, 9, 8, 8, 8, 9, 8, 10, 9, 9, 14] }];
    if (!T.pending) { var rs = exportRekapSheet(T); if (rs) shs.unshift(rs); }
    var blob = makeXlsx(shs);
    var url = URL.createObjectURL(blob), a = h('a', { href: url, download: 'MAR_' + S.session.company + '_' + T.from + '_sd_' + T.to + '.xlsx' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast('Excel MAR diunduh', 'ok');
  }
  function viewMarTeam() {
    var T = S.marTeam, D = T.data, cfg = marCfg();
    var names = {}; ((D && D.rows) || []).forEach(function (r) { names[r.name] = 1; });
    var setP = function (p) { var x = marPeriod(p); T.from = x[0]; T.to = x[1]; loadMarTeam(); };
    var modeSel = h('div', { class: 'mar-modes' }, segmented(can('marReview') ? ['Review per hari', 'Rekap utilisasi'] : ['Rekap utilisasi', 'Kegiatan per hari'], T.mode === 'rekap' ? 'Rekap utilisasi' : can('marReview') ? 'Review per hari' : 'Kegiatan per hari', function (x) {
      T.mode = x === 'Rekap utilisasi' ? 'rekap' : 'day'; if (T.mode === 'rekap' && T.pending) { T.pending = false; loadMarTeam(); } else render(); }, 'mar-mode'));
    var filt = h('div', { class: 'card' }, h('h2', null, can('marReview') ? 'Review MAR mekanik' : 'Rekap MAR mekanik'),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn small ghost', onclick: function () { setP('week'); } }, 'Minggu ini'), h('button', { class: 'btn small ghost', onclick: function () { setP('month'); } }, 'Bulan ini'), h('button', { class: 'btn small ghost', onclick: function () { setP('prev'); } }, 'Bulan lalu')),
      h('div', { class: 'grid2' },
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Dari'), h('input', { class: 'inp', type: 'date', value: T.from, onchange: function (e) { T.from = e.target.value; } })),
        h('div', { class: 'field half' }, h('label', { class: 'lbl' }, 'Sampai'), h('input', { class: 'inp', type: 'date', value: T.to, max: todayISO(), onchange: function (e) { T.to = e.target.value; } }))),
      T.mode === 'rekap' ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: T.pending, onchange: function (e) { T.pending = e.target.checked; } }), 'Hanya yang belum di-review OK'),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: loadMarTeam }, 'Tampilkan'),
        h('button', { class: 'btn', disabled: !(D && D.rows.length), onclick: exportMarXlsx }, '⬇ Download Excel')),
      h('p', { class: 'hint' }, 'Maksimal ±3 bulan per tampilan. Excel berisi semua kegiatan + rekap per mekanik per hari (total jam & overtime).'));
    if (T.loading) return h('div', null, modeSel, filt, h('div', { class: 'card center muted' }, 'Memuat…'));
    if (!D) return h('div', null, modeSel, filt);
    if (T.mode === 'rekap') return h('div', null, modeSel, filt, viewMarRekap(T));
    if (!D.summary.length) return h('div', null, modeSel, filt, h('div', { class: 'card center muted' }, T.pending ? 'Semua MAR di periode ini sudah di-review OK.' : 'Tidak ada data MAR di periode ini.'));
    var byKey = {}; D.rows.forEach(function (r) { var k = r.name + '|' + r.date; (byKey[k] = byKey[k] || []).push(r); });
    var cards = D.summary.map(function (s) {
      var k = s.name + '|' + s.date, open = !!T.open[k], acts = (byKey[k] || []).slice().sort(function (a, b) { return hm2min(a.start) - hm2min(b.start); });
      return h('div', { class: 'card mar-day' },
        h('button', { type: 'button', class: 'g-head', onclick: function () { T.open[k] = !open; render(); } },
          h('span', { class: 'g-t' }, s.name, h('div', { class: 'muted small' }, s.day + ', ' + fmtDate(s.date) + ' · ' + (s.absence ? s.absence : s.n + ' kegiatan'))),
          h('span', { class: 'mar-sum' }, h('b', null, fmtH(s.total)), s.ot ? h('span', { class: 'bad-t small' }, ' OT ' + fmtH(s.ot)) : null),
          chip(s.wait ? s.review : 'OK', s.wait ? (s.review === cfg.review.REVISE ? 'bad' : 'wait') : 'ok'), h('span', { class: 'g-chev' }, open ? '▾' : '▸')),
        open ? h('div', { class: 'mar-acts' }, h('div', { class: 'chips' }, cfg.categories.map(function (c) { return s.cats[c] ? chip(c + ' ' + fmtH(s.cats[c]), MAR_CAT_TONE[c]) : null; })),
          acts.map(function (x) {
            if (x.absence) return h('div', { class: 'qitem mar-act' }, h('div', { class: 'mar-time' }, h('b', null, '—')), h('div', { class: 'qmain' }, h('div', null, chip(x.absence, 'info'), ' ', h('b', null, 'Tidak masuk')), x.remarks ? h('div', { class: 'small muted' }, x.remarks) : null));
            return h('div', { class: 'qitem mar-act' }, h('div', { class: 'mar-time' }, h('b', null, x.start), h('span', { class: 'muted small' }, x.stop)),
              h('div', { class: 'qmain' }, h('div', null, chip(x.cat, MAR_CAT_TONE[x.cat]), ' ', h('b', null, fmtH(x.hours)), x.ot ? h('span', { class: 'bad-t small' }, ' (OT ' + fmtH(x.ot) + ')') : null),
                h('div', { class: 'small' }, [x.jobType + (x.subType !== x.jobType ? ' · ' + x.subType : ''), x.status].join(' · ')),
                h('div', { class: 'small muted' }, [x.customer, x.callId && 'Call ID ' + x.callId, x.mhcNo, x.desc].filter(Boolean).join(' · ')),
                x.reviewNote ? h('div', { class: 'small err-text' }, 'Catatan SL: ' + x.reviewNote) : null));
          }),
          can('marReview') && s.wait ? h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: function () { marReview(s, 'ok'); } }, '✓ OK'),
            h('button', { class: 'btn', onclick: function () { marReview(s, 'revise'); } }, 'Minta revisi')) : null) : null);
    });
    return h('div', null, modeSel, filt, h('h3', { class: 'sec-t' }, D.summary.length + ' hari-mekanik' + (T.pending ? ' belum di-review' : '')), cards);
  }

  /* ================= antrean ================= */
  /* ================= Call Center: survei kepuasan Parts & Service + keluhan ================= */
  function ccCfg() { return (S.boot && S.boot.cc) || { questions: { Parts: [], Service: [] }, scale: [], attemptResults: [], maxAttempts: 3, dueWorkdays: 2, lowScore: 2, lowOverall: 3, complaintCat: ['Teknis', 'Non-teknis'] }; }
  function telOf(p) { return String(p || '').replace(/[^\d+]/g, ''); }
  function waOf(p) { var d = String(p || '').replace(/\D/g, ''); if (/^0/.test(d)) d = '62' + d.slice(1); return d ? 'https://wa.me/' + d : ''; }
  function nowLocalIso() { var d = new Date(); return todayISO() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var CC_FILTERS = [['call', 'Perlu ditelepon'], ['late', 'Lewat batas'], ['resched', 'Dijadwalkan ulang'], ['done', 'Selesai'], ['fail', 'Tidak bisa dihubungi / menolak'], ['all', 'Semua']];
  function ccMatch(x, f) {
    if (f === 'call') return x.callable;
    if (f === 'late') return x.overdue;
    if (f === 'resched') return x.pending && x.status === 'Dijadwalkan ulang';
    if (f === 'done') return x.status === 'Selesai';
    if (f === 'fail') return x.status === 'Tidak bisa dihubungi' || x.status === 'Menolak disurvei';
    return true;
  }
  var CC_TONE = { 'Menunggu': 'wait', 'Dijadwalkan ulang': 'info', 'Selesai': 'ok', 'Tidak bisa dihubungi': 'bad', 'Menolak disurvei': 'bad' };
  function openCc(f) {
    var C = S.cc || (S.cc = { filter: 'call', type: '', branch: '', q: '', rows: null });
    if (f) C.filter = f;
    go('cc'); loadCc();
  }
  function loadCc() {
    var C = S.cc;
    if (!online()) { toast('Survei butuh koneksi internet', 'warn'); return; }
    C.loading = true; if (S.view === 'cc') render();
    return api('formCcList', { token: S.session.token }, 60000).then(function (x) {
      C.loading = false; C.rows = x.rows; C.today = x.today; if (x.cfg && S.boot) S.boot.cc = x.cfg;
      setCounts({ ccDue: x.rows.filter(function (r) { return r.callable; }).length, ccLate: x.rows.filter(function (r) { return r.overdue; }).length });
      if (S.view === 'cc') render();
    }).catch(function (e) { C.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'cc') render(); });
  }
  function dueText(x, today) {
    if (!x.pending) return '';
    if (x.overdue) { var n = Math.round((Date.parse(today) - Date.parse(x.due)) / 864e5); return 'Lewat batas ' + fmtDate(x.due) + (n > 0 ? ' (' + n + ' hari)' : ''); }
    return x.dueToday ? 'Batas hari ini' : 'Batas ' + fmtDate(x.due);
  }
  function viewCc() {
    var C = S.cc, cfg = ccCfg();
    var title = 'Survei Kepuasan Customer';
    if (C.loading && !C.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center muted' }, 'Memuat daftar survei…'));
    if (!C.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center' }, h('button', { class: 'btn', onclick: loadCc }, 'Tampilkan')));
    var base = C.rows.filter(function (x) { return (!C.type || x.type === C.type) && (!C.branch || x.branch === C.branch); });
    var ql = C.q.toLowerCase();
    var rows = base.filter(function (x) { return ccMatch(x, C.filter) && (!ql || [x.customer, x.mhcNo, x.invNo, x.unit, x.contact, x.phone].join(' ').toLowerCase().indexOf(ql) >= 0); });
    var cnt = function (f) { return base.filter(function (x) { return ccMatch(x, f); }).length; };
    var kpi = function (label, big, sub, tone, f) {
      return h('button', { type: 'button', class: 'kpi ' + (tone || '') + (C.filter === f ? ' on' : ''), onclick: function () { C.filter = f; render(); } },
        h('span', { class: 'kpi-l' }, label), h('b', { class: 'kpi-v' }, big), h('span', { class: 'kpi-s' }, sub));
    };
    var nCall = cnt('call'), nLate = cnt('late');
    var done = base.filter(function (x) { return x.status === 'Selesai'; });
    var branches = {}; C.rows.forEach(function (x) { branches[x.branch] = 1; });
    var q = h('input', { class: 'inp sm', type: 'search', id: 'cc-search', placeholder: 'Cari customer / MHC / invoice / telepon…', value: C.q });
    q.addEventListener('input', debounce(function () { C.q = q.value.trim(); render(); var el = document.getElementById('cc-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    var head = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, title), h('div', { class: 'row-btns' },
        h('button', { class: 'btn small ghost', onclick: loadCc, disabled: !!C.loading }, C.loading ? 'Memuat…' : '↻ Muat ulang'),
        can('ccRekap') ? h('button', { class: 'btn small', onclick: function () { openCcRekap(); } }, '▦ Rekap') : null)),
      h('p', { class: 'hint' }, 'MHC yang sudah ber-Invoice: Parts & Service disurvei terpisah, maksimal ' + cfg.dueWorkdays + ' hari kerja setelah tanggal invoice. ' +
        'Tidak tersambung ' + cfg.maxAttempts + '× → Tidak bisa dihubungi.'),
      h('div', { class: 'kpis' },
        kpi('Perlu ditelepon', String(nCall), 'menunggu / jadwal ulang sudah tiba', nCall ? 'bad' : 'ok', 'call'),
        kpi('Lewat batas', String(nLate), 'lebih dari ' + cfg.dueWorkdays + ' hari kerja', nLate ? 'bad' : 'ok', 'late'),
        kpi('Dijadwalkan ulang', String(cnt('resched')), 'telepon kembali nanti', '', 'resched'),
        kpi('Selesai', String(done.length), done.length ? 'rata-rata kepuasan ' + (Math.round(done.reduce(function (a, x) { return a + (Number(x.overall) || 0); }, 0) / done.length * 10) / 10) : '—', 'ok', 'done'),
        kpi('Tidak terhubung', String(cnt('fail')), 'tidak bisa dihubungi / menolak', '', 'fail')),
      h('div', { class: 'chips filt' }, CC_FILTERS.map(function (f) {
        var n = cnt(f[0]);
        return h('button', { type: 'button', class: 'fchip' + (C.filter === f[0] ? ' on' : ''), onclick: function () { C.filter = f[0]; render(); } }, f[1], n && f[0] !== 'all' && f[0] !== 'done' ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q,
        h('select', { class: 'inp sm', id: 'cc-type', onchange: function (e) { C.type = e.target.value; render(); } }, [['', 'Parts & Service'], ['Parts', 'Parts'], ['Service', 'Service']].map(function (o) { return h('option', { value: o[0], selected: C.type === o[0] }, o[1]); })),
        Object.keys(branches).length > 1 ? h('select', { class: 'inp sm', id: 'cc-branch', onchange: function (e) { C.branch = e.target.value; render(); } },
          h('option', { value: '' }, 'Semua cabang'), Object.keys(branches).sort().map(function (b) { return h('option', { value: b, selected: C.branch === b }, b); })) : null));
    var body = !rows.length ? h('div', { class: 'card center muted' }, C.filter === 'call' ? 'Tidak ada survei yang perlu ditelepon sekarang. 👍' : 'Tidak ada survei di filter ini.')
      : h('div', { class: 'qlist' }, rows.map(function (x) {
        var dt = dueText(x, C.today || todayISO());
        return h('button', { type: 'button', class: 'card item ccitem' + (x.overdue ? ' due' : ''), onclick: function () { openCcSurvey(x); } },
          h('div', { class: 'item-top' }, h('b', null, x.customer || '(tanpa customer)'), h('span', { class: 'chip ' + (x.type === 'Parts' ? 'cat' : 'info') }, x.type)),
          h('div', { class: 'muted small' }, [x.mhcNo, x.branch, 'Invoice ' + x.invNo + ' · ' + fmtDate(x.invDate)].join(' · ')),
          h('div', { class: 'small' }, [x.contact, x.phone].filter(Boolean).join(' · ') || h('span', { class: 'warn-text' }, 'Kontak belum ada di MHC')),
          h('div', { class: 'chips' }, chip(x.status, CC_TONE[x.status]), x.attempts ? h('span', { class: 'chip' }, x.attempts + '× telepon') : null,
            x.next && x.pending ? h('span', { class: 'chip info' }, 'Telepon lagi ' + fmtDate(x.next) + ' ' + x.next.slice(11)) : null,
            dt ? h('span', { class: 'chip ' + (x.overdue ? 'bad' : x.dueToday ? 'wait' : '') }, dt) : null,
            x.status === 'Selesai' ? h('span', { class: 'chip ' + (x.low ? 'bad' : 'ok') }, 'Puas ' + x.overall + '/5 · NPS ' + x.nps) : null,
            x.complaintId ? h('span', { class: 'chip bad' }, 'Keluhan ' + x.complaintId) : null));
      }));
    return h('div', null, head, body);
  }
  function openCcSurvey(x) {
    S.ccs = { it: x, ans: {}, overall: '', nps: '', comment: '', contact: x.contact, phone: x.phone, kc: { on: false, category: x.type === 'Service' ? 'Teknis' : 'Non-teknis', desc: '' },
              att: { result: '', next: '', note: '' }, clientId: uid() };
    go('ccSurvey');
  }
  function scoreBtns(cur, n0, n1, onPick, extra) {
    var wrap = h('div', { class: 'score' + (n1 > 5 ? ' nps' : '') });
    for (var i = n0; i <= n1; i++) (function (i) {
      var tone = n1 > 5 ? (i <= 6 ? 'lo' : i <= 8 ? 'mid' : 'hi') : (i <= 2 ? 'lo' : i === 3 ? 'mid' : 'hi');
      wrap.appendChild(h('button', { type: 'button', class: 'sc-btn ' + tone + (cur === i ? ' on' : ''), onclick: function () { onPick(i); } }, String(i)));
    })(i);
    if (extra) wrap.appendChild(h('button', { type: 'button', class: 'sc-btn na' + (cur === 'NA' ? ' on' : ''), onclick: function () { onPick('NA'); } }, 'N/A'));
    return wrap;
  }
  function ccLow(W, type) {
    var cfg = ccCfg();
    if (W.overall !== '' && Number(W.overall) <= cfg.lowOverall) return true;
    return (cfg.questions[type] || []).some(function (q) { var v = W.ans[q.id]; return typeof v === 'number' && v <= cfg.lowScore; });
  }
  function viewCcSurvey() {
    var W = S.ccs, x = W.it, cfg = ccCfg(), Q = cfg.questions[x.type] || [], scale = cfg.scale || [];
    var back = h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { openCc(); } }, '‹ Kembali ke daftar survei');
    var tel = telOf(W.phone), wa = waOf(W.phone);
    var info = h('div', { class: 'card summary' },
      h('div', { class: 'card-head' }, h('h2', null, x.customer || '(tanpa customer)'), h('span', { class: 'chip ' + (x.type === 'Parts' ? 'cat' : 'info') }, 'Survei ' + x.type)),
      h('div', { class: 'chips', style: 'margin:-4px 0 8px' }, chip(x.status, CC_TONE[x.status]), x.pending ? h('span', { class: 'chip ' + (x.overdue ? 'bad' : 'wait') }, dueText(x, (S.cc && S.cc.today) || todayISO())) : null),
      kvRow('MHC', x.mhcNo + ' · ' + x.branch), kvRow('Unit', x.unit), kvRow('Invoice', x.invNo + ' · ' + fmtDate(x.invDate)),
      x.type === 'Service' ? kvRow('Mekanik', x.mekanik || '—') : kvRow('PSSR', x.pssr || '— (belum ada PSSR)'),
      x.attempts ? kvRow('Percobaan telepon', x.attempts + '×' + (x.last ? ' · terakhir ' + fmtDate(x.last) + ' ' + x.last.slice(11) : '')) : null,
      x.log ? h('details', { class: 'small' }, h('summary', null, 'Riwayat telepon'), h('pre', { class: 'log' }, x.log.replace(/ #\S+/g, ''))) : null,
      x.status !== 'Selesai' ? h('div', { class: 'cc-contact' },
        h('label', { class: 'lbl' }, 'Contact Person'), h('input', { class: 'inp', id: 'cc-contact', value: W.contact || '', oninput: function (e) { W.contact = e.target.value; } }),
        h('label', { class: 'lbl' }, 'Telepon'), h('input', { class: 'inp', id: 'cc-phone', type: 'tel', value: W.phone || '', oninput: function (e) { W.phone = e.target.value; },
          onchange: function () { render(); } }),
        h('div', { class: 'row-btns' }, tel ? h('a', { class: 'btn primary', href: 'tel:' + tel }, '☎ Telepon ' + W.phone) : h('span', { class: 'warn-text small' }, 'Isi nomor telepon customer'),
          wa ? h('a', { class: 'btn small', href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
          h('button', { class: 'btn small ghost', onclick: function () { openDetail({ row: x.mhcRow, mhcNo: x.mhcNo, isOld: false }); S.detail.from = 'ccSurvey'; } }, 'Lihat MHC'))) : null);
    if (x.status === 'Selesai') {
      var res = h('div', { class: 'card' }, h('h2', null, 'Hasil survei'),
        kvRow('Disurvei', (x.surveyedBy || '') + ' · ' + fmtDate(x.surveyedAt) + ' ' + String(x.surveyedAt || '').slice(11) + (x.onTime ? ' · tepat waktu' : ' · lewat batas')),
        Q.map(function (q) { var v = (x.answers || {})[q.id]; return h('div', { class: 'kv' }, h('span', null, q.h), h('b', { class: typeof v === 'number' && v <= cfg.lowScore ? 'err-text' : '' }, v === '' || v == null ? '—' : String(v) + (typeof v === 'number' ? ' · ' + (scale[v - 1] || '') : ''))); }),
        kvRow('Kepuasan keseluruhan', x.overall + '/5'), kvRow('Rekomendasi (NPS)', x.nps + '/10'), kvRow('Komentar', x.comment),
        x.complaintId ? h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () { openComplaints('all', x.complaintId); } }, 'Lihat keluhan ' + x.complaintId)) : null);
      return h('div', null, back, info, res);
    }
    // --- tidak tersambung ---
    var A = W.att;
    var attempt = h('details', { class: 'card', open: !!A.result }, h('summary', null, h('b', null, 'Tidak tersambung / jadwalkan ulang')),
      h('label', { class: 'lbl' }, 'Hasil telepon'),
      h('div', { class: 'chips' }, cfg.attemptResults.map(function (t) { return h('button', { type: 'button', class: 'fchip' + (A.result === t ? ' on' : ''), onclick: function () { A.result = t; render(); } }, t); })),
      A.result && A.result !== 'Customer menolak disurvei' ? [h('label', { class: 'lbl' }, 'Telepon lagi (kosong = hari kerja berikutnya jam 09:00)'),
        h('input', { class: 'inp', type: 'datetime-local', id: 'cc-next', value: A.next, min: nowLocalIso(), onchange: function (e) { A.next = e.target.value; } })] : null,
      h('label', { class: 'lbl' }, 'Catatan (opsional)'), h('input', { class: 'inp', id: 'cc-attnote', value: A.note, oninput: function (e) { A.note = e.target.value; } }),
      h('p', { class: 'hint' }, 'Percobaan ke-' + (x.attempts + 1) + ' dari ' + cfg.maxAttempts + (x.attempts + 1 >= cfg.maxAttempts ? ' — setelah ini status menjadi "Tidak bisa dihubungi".' : '.')),
      h('button', { class: 'btn', disabled: !A.result || !!W.busy, onclick: function () {
        if (!online()) return toast('Butuh koneksi internet', 'warn');
        W.busy = true; render();
        api('formCcAttempt', { token: S.session.token, mhcNo: x.mhcNo, type: x.type, result: A.result, next: A.next, note: A.note.trim(), contact: W.contact !== x.contact ? W.contact : '', phone: W.phone !== x.phone ? W.phone : '', clientId: W.clientId })
          .then(function (r) { W.busy = false; toast('Tercatat · ' + r.status + (r.next ? ' · telepon lagi ' + fmtDate(r.next) + ' ' + r.next.slice(11) : ''), 'ok'); loadCounts(); openCc(); })
          .catch(function (e) { W.busy = false; toast(e.message, 'err'); render(); });
      } }, 'Simpan hasil telepon'));
    // --- kuesioner ---
    var answered = Q.filter(function (q) { return W.ans[q.id] !== undefined; }).length;
    var low = ccLow(W, x.type);
    if (low && !W.kcTouched) W.kc.on = true;
    var qcard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Pertanyaan survei ' + x.type), h('span', { class: 'chip ' + (answered === Q.length ? 'ok' : 'wait') }, answered + '/' + Q.length)),
      h('p', { class: 'hint' }, 'Skala 1–5: ' + scale.map(function (s, i) { return (i + 1) + ' = ' + s; }).join(' · ') + '. N/A = tidak berlaku.'),
      Q.map(function (q) {
        var cur = W.ans[q.id];
        return h('div', { class: 'svq' + (cur === undefined && W.tried ? ' miss' : ''), 'data-missing': cur === undefined && W.tried ? '1' : null },
          h('div', { class: 'svq-t' }, h('b', null, q.id), ' ', q.text),
          scoreBtns(cur, 1, 5, function (v) { W.ans[q.id] = v; render(); }, true),
          typeof cur === 'number' ? h('div', { class: 'small ' + (cur <= cfg.lowScore ? 'err-text' : 'muted') }, scale[cur - 1]) : null);
      }),
      h('div', { class: 'svq' + (W.overall === '' && W.tried ? ' miss' : '') }, h('div', { class: 'svq-t' }, h('b', null, 'Keseluruhan'), ' ', String(cfg.overallText || '').replace('{type}', x.type)),
        scoreBtns(W.overall === '' ? undefined : W.overall, 1, 5, function (v) { W.overall = v; render(); }),
        W.overall !== '' ? h('div', { class: 'small muted' }, scale[W.overall - 1]) : null),
      h('div', { class: 'svq' + (W.nps === '' && W.tried ? ' miss' : '') }, h('div', { class: 'svq-t' }, h('b', null, 'NPS'), ' ', cfg.npsText),
        scoreBtns(W.nps === '' ? undefined : W.nps, 0, 10, function (v) { W.nps = v; render(); }),
        h('div', { class: 'small muted' }, '0 = sangat tidak mungkin · 10 = pasti merekomendasikan')),
      h('label', { class: 'lbl' }, 'Komentar / saran customer'),
      h('textarea', { class: 'inp', id: 'cc-comment', rows: 3, oninput: function (e) { W.comment = e.target.value; } }, W.comment));
    var K = W.kc;
    var kcard = h('div', { class: 'card' + (low ? ' warn-card' : '') },
      low ? h('div', { class: 'banner bad col' }, h('b', null, 'Ada nilai rendah (≤ ' + cfg.lowScore + ' atau keseluruhan ≤ ' + cfg.lowOverall + ').'), h('span', null, 'Disarankan mencatat keluhan supaya ditindaklanjuti cabang. Keputusan tetap di Call Center.')) : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'cc-kc', checked: K.on, onchange: function (e) { K.on = e.target.checked; W.kcTouched = true; render(); } }), h('b', null, 'Catat keluhan customer')),
      K.on ? [h('label', { class: 'lbl' }, 'Jenis keluhan'),
        segmented(cfg.complaintCat, K.category, function (v) { K.category = v; render(); }),
        h('p', { class: 'hint' }, K.category === 'Teknis' ? 'Teknis (kerusakan, hasil perbaikan, mekanik) → email & menu Keluhan ke Service Leader cabang ' + x.branch + '.'
          : 'Non-teknis (harga, pengiriman, administrasi, pelayanan) → ' + (x.pssr ? 'PSSR ' + x.pssr + ', tembusan Admin PS cabang.' : 'Admin PS cabang ' + x.branch + ' (MHC belum ada PSSR).')),
        h('label', { class: 'lbl' }, 'Isi keluhan'),
        h('textarea', { class: 'inp', id: 'cc-kcdesc', rows: 3, placeholder: 'Tulis keluhan customer sejelas mungkin…', oninput: function (e) { K.desc = e.target.value; } }, K.desc)] : null);
    var send = h('div', { class: 'card' }, h('button', { class: 'btn primary block', id: 'cc-submit', disabled: !!W.busy, onclick: function () {
      W.tried = true;
      var miss = Q.filter(function (q) { return W.ans[q.id] === undefined; }).map(function (q) { return q.id; });
      if (W.overall === '') miss.push('Keseluruhan'); if (W.nps === '') miss.push('NPS');
      if (miss.length) { render(); markBad(); return toast('Belum dijawab: ' + miss.join(', '), 'err'); }
      if (K.on && !K.desc.trim()) return toast('Isi keluhan customer, atau hilangkan centang "Catat keluhan"', 'err');
      if (!online()) return toast('Butuh koneksi internet', 'warn');
      W.busy = true; render();
      api('formCcSubmit', { token: S.session.token, mhcNo: x.mhcNo, type: x.type, answers: W.ans, overall: W.overall, nps: W.nps, comment: W.comment.trim(),
        contact: W.contact !== x.contact ? W.contact : '', phone: W.phone !== x.phone ? W.phone : '', clientId: W.clientId,
        complaint: K.on ? { category: K.category, desc: K.desc.trim() } : null }, 60000).then(function (r) {
        W.busy = false;
        toast('Survei tersimpan' + (r.complaintId ? ' · keluhan ' + r.complaintId + ' dikirim' + (r.emailed ? ' (' + r.emailed + ' email)' : '') : ''), 'ok');
        loadCounts(); openCc();
      }).catch(function (e) { W.busy = false; toast(e.message, 'err'); render(); });
    } }, W.busy ? 'Menyimpan…' : 'Simpan hasil survei'));
    return h('div', null, back, h('div', { class: 'detail-grid' }, h('div', { class: 'col-left' }, info, attempt), h('div', { class: 'col-right' }, qcard, kcard, send)));
  }

  /* ---------- Keluhan Customer (SL: Teknis · PSSR / Admin PS: Non-teknis · Call Center: memantau) ---------- */
  function openComplaints(f, focus) {
    var K = S.kc || (S.kc = { filter: 'open', q: '', rows: null, open: {} });
    if (f) K.filter = f; if (focus) { K.open[focus] = true; K.q = focus; }
    go('complaints'); loadComplaints();
  }
  function loadComplaints() {
    var K = S.kc;
    if (!online()) { toast('Butuh koneksi internet', 'warn'); return; }
    K.loading = true; if (S.view === 'complaints') render();
    api('formComplaintList', { token: S.session.token }).then(function (x) {
      K.loading = false; K.rows = x.rows;
      setCounts({ complaintsOpen: x.rows.filter(function (k) { return k.open && (k.canHandle || can('callCenter')); }).length });
      if (S.view === 'complaints') render();
    }).catch(function (e) { K.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'complaints') render(); });
  }
  var KC_TONE = { 'Terbuka': 'bad', 'Diproses': 'wait', 'Selesai': 'ok' };
  function viewComplaints() {
    var K = S.kc, title = 'Keluhan Customer';
    if (K.loading && !K.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center muted' }, 'Memuat keluhan…'));
    if (!K.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center' }, h('button', { class: 'btn', onclick: loadComplaints }, 'Tampilkan')));
    var F = [['mine', 'Perlu tindakan saya'], ['open', 'Belum selesai'], ['Terbuka', 'Terbuka'], ['Diproses', 'Diproses'], ['Selesai', 'Selesai'], ['all', 'Semua']];
    var match = function (k, f) { return f === 'all' ? true : f === 'open' ? k.open : f === 'mine' ? k.open && k.canHandle : k.status === f; };
    var ql = K.q.toLowerCase();
    var rows = K.rows.filter(function (k) { return match(k, K.filter) && (!ql || [k.id, k.customer, k.mhcNo, k.desc, k.assignedTo, k.branch].join(' ').toLowerCase().indexOf(ql) >= 0); });
    var q = h('input', { class: 'inp sm', type: 'search', id: 'kc-search', placeholder: 'Cari customer / No. keluhan / MHC…', value: K.q });
    q.addEventListener('input', debounce(function () { K.q = q.value.trim(); render(); var el = document.getElementById('kc-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    var head = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, title), h('div', { class: 'row-btns' },
        h('button', { class: 'btn small ghost', onclick: loadComplaints, disabled: !!K.loading }, K.loading ? 'Memuat…' : '↻ Muat ulang'),
        h('button', { class: 'btn small', onclick: function () { exportComplaintsXlsx(rows); } }, '⬇ Excel'))),
      h('p', { class: 'hint' }, 'Teknis ditangani Service Leader cabang · Non-teknis ditangani PSSR pemegang MHC (tembusan Admin PS) atau Admin PS bila tanpa PSSR. Isi tindakan sampai status Selesai.'),
      h('div', { class: 'chips filt' }, F.filter(function (f) { return f[0] !== 'mine' || K.rows.some(function (k) { return k.canHandle; }); }).map(function (f) {
        var n = K.rows.filter(function (k) { return match(k, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip' + (K.filter === f[0] ? ' on' : ''), onclick: function () { K.filter = f[0]; render(); } }, f[1], n && f[0] !== 'all' && f[0] !== 'Selesai' ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q));
    var body = !rows.length ? h('div', { class: 'card center muted' }, 'Tidak ada keluhan di filter ini.') : h('div', { class: 'qlist' }, rows.map(function (k) { return kcCard(k); }));
    return h('div', null, head, body);
  }
  function kcCard(k) {
    var K = S.kc, E = K.edit && K.edit.id === k.id ? K.edit : null, isOpen = !!K.open[k.id];
    var toggle = function () { K.open[k.id] = !isOpen; render(); };
    var form = null;
    if (isOpen && k.canHandle && k.open) {
      E = E || (K.edit = { id: k.id, status: k.status === 'Terbuka' ? 'Diproses' : k.status, tindakan: k.action });
      form = h('div', { class: 'kc-form' },
        h('label', { class: 'lbl' }, 'Status'), segmented(['Diproses', 'Selesai'], E.status, function (v) { E.status = v; render(); }),
        h('label', { class: 'lbl' }, 'Tindakan yang dilakukan' + (E.status === 'Selesai' ? ' (wajib)' : '')),
        h('textarea', { class: 'inp', id: 'kc-act-' + k.id, rows: 3, placeholder: 'mis. Kunjungan ulang, seal diganti, unit normal kembali', oninput: function (e) { E.tindakan = e.target.value; } }, E.tindakan || ''),
        h('button', { class: 'btn primary', disabled: !!E.busy, onclick: function () {
          if (E.status === 'Selesai' && !String(E.tindakan || '').trim()) return toast('Isi tindakan sebelum menutup keluhan', 'err');
          if (!online()) return toast('Butuh koneksi internet', 'warn');
          E.busy = true; render();
          api('formComplaintUpdate', { token: S.session.token, id: k.id, status: E.status, tindakan: String(E.tindakan || '').trim(), clientId: uid() }).then(function () {
            K.edit = null; toast('Keluhan ' + k.id + ' · ' + E.status, 'ok'); loadComplaints(); loadCounts();
          }).catch(function (e) { E.busy = false; toast(e.message, 'err'); render(); });
        } }, E.busy ? 'Menyimpan…' : 'Simpan'));
    }
    return h('div', { class: 'card item kcitem' + (k.open && k.canHandle ? ' due' : '') },
      h('button', { type: 'button', class: 'kc-head', onclick: toggle },
        h('div', { class: 'item-top' }, h('b', null, k.customer || '(tanpa customer)'), chip(k.status, KC_TONE[k.status])),
        h('div', { class: 'muted small' }, [k.id, fmtDate(k.date), k.branch, k.category, k.type === 'Call In' ? 'dari Call In' : 'Survei ' + k.type, k.mhcNo].filter(Boolean).join(' · ')),
        h('div', { class: 'kc-desc' }, k.desc),
        h('div', { class: 'small muted' }, 'Ditangani: ' + (k.assignedTo || '—') + (k.cc ? ' · cc ' + k.cc : '') + (k.open ? ' · ' + k.age + ' hari' : '')),
        k.action ? h('div', { class: 'small ok-text' }, 'Tindakan: ' + k.action) : null),
      isOpen ? h('div', { class: 'kc-more' },
        kvRow('Kontak', [k.contact, k.phone].filter(Boolean).join(' · ')), kvRow('Dicatat oleh', k.createdBy),
        k.history ? h('pre', { class: 'log' }, k.history) : null,
        k.phone ? h('div', { class: 'row-btns' }, h('a', { class: 'btn small', href: 'tel:' + telOf(k.phone) }, '☎ Telepon customer'), waOf(k.phone) ? h('a', { class: 'btn small', href: waOf(k.phone), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null) : null,
        form || (k.open && !k.canHandle ? h('p', { class: 'hint' }, 'Hanya dilihat — ditangani oleh ' + (k.category === 'Teknis' ? 'Service Leader cabang' : 'PSSR / Admin PS cabang') + '.') : null)) : null);
  }
  function exportComplaintsXlsx(rows) {
    var out = [['No. Keluhan', 'Tanggal', 'Cabang', 'MHC No', 'Survei', 'Customer', 'Contact', 'Telepon', 'Kategori', 'Keluhan', 'Ditangani', 'CC', 'Status', 'Tindakan', 'Update oleh', 'Update', 'Selesai', 'Dicatat oleh', 'Umur (hari)']];
    rows.forEach(function (k) { out.push([k.id, k.date, k.branch, k.mhcNo, k.type, k.customer, k.contact, k.phone, k.category, k.desc, k.assignedTo, k.cc, k.status, k.action, k.updatedBy, k.updatedAt, k.closedAt, k.createdBy, k.age]); });
    saveBlob(makeXlsx([{ name: 'Keluhan Customer', rows: out, widths: [14, 16, 8, 20, 9, 26, 18, 14, 11, 40, 22, 18, 10, 40, 18, 16, 16, 18, 9] }]), 'Keluhan_Customer_' + S.session.company + '_' + todayISO() + '.xlsx');
    toast('Excel keluhan diunduh', 'ok');
  }

  /* ---------- Rekap survei: CSAT & NPS ---------- */
  function monthRange(off) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); var a = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01'; var e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [a, e.getFullYear() + '-' + pad(e.getMonth() + 1) + '-' + pad(e.getDate())]; }
  function openCcRekap() {
    var R = S.ccr || (S.ccr = { from: monthRange(0)[0], to: todayISO(), type: '', branch: '', data: null });
    go('ccRekap'); loadCcRekap();
  }
  function loadCcRekap() {
    var R = S.ccr;
    if (!online()) { toast('Butuh koneksi internet', 'warn'); return; }
    R.loading = true; if (S.view === 'ccRekap') render();
    api('formCcRekap', { token: S.session.token, from: R.from, to: R.to }, 60000).then(function (x) { R.loading = false; R.data = x; if (S.view === 'ccRekap') render(); })
      .catch(function (e) { R.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'ccRekap') render(); });
  }
  /** agregat satu kelompok survei */
  function ccAgg(list) {
    var a = { total: list.length, done: 0, fail: 0, pending: 0, late: 0, onTime: 0, sat: 0, ov: 0, prom: 0, det: 0, low: 0, kc: 0 };
    list.forEach(function (x) {
      if (x.status === 'Selesai') {
        a.done++; a.ov += Number(x.overall) || 0; if (Number(x.overall) >= 4) a.sat++; if (x.onTime) a.onTime++; if (x.low) a.low++;
        if (Number(x.nps) >= 9) a.prom++; else if (Number(x.nps) <= 6) a.det++;
      } else if (x.status === 'Tidak bisa dihubungi' || x.status === 'Menolak disurvei') a.fail++;
      else { a.pending++; if (x.overdue) a.late++; }
      if (x.complaintId) a.kc++;
    });
    a.csat = a.done ? Math.round(a.sat / a.done * 100) : null;
    a.avg = a.done ? Math.round(a.ov / a.done * 100) / 100 : null;
    a.nps = a.done ? Math.round((a.prom - a.det) / a.done * 100) : null;
    a.reach = a.done + a.fail ? Math.round(a.done / (a.done + a.fail) * 100) : null;
    a.ontimePct = a.done ? Math.round(a.onTime / a.done * 100) : null;
    return a;
  }
  function ccGroup(rows, keyFn) {
    var by = {};
    rows.forEach(function (x) { [].concat(keyFn(x)).forEach(function (k) { k = k || '—'; (by[k] || (by[k] = [])).push(x); }); });
    return Object.keys(by).map(function (k) { var a = ccAgg(by[k]); a.name = k; return a; }).sort(function (a, b) { return (b.done - a.done) || (a.name < b.name ? -1 : 1); });
  }
  function ccRekapData() {
    var R = S.ccr, D = R.data, cfg = (D && D.cfg) || ccCfg();
    var rows = D.rows.filter(function (x) { return (!R.type || x.type === R.type) && (!R.branch || x.branch === R.branch); });
    var all = ccAgg(rows);
    var byBranch = ccGroup(rows, function (x) { return x.branch; });
    var svc = rows.filter(function (x) { return x.type === 'Service'; }), prt = rows.filter(function (x) { return x.type === 'Parts'; });
    var byMek = ccGroup(svc, function (x) { return String(x.mekanik || '').split(/,\s*/).filter(Boolean); });
    var byPssr = ccGroup(prt, function (x) { return x.pssr || '(tanpa PSSR)'; });
    var qs = [];
    ['Service', 'Parts'].forEach(function (t) {
      if (R.type && R.type !== t) return;
      (cfg.questions[t] || []).forEach(function (q) {
        var vals = rows.filter(function (x) { return x.type === t && x.answers; }).map(function (x) { return x.answers[q.id]; }).filter(function (v) { return typeof v === 'number'; });
        var sum = vals.reduce(function (a, v) { return a + v; }, 0), sat = vals.filter(function (v) { return v >= 4; }).length, lo = vals.filter(function (v) { return v <= cfg.lowScore; }).length;
        qs.push({ type: t, id: q.id, h: q.h, n: vals.length, avg: vals.length ? Math.round(sum / vals.length * 100) / 100 : null, sat: vals.length ? Math.round(sat / vals.length * 100) : null, low: lo });
      });
    });
    var K = (D.complaints || []).filter(function (k) { return (!R.branch || k.branch === R.branch) && (!R.type || k.type === R.type); });
    var kOpen = K.filter(function (k) { return k.open; });
    var kBy = {}; K.forEach(function (k) { var x = kBy[k.branch] || (kBy[k.branch] = { open: 0, tek: 0, non: 0 }); if (k.open) { x.open++; if (k.category === 'Teknis') x.tek++; else x.non++; } });
    byBranch.forEach(function (b) { b.kOpen = (kBy[b.name] || {}).open || 0; });
    return { rows: rows, all: all, byBranch: byBranch, byMek: byMek, byPssr: byPssr, qs: qs, kOpen: kOpen, kBy: kBy, cfg: cfg };
  }
  function pctTxt(v) { return v == null ? '—' : v + '%'; }
  function viewCcRekap() {
    var R = S.ccr, D = R.data;
    var back = can('callCenter') ? h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { openCc(); } }, '‹ Kembali ke survei') : null;
    var preset = function (label, rng) { return h('button', { type: 'button', class: 'fchip' + (R.from === rng[0] && R.to === rng[1] ? ' on' : ''), onclick: function () { R.from = rng[0]; R.to = rng[1]; loadCcRekap(); } }, label); };
    var y = new Date().getFullYear();
    var period = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Rekap Survei Kepuasan'), D ? h('button', { class: 'btn small', onclick: exportCcRekapXlsx }, '⬇ Excel') : null),
      h('div', { class: 'chips filt' }, preset('Bulan ini', [monthRange(0)[0], todayISO()]), preset('Bulan lalu', monthRange(-1)), preset('3 bulan', [monthRange(-2)[0], todayISO()]), preset('Tahun ini', [y + '-01-01', todayISO()])),
      h('div', { class: 'search-row' },
        h('input', { class: 'inp sm', type: 'date', id: 'ccr-from', value: R.from, onchange: function (e) { R.from = e.target.value; loadCcRekap(); } }),
        h('input', { class: 'inp sm', type: 'date', id: 'ccr-to', value: R.to, onchange: function (e) { R.to = e.target.value; loadCcRekap(); } }),
        h('select', { class: 'inp sm', id: 'ccr-type', onchange: function (e) { R.type = e.target.value; render(); } }, [['', 'Parts & Service'], ['Parts', 'Parts'], ['Service', 'Service']].map(function (o) { return h('option', { value: o[0], selected: R.type === o[0] }, o[1]); })),
        D && (S.session.user.branch === 'ALL' || S.session.user.branch === 'BJM') ? h('select', { class: 'inp sm', id: 'ccr-branch', onchange: function (e) { R.branch = e.target.value; render(); } },
          h('option', { value: '' }, 'Semua cabang'), (S.boot.branches || []).map(function (b) { return h('option', { value: b, selected: R.branch === b }, b); })) : null),
      h('p', { class: 'hint' }, 'Periode = tanggal invoice. CSAT = % kepuasan keseluruhan 4–5. NPS = % promotor (9–10) − % detraktor (0–6). Kontak berhasil = selesai ÷ (selesai + tidak bisa dihubungi / menolak).'));
    if (R.loading && !D) return h('div', null, back, period, h('div', { class: 'card center muted' }, 'Memuat rekap…'));
    if (!D) return h('div', null, back, period);
    var X = ccRekapData(), A = X.all;
    var kpi = function (label, big, sub, tone) { return h('div', { class: 'kpi ' + (tone || '') }, h('span', { class: 'kpi-l' }, label), h('b', { class: 'kpi-v' }, big), h('span', { class: 'kpi-s' }, sub)); };
    var tone = function (v, lo, hi) { return v == null ? '' : v >= hi ? 'ok' : v < lo ? 'bad' : ''; };
    var kpis = h('div', { class: 'card' }, h('div', { class: 'kpis' },
      kpi('CSAT', pctTxt(A.csat), A.done + ' survei selesai · rata-rata ' + (A.avg == null ? '—' : A.avg), tone(A.csat, 70, 85)),
      kpi('NPS', A.nps == null ? '—' : String(A.nps), 'promotor ' + A.prom + ' · detraktor ' + A.det, tone(A.nps, 0, 30)),
      kpi('Kontak berhasil', pctTxt(A.reach), A.fail + ' tidak terhubung · ' + A.pending + ' belum', tone(A.reach, 70, 90)),
      kpi('Tepat waktu', pctTxt(A.ontimePct), '≤ ' + (X.cfg.dueWorkdays || 2) + ' hari kerja dari invoice' + (A.late ? ' · ' + A.late + ' lewat batas' : ''), tone(A.ontimePct, 80, 95)),
      kpi('Keluhan terbuka', String(X.kOpen.length), X.kOpen.filter(function (k) { return k.category === 'Teknis'; }).length + ' teknis · ' + X.kOpen.filter(function (k) { return k.category !== 'Teknis'; }).length + ' non-teknis', X.kOpen.length ? 'bad' : 'ok')));
    var tbl = function (title, list, first, extra) {
      if (!list.length) return null;
      var cols = [first, 'Survei', 'Selesai', 'CSAT', 'Rata-rata', 'NPS', 'Nilai rendah', 'Keluhan'].concat(extra ? ['Keluhan terbuka'] : []);
      return h('div', { class: 'card' }, h('h2', null, title), h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, cols.map(function (t) { return h('th', null, t); }))),
        h('tbody', null, list.map(function (a) {
          return h('tr', null, h('td', null, h('b', null, a.name)), h('td', { class: 'num' }, a.total), h('td', { class: 'num' }, a.done), h('td', { class: 'num' }, a.csat == null ? '—' : chip(a.csat + '%', tone(a.csat, 70, 85))),
            h('td', { class: 'num' }, a.avg == null ? '—' : a.avg), h('td', { class: 'num' }, a.nps == null ? '—' : a.nps), h('td', { class: 'num' }, a.low || '0'), h('td', { class: 'num' }, a.kc || '0'),
            extra ? h('td', { class: 'num' }, a.kOpen ? h('span', { class: 'chip bad' }, a.kOpen) : '0') : null);
        })))));
    };
    var qt = X.qs.length ? h('div', { class: 'card' }, h('h2', null, 'Per pertanyaan'), h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Pertanyaan', 'Jawaban', 'Rata-rata', '% puas (4–5)', 'Nilai ≤ ' + X.cfg.lowScore].map(function (t) { return h('th', null, t); }))),
      h('tbody', null, X.qs.map(function (q) {
        return h('tr', null, h('td', null, h('b', null, q.h), h('span', { class: 'muted small' }, ' · ' + q.type)), h('td', { class: 'num' }, q.n), h('td', { class: 'num' }, q.avg == null ? '—' : q.avg),
          h('td', { class: 'num' }, q.sat == null ? '—' : chip(q.sat + '%', tone(q.sat, 70, 85))), h('td', { class: 'num' }, q.low ? h('span', { class: 'chip bad' }, q.low) : '0'));
      }))))) : null;
    var comments = X.rows.filter(function (x) { return x.comment; }).slice(0, 30);
    var ct = comments.length ? h('details', { class: 'card' }, h('summary', null, h('b', null, 'Komentar customer (' + comments.length + ')')),
      comments.map(function (x) { return h('div', { class: 'qitem' }, h('div', { class: 'qmain' }, h('b', null, x.customer), h('span', { class: 'muted small' }, ' · ' + x.type + ' · ' + x.branch + ' · puas ' + x.overall + '/5'), h('div', { class: 'small' + (x.low ? ' err-text' : '') }, x.comment))); })) : null;
    return h('div', null, back, period, kpis,
      tbl('Per cabang', X.byBranch, 'Cabang', true),
      R.type !== 'Parts' ? tbl('Per mekanik (survei Service)', X.byMek, 'Mekanik') : null,
      R.type !== 'Service' ? tbl('Per PSSR (survei Parts)', X.byPssr, 'PSSR') : null,
      qt, ct);
  }
  function exportCcRekapXlsx() {
    var R = S.ccr, X = ccRekapData(), pct = function (v) { return v == null ? '' : v / 100; };
    var grp = function (name, list, first) {
      return { name: name, rows: [[first, 'Survei', 'Selesai', 'Tidak terhubung', 'Belum', 'CSAT', 'Rata-rata', 'NPS', 'Kontak berhasil', 'Tepat waktu', 'Nilai rendah', 'Keluhan']]
        .concat(list.map(function (a) { return [a.name, a.total, a.done, a.fail, a.pending, pct(a.csat), a.avg == null ? '' : a.avg, a.nps == null ? '' : a.nps, pct(a.reach), pct(a.ontimePct), a.low, a.kc]; })), widths: [24, 8, 8, 10, 8, 8, 9, 7, 10, 10, 9, 9] };
    };
    var all = X.all; all.name = 'Total';
    var qn = [];
    ['Service', 'Parts'].forEach(function (t) { (X.cfg.questions[t] || []).forEach(function (q) { if (!R.type || R.type === t) qn.push({ t: t, q: q }); }); });
    var det = [['Survey ID', 'Jenis', 'Cabang', 'MHC No', 'Customer', 'Tgl Invoice', 'Mekanik', 'PSSR', 'Status', 'Disurvei'].concat(qn.map(function (x) { return x.q.h; }), ['Keseluruhan', 'NPS', 'Tepat waktu', 'Nilai rendah', 'Keluhan', 'Komentar'])];
    X.rows.forEach(function (x) {
      det.push([x.id, x.type, x.branch, x.mhcNo, x.customer, x.invDate, x.mekanik, x.pssr, x.status, x.surveyedAt].concat(qn.map(function (z) { return z.t === x.type && x.answers ? x.answers[z.q.id] : ''; }),
        [x.overall, x.nps, x.status === 'Selesai' ? (x.onTime ? 'Ya' : 'Tidak') : '', x.low ? 'Ya' : '', x.complaintId, x.comment]));
    });
    var sheets = [grp('Per Cabang', X.byBranch.concat([all]), 'Cabang')];
    if (R.type !== 'Parts') sheets.push(grp('Per Mekanik', X.byMek, 'Mekanik'));
    if (R.type !== 'Service') sheets.push(grp('Per PSSR', X.byPssr, 'PSSR'));
    sheets.push({ name: 'Per Pertanyaan', rows: [['Jenis', 'Pertanyaan', 'Jawaban', 'Rata-rata', '% puas', 'Nilai rendah']].concat(X.qs.map(function (q) { return [q.type, q.h, q.n, q.avg == null ? '' : q.avg, pct(q.sat), q.low]; })), widths: [9, 34, 9, 9, 9, 10] });
    sheets.push({ name: 'Detail Survei', rows: det, widths: [26, 8, 8, 20, 26, 11, 24, 20, 16, 16] });
    saveBlob(makeXlsx(sheets), 'Rekap_Survei_' + S.session.company + '_' + R.from + '_' + R.to + '.xlsx');
    toast('Excel rekap diunduh', 'ok');
  }
  /* ---------- ringkasan survei & keluhan di detail MHC ---------- */
  function ccMhcCard(D) {
    var C = D.cc; if (!C) return null;
    return h('div', { class: 'card' }, h('h2', null, 'Survei kepuasan customer'),
      (C.surveys || []).map(function (s) {
        return h('div', { class: 'qitem' }, h('div', { class: 'qmain' }, h('b', null, 'Survei ' + s.type), ' ', chip(s.status, CC_TONE[s.status]),
          s.status === 'Selesai' ? h('div', { class: 'small' }, 'Puas ' + s.overall + '/5 · NPS ' + s.nps + (s.surveyedAt ? ' · ' + fmtDate(s.surveyedAt) : '')) : s.attempts ? h('div', { class: 'small muted' }, s.attempts + '× telepon') : null,
          s.comment ? h('div', { class: 'small muted' }, '“' + s.comment + '”') : null));
      }),
      (C.complaints || []).map(function (k) {
        return h('div', { class: 'qitem' }, h('div', { class: 'qmain' }, h('b', null, 'Keluhan ' + k.id), ' ', chip(k.status, KC_TONE[k.status]), h('span', { class: 'muted small' }, ' · ' + k.category),
          h('div', { class: 'small' }, k.desc), k.action ? h('div', { class: 'small ok-text' }, 'Tindakan: ' + k.action) : null));
      }),
      can('complaintView') && (C.complaints || []).length ? h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () { openComplaints('all', C.complaints[0].id); } }, 'Buka Keluhan Customer')) : null);
  }

  /* ================= Call Center Tahap 2: Call In ================= */
  function ciCfg() { return (S.boot && S.boot.callIn) || { categories: ['Part', 'Service', 'Unit', 'Keluhan', 'Lainnya'], hints: {}, sources: ['Telepon', 'WhatsApp', 'Email', 'Lainnya'], status: {}, complaintCat: ['Teknis', 'Non-teknis'] }; }
  var CI_ICON = { Part: '⚙', Service: '🔧', Unit: '🚜', Keluhan: '⚠', Lainnya: '…' };
  var CI_TONE = { 'Terbuka': 'bad', 'Diproses': 'wait', 'Selesai': 'ok', 'Perlu diteruskan (WA)': 'bad', 'Diteruskan via WA': 'info', 'Jadi keluhan': 'wait' };
  function fmtDt(s) { return s ? fmtDate(s) + ' ' + String(s).slice(11, 16) : ''; }
  function ciWaText(k) {
    var lines = ['*CALL IN — ' + k.category.toUpperCase() + '*' + (k.urgent ? ' 🔴 URGENT' : '') + (k.id ? ' (' + k.id + ')' : '') + (k.newCust ? ' ⭐ Customer baru' : ''),
      'Tanggal: ' + (k.date ? fmtDt(k.date) : fmtTime(Date.now())), 'Cabang: ' + k.branch, 'Customer: ' + k.customer,
      'Kontak: ' + [k.contact, k.phone].filter(Boolean).join(' · ')];
    if (k.unit || k.sn) lines.push('Unit: ' + [k.unit, k.sn ? 'SN ' + k.sn : ''].filter(Boolean).join(' '));
    if (k.location) lines.push('Lokasi: ' + k.location);
    lines.push('Permintaan: ' + k.request);
    lines.push('Masuk via: ' + (k.source || 'Telepon') + ' · Dicatat: ' + (k.createdBy || S.session.user.name));
    if (k.category === 'Unit') lines.push('', 'Mohon diteruskan ke Branch Manager ' + k.branch + ' untuk follow up.');
    else if (k.category === 'Part' || k.category === 'Service') lines.push('Ditangani: ' + (k.assignedTo || (k.category === 'Part' ? 'Admin PS / PSSR' : 'Service Leader') + ' ' + k.branch), '', 'Mohon diinfokan ke Branch Manager ' + k.branch + '.');
    return lines.join('\n');
  }
  function copyText(t) {
    var done = function () { toast('Pesan disalin — tempel di WA group', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t); done(); });
    fallbackCopy(t); done(); return Promise.resolve();
  }
  function fallbackCopy(t) { var ta = h('textarea', { style: 'position:fixed;top:-1000px' }); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } document.body.removeChild(ta); }
  function waButtons(k) {
    var t = ciWaText(k);
    return h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn small primary', onclick: function () { copyText(t); } }, '⧉ Salin pesan WA'),
      h('a', { class: 'btn small', href: 'https://wa.me/?text=' + encodeURIComponent(t), target: '_blank', rel: 'noopener' }, 'Bagikan ke WhatsApp'));
  }
  function openCallIn(f) {
    var C = S.ci || (S.ci = { filter: can('callCenter') ? 'need' : 'mine', cat: '', branch: '', q: '', rows: null, open: {}, month: todayISO().slice(0, 7) });
    if (f) C.filter = f;
    go('callIn'); loadCallIn();
  }
  function loadCallIn() {
    var C = S.ci;
    if (!online()) { toast('Butuh koneksi internet', 'warn'); return; }
    C.loading = true; if (S.view === 'callIn') render();
    api('formCallInList', { token: S.session.token }, 60000).then(function (x) {
      C.loading = false; C.rows = x.rows; C.customers = x.customers || C.customers || []; if (x.cfg && S.boot) S.boot.callIn = x.cfg;
      if (S.view === 'callInNew') render();
      var st = ciCfg().status || {};
      setCounts(can('callCenter') ? { callInWa: x.rows.filter(function (k) { return k.needWa; }).length } : { callInOpen: x.rows.filter(function (k) { return k.forMe; }).length });
      if (S.view === 'callIn') render();
    }).catch(function (e) { C.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'callIn') render(); });
  }
  function newCallIn(prefill) {
    S.cif = Object.assign({ source: 'Telepon', category: '', branch: S.session.user.branch !== 'ALL' ? S.session.user.branch : '', customer: '', contact: '', phone: '', unit: '', sn: '', location: '',
      request: '', urgent: false, kcCategory: 'Teknis', doneDirect: false, answer: '', clientId: uid(), saved: null }, prefill || {});
    go('callInNew');
    if (!S.ci || !S.ci.customers) { if (!S.ci) S.ci = { filter: 'need', cat: '', branch: '', q: '', rows: null, open: {} }; loadCallIn(); }
  }
  function ciNorm(s) { return String(s || '').toUpperCase().replace(/[.,'"()\-]/g, ' ').replace(/\b(PT|CV|TBK|UD|PD|KOPERASI|KOP)\b/g, ' ').replace(/\s+/g, ' ').trim(); }
  function viewCallInNew() {
    var F = S.cif, cfg = ciCfg(), branches = S.boot.branches || [];
    var back = h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { openCallIn(); } }, '‹ Kembali ke Call In');
    if (F.saved) {
      var k = F.saved;
      return h('div', null, back, h('div', { class: 'card' }, h('h2', null, '✓ Call In ' + k.id + ' tersimpan'),
        k.newCust ? h('div', { class: 'chips' }, chip('⭐ Customer baru', 'ok')) : null,
        h('p', null, k.category === 'Part' || k.category === 'Service' ? 'Diteruskan ke ' + (k.assignedTo || '(belum ada penerima di cabang ' + k.branch + ' — cek tab Users)') + (k.emailed ? ' · ' + k.emailed + ' email terkirim' : '') + '.'
          : k.category === 'Keluhan' ? 'Dibuat sebagai Keluhan Customer ' + k.complaintId + ' → ' + (k.assignedTo || 'cabang ' + k.branch) + '.'
          : k.status === 'Selesai' ? 'Dicatat sebagai sudah dijawab langsung.' : 'Salin pesan di bawah, kirim ke WA group Call Center, lalu tandai sudah diteruskan.',
          k.category === 'Part' || k.category === 'Service' ? ' Infokan juga ke BM cabang: salin pesan di bawah, kirim ke WA group, lalu tandai.' : ''),
        h('pre', { class: 'log wa' }, ciWaText(k)), waButtons(k),
        k.status === 'Perlu diteruskan (WA)' ? h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: function () { ciUpdate(k, 'Diteruskan via WA', '', function () { F.saved.status = 'Diteruskan via WA'; render(); }); } }, '✓ Sudah dikirim ke WA group')) : null,
        k.status === 'Diteruskan via WA' ? h('p', { class: 'ok-text small' }, '✓ Ditandai sudah diteruskan via WA') : null,
        (k.category === 'Part' || k.category === 'Service') ? (k.bmDone ? h('p', { class: 'ok-text small' }, '✓ Sudah diinfokan ke BM ' + k.branch)
          : h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: function () { ciMarkBm(k, function () { F.saved.bmDone = true; render(); }); } }, '✓ Sudah diinfokan ke BM (WA group)'))) : null,
        h('div', { class: 'row-btns' }, h('button', { class: 'btn primary', onclick: function () { newCallIn(); } }, '＋ Catat Call In lain'),
          h('button', { class: 'btn ghost', onclick: function () { openCallIn(); } }, 'Ke daftar Call In'))));
    }
    var set = function (k) { return function (e) { F[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; }; };
    var inp = function (label, k, opts) {
      opts = opts || {};
      var el = opts.textarea ? h('textarea', { class: 'inp', id: 'ci-' + k, rows: 3, placeholder: opts.ph || '', oninput: set(k) }, F[k])
        : h('input', { class: 'inp', id: 'ci-' + k, type: opts.type || 'text', value: F[k], placeholder: opts.ph || '', oninput: set(k), autocomplete: 'off' });
      if (opts.required && F.tried && !String(F[k] || '').trim()) el.setAttribute('data-missing', '1');
      return h('div', { class: 'field' + (opts.half ? ' half' : '') }, h('label', { class: 'lbl', for: 'ci-' + k }, label, opts.required ? h('span', { class: 'req' }, ' *') : null), el);
    };
    // pencarian: Machine Population + riwayat Call In (customer yang pernah menelepon, termasuk customer baru)
    var hist = ((S.ci && S.ci.customers) || []).map(function (c) { return [c[4], '', c[3], c[0], c[5], '', c[2], '', c[6], c[1], 'ci', c[7]]; });
    var pop = hist.concat(S.boot.population || []);
    var pick = picker('Cari dari Machine Population & riwayat Call In (opsional)', pop, function (r) { return [r[3], r[0], r[2], r[4], r[6], r[9]].join(' '); },
      function (r) {
        return r[10] === 'ci' ? [h('div', { class: 'pick-main' }, h('b', null, r[3] || '-'), ' · ', [r[9], r[6]].filter(Boolean).join(' · ')), h('div', { class: 'pick-sub' }, ['☎ Riwayat Call In', r[11] && 'terakhir ' + fmtDate(r[11]), r[2], r[8]].filter(Boolean).join(' · '))]
          : [h('div', { class: 'pick-main' }, h('b', null, r[3] || '-'), ' · ', [r[1], r[2]].filter(Boolean).join(' ')), h('div', { class: 'pick-sub' }, ['SN ' + r[0], r[4], r[8]].filter(Boolean).join(' · '))];
      },
      function (r) {
        F.customer = r[3] || F.customer; F.unit = [r[1], r[2]].filter(Boolean).join(' ') || F.unit; F.sn = r[0] || F.sn; F.location = r[4] || F.location;
        if (r[6]) F.phone = r[10] === 'ci' || !F.phone ? r[6] : F.phone; if (r[9]) F.contact = r[9]; if (r[8] && branches.indexOf(r[8]) >= 0) F.branch = r[8]; render();
      },
      'Ketik nama customer / telepon / SN / model…');
    var known = null, isNewCust = false;
    if (F.customer.trim().length >= 3) {
      known = {}; pop.forEach(function (r) { known[ciNorm(r[3])] = 1; });
      isNewCust = !known[ciNorm(F.customer)];
    }
    var route = F.category === 'Part' ? 'Diteruskan ke Admin PS cabang (email + menu Permintaan Customer), tembusan PSSR cabang.'
      : F.category === 'Service' ? 'Diteruskan ke Service Leader cabang (email + menu Permintaan Customer).'
      : F.category === 'Unit' ? 'Dicatat saja, lalu diteruskan manual ke Branch Manager lewat WA group Call Center (tombol Salin pesan WA).'
      : F.category === 'Keluhan' ? 'Dibuat sebagai Keluhan Customer: Teknis → Service Leader, Non-teknis → Admin PS cabang.'
      : F.category === 'Lainnya' ? 'Pertanyaan umum: jawab langsung, atau teruskan lewat WA group.' : '';
    var form = h('div', { class: 'card' }, h('h2', null, 'Catat Call In'),
      h('label', { class: 'lbl' }, 'Masuk via'), segmented(cfg.sources, F.source, function (v) { F.source = v; }),
      h('label', { class: 'lbl' }, 'Kategori', h('span', { class: 'req' }, ' *')),
      h('div', { class: 'chips ci-cats', 'data-missing': F.tried && !F.category ? '1' : null }, cfg.categories.map(function (c) {
        return h('button', { type: 'button', class: 'fchip big' + (F.category === c ? ' on' : ''), onclick: function () { F.category = c; render(); } }, (CI_ICON[c] || '') + ' ' + c);
      })),
      route ? h('p', { class: 'hint' }, route) : null,
      F.category === 'Keluhan' ? [h('label', { class: 'lbl' }, 'Jenis keluhan'), segmented(cfg.complaintCat, F.kcCategory, function (v) { F.kcCategory = v; })] : null,
      h('label', { class: 'lbl' }, 'Cabang yang menangani', h('span', { class: 'req' }, ' *')),
      h('select', { class: 'inp', id: 'ci-branch', 'data-missing': F.tried && !F.branch ? '1' : null, onchange: function (e) { F.branch = e.target.value; } },
        h('option', { value: '' }, '— pilih cabang —'), branches.map(function (b) { return h('option', { value: b, selected: F.branch === b }, b); })),
      pick,
      isNewCust ? h('div', { class: 'banner ok col' }, h('b', null, '⭐ Customer baru?'), h('span', null, 'Nama ini belum ada di Machine Population maupun riwayat Call In. Isi data selengkap mungkin. Saat disimpan, Call In ditandai "Customer baru" supaya cabang tahu ada prospek baru.')) : null,
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'ci-customer' }, 'Customer', h('span', { class: 'req' }, ' *')),
        h('input', { class: 'inp', id: 'ci-customer', value: F.customer, autocomplete: 'off', 'data-missing': F.tried && !F.customer.trim() ? '1' : null, oninput: function (e) { F.customer = e.target.value; }, onchange: function () { render(); } })), inp('Contact Person', 'contact', { half: true }), inp('Telepon', 'phone', { required: true, type: 'tel', half: true }),
        inp('Unit (brand / model)', 'unit', { half: true }), inp('Serial No', 'sn', { half: true }), inp('Lokasi', 'location')),
      inp('Permintaan / pesan customer', 'request', { textarea: true, required: true, ph: (cfg.hints || {})[F.category] || 'Tulis permintaan customer' }),
      F.category === 'Part' || F.category === 'Service' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'ci-urgent', checked: F.urgent, onchange: set('urgent') }), 'Urgent (unit breakdown / customer menunggu)') : null,
      F.category === 'Lainnya' ? [h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'ci-direct', checked: F.doneDirect, onchange: function (e) { F.doneDirect = e.target.checked; render(); } }), 'Sudah dijawab langsung (tidak perlu diteruskan)'),
        F.doneDirect ? inp('Jawaban yang diberikan', 'answer', { textarea: true }) : null] : null,
      h('button', { class: 'btn primary block', id: 'ci-save', disabled: !!F.busy, onclick: function () {
        F.tried = true;
        var miss = [!F.category && 'Kategori', !F.branch && 'Cabang', !F.customer.trim() && 'Customer', !F.phone.trim() && 'Telepon', !F.request.trim() && 'Permintaan'].filter(Boolean);
        if (miss.length) { render(); markBad(); return toast('Belum diisi: ' + miss.join(', '), 'err'); }
        if (!online()) return toast('Butuh koneksi internet', 'warn');
        F.busy = true; render();
        var vals = { source: F.source, category: F.category, branch: F.branch, customer: F.customer.trim(), contact: F.contact.trim(), phone: F.phone.trim(), unit: F.unit.trim(), sn: F.sn.trim(),
          location: F.location.trim(), request: F.request.trim(), urgent: !!F.urgent && (F.category === 'Part' || F.category === 'Service'), kcCategory: F.kcCategory, doneDirect: F.category === 'Lainnya' && !!F.doneDirect, answer: F.answer.trim() };
        api('formCallInSave', { token: S.session.token, values: vals, clientId: F.clientId }, 60000).then(function (r) {
          F.busy = false;
          F.saved = Object.assign({}, vals, { id: r.id, status: r.status, complaintId: r.complaintId, emailed: r.emailed, assignedTo: r.assignedTo, createdBy: S.session.user.name, date: '', newCust: !!r.newCust });
          if (S.ci && S.ci.customers) S.ci.customers.unshift([vals.customer, vals.contact, vals.phone, vals.unit, vals.sn, vals.location, vals.branch, todayISO()]);
          toast('Call In ' + r.id + ' tersimpan', 'ok'); loadCounts(); render(); window.scrollTo(0, 0);
        }).catch(function (e) { F.busy = false; toast(e.message, 'err'); render(); });
      } }, F.busy ? 'Menyimpan…' : 'Simpan Call In'));
    return h('div', null, back, form);
  }
  function ciMarkBm(k, after) {
    if (!online()) return toast('Butuh koneksi internet', 'warn');
    api('formCallInUpdate', { token: S.session.token, id: k.id, markBm: true, clientId: uid() }).then(function () {
      toast(k.id + ' · sudah diinfokan ke BM', 'ok'); loadCounts(); if (after) after(); else loadCallIn();
    }).catch(function (e) { toast(e.message, 'err'); });
  }
  function ciUpdate(k, status, tindakan, after) {
    if (!online()) return toast('Butuh koneksi internet', 'warn');
    api('formCallInUpdate', { token: S.session.token, id: k.id, status: status, tindakan: tindakan || '', clientId: uid() }).then(function () {
      toast(k.id + ' · ' + status, 'ok'); loadCounts(); if (after) after(); else loadCallIn();
    }).catch(function (e) { toast(e.message, 'err'); render(); });
  }
  var CI_FILTERS = [['need', 'Perlu diteruskan / diinfokan WA', 'cc'], ['mine', 'Untuk saya', 'handler'], ['open', 'Belum selesai'], ['urgent', 'Urgent'], ['done', 'Selesai / diteruskan'], ['all', 'Semua']];
  function ciMatch(k, f) {
    if (f === 'need') return k.needWa;
    if (f === 'mine') return k.forMe;
    if (f === 'open') return k.open;
    if (f === 'urgent') return k.open && k.urgent;
    if (f === 'done') return !k.open;
    return true;
  }
  function viewCallIn() {
    var C = S.ci, isCc = can('callCenter'), title = isCc ? 'Call In' : 'Permintaan Customer';
    var addBtn = isCc ? h('button', { class: 'btn small primary', onclick: function () { newCallIn(); } }, '＋ Catat Call In') : null;
    if (C.loading && !C.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center muted' }, 'Memuat…'));
    if (!C.rows) return h('div', null, h('h2', { class: 'page-t' }, title), h('div', { class: 'card center' }, addBtn, ' ', h('button', { class: 'btn', onclick: loadCallIn }, 'Tampilkan')));
    var base = C.rows.filter(function (k) { return (!C.cat || k.category === C.cat) && (!C.branch || k.branch === C.branch); });
    var ql = C.q.toLowerCase();
    var rows = base.filter(function (k) { return ciMatch(k, C.filter) && (!ql || [k.id, k.customer, k.contact, k.phone, k.request, k.sn, k.unit, k.complaintId].join(' ').toLowerCase().indexOf(ql) >= 0); });
    var filters = CI_FILTERS.filter(function (f) { return !f[2] || (f[2] === 'cc' ? isCc : !isCc); });
    var branches = {}; C.rows.forEach(function (k) { branches[k.branch] = 1; });
    var q = h('input', { class: 'inp sm', type: 'search', id: 'ci-search', placeholder: 'Cari customer / telepon / No. Call In…', value: C.q });
    q.addEventListener('input', debounce(function () { C.q = q.value.trim(); render(); var el = document.getElementById('ci-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    // ringkasan bulan berjalan per kategori
    var month = todayISO().slice(0, 7), mrows = base.filter(function (k) { return k.date.slice(0, 7) === month; });
    var cats = ciCfg().categories;
    var closed = base.filter(function (k) { return k.hours != null && (k.category === 'Part' || k.category === 'Service'); });
    var avgH = closed.length ? Math.round(closed.reduce(function (a, k) { return a + k.hours; }, 0) / closed.length * 10) / 10 : null;
    var kpi = function (label, big, sub, tone, f) {
      return h('button', { type: 'button', class: 'kpi ' + (tone || '') + (f && C.filter === f ? ' on' : ''), onclick: function () { if (f) { C.filter = f; render(); } } },
        h('span', { class: 'kpi-l' }, label), h('b', { class: 'kpi-v' }, big), h('span', { class: 'kpi-s' }, sub));
    };
    var nNeed = base.filter(function (k) { return ciMatch(k, 'need'); }).length, nOpen = base.filter(function (k) { return k.open; }).length, nUrg = base.filter(function (k) { return ciMatch(k, 'urgent'); }).length;
    var nMine = base.filter(function (k) { return k.forMe; }).length;
    var head = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, title), h('div', { class: 'row-btns' }, addBtn,
        h('button', { class: 'btn small ghost', onclick: loadCallIn, disabled: !!C.loading }, C.loading ? 'Memuat…' : '↻'),
        h('button', { class: 'btn small', onclick: function () { exportCallInXlsx(rows); } }, '⬇ Excel'))),
      h('p', { class: 'hint' }, isCc ? 'Part → Admin PS (tembusan PSSR) · Service → Service Leader (tembusan Admin PS) · Part & Service juga diinfokan ke BM lewat WA group · Unit & Lainnya → WA group · Keluhan → Keluhan Customer.'
        : 'Permintaan customer dari Call Center. Part: Admin PS / PSSR hubungi customer & isi tindakan. Service: Service Leader isi tindakan sampai Selesai, Admin PS menerima informasinya.'),
      h('div', { class: 'kpis' },
        isCc ? kpi('Perlu diteruskan WA', String(nNeed), 'Unit / Lainnya belum dikirim · Part / Service belum diinfokan ke BM', nNeed ? 'bad' : 'ok', 'need')
          : kpi('Untuk saya', String(nMine), can('slReview') ? 'Service cabang — isi tindakan' : 'Part (tindak lanjut) · Service (informasi)', nMine ? 'bad' : 'ok', 'mine'),
        kpi('Belum selesai', String(nOpen), 'semua kategori', nOpen ? '' : 'ok', 'open'),
        kpi('Urgent', String(nUrg), 'unit breakdown / customer menunggu', nUrg ? 'bad' : 'ok', 'urgent'),
        kpi('Bulan ini', String(mrows.length), cats.map(function (c) { var n = mrows.filter(function (k) { return k.category === c; }).length; return n ? c + ' ' + n : ''; }).filter(Boolean).join(' · ') || '—', ''),
        kpi('Rata-rata selesai', avgH == null ? '—' : (avgH < 24 ? avgH + ' jam' : Math.round(avgH / 24 * 10) / 10 + ' hari'), 'Part & Service, dari dicatat sampai Selesai', '')),
      h('div', { class: 'chips filt' }, filters.map(function (f) {
        var n = base.filter(function (k) { return ciMatch(k, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip' + (C.filter === f[0] ? ' on' : ''), onclick: function () { C.filter = f[0]; render(); } }, f[1], n && ['all', 'done'].indexOf(f[0]) < 0 ? h('span', { class: 'fn' }, n) : null);
      })),
      h('div', { class: 'search-row' }, q,
        h('select', { class: 'inp sm', id: 'ci-cat', onchange: function (e) { C.cat = e.target.value; render(); } }, h('option', { value: '' }, 'Semua kategori'), cats.map(function (c) { return h('option', { value: c, selected: C.cat === c }, c); })),
        Object.keys(branches).length > 1 ? h('select', { class: 'inp sm', id: 'ci-br', onchange: function (e) { C.branch = e.target.value; render(); } },
          h('option', { value: '' }, 'Semua cabang'), Object.keys(branches).sort().map(function (b) { return h('option', { value: b, selected: C.branch === b }, b); })) : null));
    // rekap per cabang × kategori (Call Center)
    var recap = null;
    if (isCc && base.length) {
      var by = {}; base.forEach(function (k) { var x = by[k.branch] || (by[k.branch] = { open: 0 }); x[k.category] = (x[k.category] || 0) + 1; if (k.open) x.open++; });
      recap = h('details', { class: 'card recap', open: wide() }, h('summary', null, 'Rekap per cabang (' + base.length + ' Call In)'),
        h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Cabang'].concat(cats, ['Total', 'Belum selesai']).map(function (t) { return h('th', null, t); }))),
          h('tbody', null, Object.keys(by).sort().map(function (b) {
            var x = by[b], tot = 0; cats.forEach(function (c) { tot += x[c] || 0; });
            return h('tr', { onclick: function () { C.branch = b; render(); } }, h('td', null, h('b', null, b)), cats.map(function (c) { return h('td', { class: 'num' }, x[c] || 0); }), h('td', { class: 'num' }, h('b', null, tot)),
              h('td', { class: 'num' }, x.open ? h('span', { class: 'chip bad' }, x.open) : '0'));
          })))));
    }
    var body = !rows.length ? h('div', { class: 'card center muted' }, C.filter === 'need' || C.filter === 'mine' ? 'Tidak ada yang perlu ditindaklanjuti. 👍' : 'Tidak ada Call In di filter ini.')
      : h('div', { class: 'qlist' }, rows.map(ciCard));
    return h('div', null, head, recap, body);
  }
  function ciCard(k) {
    var C = S.ci, isOpen = !!C.open[k.id], E = C.edit && C.edit.id === k.id ? C.edit : null;
    var form = null;
    if (isOpen && k.canHandle && k.open && (k.category === 'Part' || k.category === 'Service')) {
      E = E || (C.edit = { id: k.id, status: k.status === 'Terbuka' ? 'Diproses' : k.status, tindakan: k.action });
      form = h('div', { class: 'kc-form' },
        h('label', { class: 'lbl' }, 'Status'), segmented(['Diproses', 'Selesai'], E.status, function (v) { E.status = v; render(); }),
        h('label', { class: 'lbl' }, 'Tindakan' + (E.status === 'Selesai' ? ' (wajib)' : '')),
        h('textarea', { class: 'inp', id: 'ci-act-' + k.id, rows: 3, placeholder: k.category === 'Part' ? 'mis. Quotation dikirim, part ready, dikirim besok' : 'mis. Mekanik dijadwalkan 28 Okt, Call ID 12345', oninput: function (e) { E.tindakan = e.target.value; } }, E.tindakan || ''),
        h('button', { class: 'btn primary', onclick: function () {
          if (E.status === 'Selesai' && !String(E.tindakan || '').trim()) return toast('Isi tindakan sebelum menandai Selesai', 'err');
          ciUpdate(k, E.status, String(E.tindakan || '').trim(), function () { C.edit = null; loadCallIn(); });
        } }, 'Simpan'));
    } else if (isOpen && k.canHandle && (k.category === 'Unit' || k.category === 'Lainnya') && k.status !== 'Selesai') {
      E = E || (C.edit = { id: k.id, tindakan: k.action });
      form = h('div', { class: 'kc-form' },
        k.status === 'Perlu diteruskan (WA)' ? h('button', { class: 'btn', onclick: function () { ciUpdate(k, 'Diteruskan via WA', ''); } }, '✓ Sudah dikirim ke WA group') : h('p', { class: 'small ok-text' }, '✓ Diteruskan via WA' + (k.waBy ? ' oleh ' + k.waBy + ' · ' + fmtDt(k.waAt) : '')),
        h('label', { class: 'lbl' }, 'Hasil / catatan (opsional, untuk menutup)'),
        h('textarea', { class: 'inp', id: 'ci-act-' + k.id, rows: 2, placeholder: 'mis. BM sudah menghubungi customer, penawaran unit dikirim', oninput: function (e) { E.tindakan = e.target.value; } }, E.tindakan || ''),
        h('button', { class: 'btn small ghost', onclick: function () { if (!String(E.tindakan || '').trim()) return toast('Isi hasil / catatan dulu', 'err'); ciUpdate(k, 'Selesai', String(E.tindakan).trim(), function () { C.edit = null; loadCallIn(); }); } }, 'Tandai Selesai'));
    }
    return h('div', { class: 'card item kcitem' + (k.needMe ? ' due' : '') },
      h('button', { type: 'button', class: 'kc-head', onclick: function () { C.open[k.id] = !isOpen; render(); } },
        h('div', { class: 'item-top' }, h('b', null, (CI_ICON[k.category] || '') + ' ' + (k.customer || '-')), chip(k.status === 'Jadi keluhan' && k.kcStatus ? 'Keluhan ' + k.kcStatus : k.status, CI_TONE[k.status === 'Jadi keluhan' && k.kcStatus === 'Selesai' ? 'Selesai' : k.status])),
        h('div', { class: 'muted small' }, [k.id, fmtDt(k.date), k.branch, k.category, k.source].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, k.urgent ? chip('URGENT', 'bad') : null, k.newCust ? chip('⭐ Customer baru', 'ok') : null, k.open ? h('span', { class: 'chip' }, k.age + ' hari') : null, k.complaintId ? h('span', { class: 'chip wait' }, k.complaintId) : null,
          k.infoMe ? chip('Informasi — ditangani SL', 'info') : null,
          can('callCenter') && (k.category === 'Part' || k.category === 'Service') ? chip(k.bmDone ? 'BM ✓ diinfokan' : 'Belum diinfokan ke BM', k.bmDone ? 'ok' : 'bad') : null),
        h('div', { class: 'kc-desc' }, k.request),
        k.assignedTo ? h('div', { class: 'small muted' }, 'Ditangani: ' + k.assignedTo + (k.cc ? ' · cc ' + k.cc : '')) : null,
        k.action || k.kcAction ? h('div', { class: 'small ok-text' }, 'Tindakan: ' + (k.action || k.kcAction)) : null),
      isOpen ? h('div', { class: 'kc-more' },
        kvRow('Kontak', [k.contact, k.phone].filter(Boolean).join(' · ')), kvRow('Unit', [k.unit, k.sn ? 'SN ' + k.sn : ''].filter(Boolean).join(' ')), kvRow('Lokasi', k.location), kvRow('Dicatat oleh', k.createdBy),
        k.history ? h('pre', { class: 'log' }, k.history) : null,
        h('div', { class: 'row-btns' }, k.phone ? h('a', { class: 'btn small', href: 'tel:' + telOf(k.phone) }, '☎ Telepon') : null, waOf(k.phone) ? h('a', { class: 'btn small', href: waOf(k.phone), target: '_blank', rel: 'noopener' }, 'Chat customer') : null,
          can('callCenter') ? h('button', { type: 'button', class: 'btn small', onclick: function () { copyText(ciWaText(k)); } }, '⧉ Salin pesan WA') : null,
          can('callCenter') && (k.category === 'Part' || k.category === 'Service') && !k.bmDone ? h('button', { type: 'button', class: 'btn small primary', onclick: function () { ciMarkBm(k); } }, '✓ Sudah diinfokan ke BM') : null,
          k.complaintId && can('complaintView') ? h('button', { type: 'button', class: 'btn small', onclick: function () { openComplaints('all', k.complaintId); } }, 'Lihat keluhan') : null),
        form || (k.open && !k.canHandle && k.status !== 'Jadi keluhan' ? h('p', { class: 'hint' }, (k.infoMe ? 'Informasi untuk Admin PS (mis. siapkan quotation service). ' : 'Hanya dilihat — ') + 'Ditangani & ditutup oleh ' + (k.category === 'Service' ? 'Service Leader cabang' : k.category === 'Part' ? 'Admin PS / PSSR cabang' : 'Call Center') + '.') : null)) : null);
  }
  function exportCallInXlsx(rows) {
    var out = [['No. Call In', 'Tanggal', 'Masuk via', 'Cabang', 'Kategori', 'Urgent', 'Customer', 'Contact', 'Telepon', 'Unit', 'Serial No', 'Lokasi', 'Permintaan', 'Ditangani', 'CC', 'Status', 'Tindakan', 'No. Keluhan', 'Diteruskan WA', 'Update oleh', 'Update', 'Selesai', 'Waktu selesai (jam)', 'Dicatat oleh', 'Customer baru']];
    rows.forEach(function (k) { out.push([k.id, k.date, k.source, k.branch, k.category, k.urgent ? 'Ya' : '', k.customer, k.contact, k.phone, k.unit, k.sn, k.location, k.request, k.assignedTo, k.cc,
      k.status === 'Jadi keluhan' && k.kcStatus ? 'Keluhan ' + k.kcStatus : k.status, k.action || k.kcAction || '', k.complaintId, k.waAt, k.updatedBy, k.updatedAt, k.closedAt, k.hours == null ? '' : k.hours, k.createdBy, k.newCust ? 'Ya' : '']); });
    saveBlob(makeXlsx([{ name: 'Call In', rows: out, widths: [14, 16, 10, 8, 10, 7, 26, 18, 14, 16, 14, 16, 40, 22, 18, 16, 36, 13, 16, 16, 16, 16, 10, 16] }]), 'Call_In_' + S.session.company + '_' + todayISO() + '.xlsx');
    toast('Excel Call In diunduh', 'ok');
  }

  /* ================= Call Center Tahap 3: Call Out (Livelink Service Reminder & Promotion Program) ================= */
  function coCfg() { return (S.boot && S.boot.callOut) || { pmStatus: ['Mendekati PM', 'Overdue PM'], pmSoonHours: 50, lvResults: [], promoCategories: ['Unit', 'Parts', 'Service', 'Parts & Service'], promoResults: [], promoReasons: [], channels: ['Telepon', 'WhatsApp'], status: {}, maxAttempts: 3 }; }
  var CO_TONE = { 'Perlu ditelepon': 'bad', 'Hubungi lagi': 'wait', 'Selesai': 'ok', 'Tidak bisa dihubungi': 'bad' };
  var BRANCH_NAMES = { BANJARMASIN: 'BJM', SAMARINDA: 'SMD', SAMPIT: 'SPT', PONTIANAK: 'PTK', JAKARTA: 'JKT', SURABAYA: 'SBY', BALIKPAPAN: 'BPP', PALANGKARAYA: 'PKY', 'PALANGKA RAYA': 'PKY', SEMARANG: 'SMG', TAPIN: 'TAPIN', RANTAU: 'TAPIN' };
  /** teks Customers dari Livelink ("Cabang Pontianak,PT Karya …") → { customer, branch } */
  function splitLivelinkCustomer(txt) {
    var br = '', parts = String(txt || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), keep = [];
    parts.forEach(function (p) { var m = p.match(/^cabang\s+(.+)$/i); if (m) { var code = BRANCH_NAMES[m[1].toUpperCase()] || (S.boot.branches || []).filter(function (b) { return b === m[1].toUpperCase(); })[0]; if (code && !br) br = code; } else keep.push(p); });
    return { customer: keep.join(', '), branch: br };
  }
  function coPickRows() {
    var hist = ((S.ci && S.ci.customers) || []).map(function (c) { return [c[4], '', c[3], c[0], c[5], '', c[2], '', c[6], c[1], 'ci', c[7]]; });
    return hist.concat(S.boot.population || []);
  }
  function coCustomerPicker(F, label) {
    var branches = S.boot.branches || [];
    return picker(label || 'Cari customer dari Population & riwayat Call In (opsional)', coPickRows(), function (r) { return [r[3], r[0], r[2], r[6], r[9]].join(' '); },
      function (r) {
        return r[10] === 'ci' ? [h('div', { class: 'pick-main' }, h('b', null, r[3] || '-'), ' · ', [r[9], r[6]].filter(Boolean).join(' · ')), h('div', { class: 'pick-sub' }, ['☎ Riwayat Call In', r[8]].filter(Boolean).join(' · '))]
          : [h('div', { class: 'pick-main' }, h('b', null, r[3] || '-'), ' · ', [r[1], r[2]].filter(Boolean).join(' ')), h('div', { class: 'pick-sub' }, ['SN ' + r[0], r[4], r[8]].filter(Boolean).join(' · '))];
      },
      function (r) {
        F.customer = r[3] || F.customer; if (r[6]) F.phone = r[6]; if (r[9]) F.contact = r[9]; if (r[8] && branches.indexOf(r[8]) >= 0) F.branch = r[8];
        if ('sn' in F && r[10] !== 'ci') { F.sn = r[0] || F.sn; F.model = r[2] || F.model; }
        render();
      }, 'Ketik nama customer / SN / telepon…');
  }
  function coField(F, label, k, opts) {
    opts = opts || {};
    var el = opts.textarea ? h('textarea', { class: 'inp', id: 'co-' + k, rows: 2, placeholder: opts.ph || '', oninput: function (e) { F[k] = e.target.value; } }, F[k] || '')
      : h('input', { class: 'inp', id: 'co-' + k, type: opts.type || 'text', inputmode: opts.num ? 'decimal' : null, value: F[k] == null ? '' : F[k], placeholder: opts.ph || '', autocomplete: 'off',
          oninput: function (e) { F[k] = e.target.value; }, onchange: opts.onchange || null });
    if (opts.required && F.tried && !String(F[k] == null ? '' : F[k]).trim()) el.setAttribute('data-missing', '1');
    return h('div', { class: 'field' + (opts.half ? ' half' : '') }, h('label', { class: 'lbl', for: 'co-' + k }, label, opts.required ? h('span', { class: 'req' }, ' *') : null), el);
  }
  function branchSelect(F, id) {
    return h('select', { class: 'inp', id: id, 'data-missing': F.tried && !F.branch ? '1' : null, onchange: function (e) { F.branch = e.target.value; render(); } },
      h('option', { value: '' }, '— pilih cabang —'), (S.boot.branches || []).map(function (b) { return h('option', { value: b, selected: F.branch === b }, b); }));
  }
  /** isian hasil telepon (dipakai Livelink & Promo) */
  function coResultBlock(F, results, kind) {
    var cfg = coCfg();
    return [h('label', { class: 'lbl' }, 'Hasil telepon', kind === 'lvNew' ? h('span', { class: 'muted' }, ' (kosongkan bila belum menelepon)') : h('span', { class: 'req' }, ' *')),
      h('div', { class: 'chips', 'data-missing': F.tried && !F.result && kind !== 'lvNew' ? '1' : null }, results.map(function (t) {
        return h('button', { type: 'button', class: 'fchip' + (F.result === t ? ' on' : ''), onclick: function () { F.result = F.result === t && kind === 'lvNew' ? '' : t; render(); } }, t);
      })),
      F.result === 'Tidak tertarik' ? [h('label', { class: 'lbl' }, 'Alasan', h('span', { class: 'req' }, ' *')), h('div', { class: 'chips' }, cfg.promoReasons.map(function (t) {
        return h('button', { type: 'button', class: 'fchip' + (F.reason === t ? ' on' : ''), onclick: function () { F.reason = t; render(); } }, t); }))] : null,
      F.result === 'Hubungi lagi' || F.result === 'Tidak bisa dihubungi' ? [h('label', { class: 'lbl' }, 'Telepon lagi (kosong = hari kerja berikutnya 09:00)'),
        h('input', { class: 'inp', type: 'datetime-local', id: 'co-next', value: F.next || '', onchange: function (e) { F.next = e.target.value; } }),
        F.attempts != null ? h('p', { class: 'hint' }, 'Percobaan ke-' + (F.attempts + 1) + ' dari ' + cfg.maxAttempts + (F.result === 'Tidak bisa dihubungi' && F.attempts + 1 >= cfg.maxAttempts ? ' — setelah ini status menjadi "Tidak bisa dihubungi".' : '.')) : null] : null,
      F.result ? coField(F, 'Catatan', 'note', { textarea: true }) : null];
  }

  function openCallOut(tab) {
    var C = S.co || (S.co = { tab: 'lv', lvFilter: 'due', pcFilter: 'due', q: '', open: {}, lv: null, promo: null, showEnded: false });
    if (tab) C.tab = tab;
    go('callOut'); loadCallOut();
    if (!S.ci || !S.ci.customers) { if (!S.ci) S.ci = { filter: 'need', cat: '', branch: '', q: '', rows: null, open: {} }; loadCallIn(); }
  }
  function loadCallOut() {
    var C = S.co;
    if (!online()) { toast('Butuh koneksi internet', 'warn'); return; }
    C.loading = true; if (S.view === 'callOut') render();
    Promise.all([api('formLivelinkList', { token: S.session.token }, 60000), api('formPromoList', { token: S.session.token }, 60000)]).then(function (x) {
      C.loading = false; C.lv = x[0]; C.promo = x[1]; if (S.boot && x[0].cfg) S.boot.callOut = x[0].cfg;
      setCounts({ callOutDue: x[0].rows.filter(function (k) { return k.due; }).length + x[1].calls.filter(function (k) { return k.due; }).length });
      if (S.view === 'callOut' || S.view === 'coForm') render();
    }).catch(function (e) { C.loading = false; if (e.auth) return markExpired(); toast(e.message, 'err'); if (S.view === 'callOut') render(); });
  }
  function viewCallOut() {
    var C = S.co;
    var tabs = h('div', { class: 'seg co-tabs' }, [['lv', '🔧 Livelink Service Reminder'], ['promo', '📣 Promotion Program']].map(function (t) {
      return h('button', { type: 'button', class: 'seg-btn' + (C.tab === t[0] ? ' on' : ''), onclick: function () { C.tab = t[0]; render(); } }, t[1]);
    }));
    var head = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Call Out'), h('button', { class: 'btn small ghost', onclick: loadCallOut, disabled: !!C.loading }, C.loading ? 'Memuat…' : '↻')), tabs);
    if (!C.lv || !C.promo) return h('div', null, head, h('div', { class: 'card center muted' }, C.loading ? 'Memuat…' : h('button', { class: 'btn', onclick: loadCallOut }, 'Tampilkan')));
    return h('div', null, head, C.tab === 'lv' ? viewLivelink() : viewPromo());
  }
  var LV_FILTERS = [['due', 'Perlu ditelepon'], ['open', 'Berjalan'], ['service', 'Jadi Call In Service'], ['done', 'Selesai'], ['all', 'Semua']];
  function lvMatch(k, f) { return f === 'due' ? k.due : f === 'open' ? k.open : f === 'service' ? !!k.callInId : f === 'done' ? !k.open : true; }
  function viewLivelink() {
    var C = S.co, L = C.lv, ql = C.q.toLowerCase(), month = todayISO().slice(0, 7);
    var rows = L.rows.filter(function (k) { return lvMatch(k, C.lvFilter) && (!ql || [k.id, k.customer, k.sn, k.model, k.phone, k.branch].join(' ').toLowerCase().indexOf(ql) >= 0); });
    var m = L.rows.filter(function (k) { return k.date.slice(0, 7) === month; });
    var kpi = function (label, big, sub, tone, f) { return h('button', { type: 'button', class: 'kpi ' + (tone || '') + (C.lvFilter === f ? ' on' : ''), onclick: function () { if (f) { C.lvFilter = f; render(); } } }, h('span', { class: 'kpi-l' }, label), h('b', { class: 'kpi-v' }, big), h('span', { class: 'kpi-s' }, sub)); };
    var nDue = L.rows.filter(function (k) { return k.due; }).length;
    var q = h('input', { class: 'inp sm', type: 'search', id: 'lv-search', placeholder: 'Cari SN / customer / model…', value: C.q });
    q.addEventListener('input', debounce(function () { C.q = q.value.trim(); render(); var el = document.getElementById('lv-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    var top = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Livelink Service Reminder (JCB)'), h('button', { class: 'btn small primary', onclick: function () { newLvReminder(); } }, '＋ Catat Reminder')),
      h('p', { class: 'hint' }, 'Lihat web Livelink JCB: unit 🟡 kuning (≤ ' + coCfg().pmSoonHours + ' jam ke PM Service) dan 🔴 merah (overdue PM). Catat di sini, lalu telepon customer. Kalau customer mau service → otomatis menjadi Call In Service ke SL cabang.'),
      h('div', { class: 'kpis' },
        kpi('Perlu ditelepon', String(nDue), 'reminder baru / jadwal telepon ulang tiba', nDue ? 'bad' : 'ok', 'due'),
        kpi('Berjalan', String(L.rows.filter(function (k) { return k.open; }).length), 'belum ada hasil akhir', '', 'open'),
        kpi('Bulan ini', String(m.length), m.filter(function (k) { return k.pm === 'Overdue PM'; }).length + ' overdue · ' + m.filter(function (k) { return k.pm !== 'Overdue PM'; }).length + ' mendekati PM', ''),
        kpi('Jadi Call In Service', String(m.filter(function (k) { return k.callInId; }).length), 'bulan ini' + (m.length ? ' · ' + Math.round(m.filter(function (k) { return k.callInId; }).length / m.length * 100) + '%' : ''), 'ok', 'service')),
      h('div', { class: 'chips filt' }, LV_FILTERS.map(function (f) { var n = L.rows.filter(function (k) { return lvMatch(k, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip' + (C.lvFilter === f[0] ? ' on' : ''), onclick: function () { C.lvFilter = f[0]; render(); } }, f[1], n && f[0] === 'due' ? h('span', { class: 'fn' }, n) : null); })),
      h('div', { class: 'search-row' }, q, h('button', { class: 'btn small', onclick: function () { exportLivelinkXlsx(rows); } }, '⬇ Excel')));
    var body = !rows.length ? h('div', { class: 'card center muted' }, C.lvFilter === 'due' ? 'Tidak ada reminder yang perlu ditelepon. 👍' : 'Tidak ada data.') : h('div', { class: 'qlist' }, rows.map(lvCard));
    return h('div', null, top, body);
  }
  function lvHistoryList(sn, exceptId) {
    var list = ((S.co.lv && S.co.lv.history) || {})[String(sn || '').trim().toUpperCase()] || [];
    list = list.filter(function (x) { return x.id !== exceptId; });
    if (!list.length) return null;
    return h('div', { class: 'lv-hist' }, h('b', { class: 'small' }, '📋 Unit ini pernah di-reminder ' + list.length + '×'),
      list.map(function (x) { return h('div', { class: 'small muted' }, [fmtDate(x.date), x.pm, 'HM ' + fmtNum(x.hm), x.result, x.callInId, x.by].filter(Boolean).join(' · ')); }));
  }
  function lvCard(k) {
    var C = S.co, isOpen = !!C.open[k.id];
    var F = C.edit && C.edit.id === k.id ? C.edit : null;
    if (isOpen && k.open && !F) F = C.edit = { id: k.id, result: '', note: '', next: '', contact: k.contact, phone: k.phone, attempts: k.attempts, clientId: uid() };
    var form = isOpen && k.open ? h('div', { class: 'kc-form' },
      h('div', { class: 'grid2' }, coField(F, 'Contact Person', 'contact', { half: true }), coField(F, 'Telepon', 'phone', { half: true, type: 'tel', required: true })),
      F.phone ? h('div', { class: 'row-btns' }, h('a', { class: 'btn small primary', href: 'tel:' + telOf(F.phone) }, '☎ Telepon ' + F.phone), waOf(F.phone) ? h('a', { class: 'btn small', href: waOf(F.phone), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null) : null,
      coResultBlock(F, coCfg().lvResults, 'lv'),
      F.result === 'Mau dijadwalkan service' ? h('p', { class: 'hint ok-text' }, '→ Dibuat Call In Service ke Service Leader ' + k.branch + (k.pm === 'Overdue PM' ? ' (URGENT, overdue PM)' : '') + ', tembusan Admin PS. Jangan lupa infokan ke BM lewat WA group.') : null,
      h('button', { class: 'btn primary', disabled: !!F.busy, onclick: function () {
        F.tried = true; if (!F.result) { render(); return toast('Pilih hasil telepon', 'err'); }
        if (!String(F.phone || '').trim()) { render(); return toast('Isi nomor telepon', 'err'); }
        F.busy = true; render();
        api('formLivelinkSave', { token: S.session.token, id: k.id, clientId: F.clientId, values: { result: F.result, note: F.note, next: F.next, contact: F.contact, phone: F.phone } }).then(function (r) {
          C.edit = null; toast(k.id + ' · ' + r.status + (r.callInId ? ' · Call In ' + r.callInId + ' → ' + (r.assignedTo || 'SL cabang') : ''), 'ok'); loadCallOut(); loadCounts();
          if (r.callInId) coCallInDone(r.callInId);
        }).catch(function (e) { F.busy = false; toast(e.message, 'err'); render(); });
      } }, F.busy ? 'Menyimpan…' : 'Simpan hasil telepon')) : null;
    return h('div', { class: 'card item kcitem' + (k.due ? ' due' : '') },
      h('button', { type: 'button', class: 'kc-head', onclick: function () { C.open[k.id] = !isOpen; if (isOpen) C.edit = null; render(); } },
        h('div', { class: 'item-top' }, h('b', null, k.customer || '-'), chip(k.status, CO_TONE[k.status])),
        h('div', { class: 'muted small' }, [k.id, fmtDate(k.date), k.branch].join(' · ')),
        h('div', { class: 'chips' }, chip(k.pm === 'Overdue PM' ? '🔴 Overdue PM' : '🟡 Mendekati PM', k.pm === 'Overdue PM' ? 'bad' : 'wait'), h('span', { class: 'chip' }, k.model + ' · SN ' + k.sn),
          h('span', { class: 'chip' }, 'HM ' + fmtNum(k.hm) + (k.countdown !== '' ? ' · sisa ' + k.countdown + ' jam' : '')),
          k.attempts ? h('span', { class: 'chip' }, k.attempts + '× telepon') : null, k.next && k.open ? h('span', { class: 'chip info' }, 'Telepon lagi ' + fmtDt(k.next)) : null,
          k.callInId ? h('span', { class: 'chip ok' }, '→ ' + k.callInId) : null),
        k.result ? h('div', { class: 'small' }, 'Hasil: ' + k.result + (k.note ? ' · ' + k.note : '')) : null),
      isOpen ? h('div', { class: 'kc-more' }, kvRow('Kontak', [k.contact, k.phone].filter(Boolean).join(' · ')), kvRow('Dicatat oleh', k.createdBy),
        k.history ? h('pre', { class: 'log' }, k.history) : null, lvHistoryList(k.sn, k.id), form,
        k.callInId ? h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () { S.ci = S.ci || { filter: 'all', cat: '', branch: '', q: '', rows: null, open: {} }; S.ci.q = k.callInId; S.ci.open[k.callInId] = true; openCallIn('all'); } }, 'Lihat Call In ' + k.callInId)) : null) : null);
  }
  /** setelah Call Out menghasilkan Call In: ingatkan untuk menginfokan ke BM (Part / Service) */
  function coCallInDone(id) {
    S.coLastCallIn = id;
    setTimeout(function () { if (confirm('Call In ' + id + ' sudah dibuat dan dikirim ke cabang.\n\nBuka sekarang untuk menyalin pesan WA & menandai "Sudah diinfokan ke BM"?')) {
      S.ci = S.ci || { filter: 'all', cat: '', branch: '', q: '', rows: null, open: {} }; S.ci.q = id; S.ci.open[id] = true; openCallIn('all'); } }, 300);
  }
  function newLvReminder() {
    S.cof = { kind: 'lv', date: todayISO(), branch: '', customer: '', sn: '', model: '', hm: '', countdown: '', pm: '', contact: '', phone: '', result: '', note: '', next: '', clientId: uid() };
    go('coForm');
  }
  function viewCoForm() {
    var F = S.cof, cfg = coCfg();
    var back = h('button', { type: 'button', class: 'btn ghost small back', onclick: function () { openCallOut(); } }, '‹ Kembali ke Call Out');
    if (F.kind === 'lv') {
      var pop = S.boot.population || [];
      var snHit = F.sn.trim().length >= 4 ? pop.filter(function (r) { return String(r[0]).toUpperCase() === F.sn.trim().toUpperCase(); })[0] : null;
      var openDup = F.sn.trim() ? ((S.co.lv && S.co.lv.rows) || []).filter(function (k) { return k.open && k.sn.toUpperCase() === F.sn.trim().toUpperCase(); })[0] : null;
      var form = h('div', { class: 'card' }, h('h2', null, 'Catat Livelink Service Reminder'),
        h('div', { class: 'grid2' }, coField(F, 'Tanggal reminder', 'date', { type: 'date', half: true, required: true }),
          h('div', { class: 'field half' }, h('label', { class: 'lbl', for: 'lv-branch' }, 'Cabang', h('span', { class: 'req' }, ' *')), branchSelect(F, 'lv-branch'))),
        coField(F, 'Serial Number unit', 'sn', { required: true, ph: 'mis. 3193439', onchange: function () {
          var hit = (S.boot.population || []).filter(function (r) { return String(r[0]).toUpperCase() === F.sn.trim().toUpperCase(); })[0];
          if (hit) { if (!F.customer) F.customer = hit[3]; if (!F.model) F.model = hit[2]; if (!F.phone && hit[6]) F.phone = hit[6]; if (!F.branch && hit[8]) F.branch = hit[8]; }
          render(); } }),
        snHit ? h('p', { class: 'hint ok-text' }, '✓ SN ditemukan di Machine Population: ' + [snHit[3], snHit[1], snHit[2], snHit[8]].filter(Boolean).join(' · ')) : null,
        openDup ? h('div', { class: 'banner bad col' }, h('b', null, 'SN ini masih punya reminder berjalan (' + openDup.id + ', ' + fmtDate(openDup.date) + ').'), h('span', null, 'Isi hasil telepon di reminder itu saja, tidak perlu dicatat ulang.')) : null,
        F.sn.trim() ? lvHistoryList(F.sn) : null,
        coField(F, 'Nama Customer (tempel dari kolom Customers Livelink juga bisa)', 'customer', { required: true, onchange: function () {
          var x = splitLivelinkCustomer(F.customer); if (x.branch) { F.customer = x.customer; F.branch = x.branch; } render(); } }),
        h('div', { class: 'grid2' }, coField(F, 'Model', 'model', { half: true, required: true, ph: '3DX / 3CX / JS 215…' }), coField(F, 'HM Unit', 'hm', { half: true, num: true, required: true, ph: 'Total machine life hours' }),
          coField(F, 'Sisa jam ke PM', 'countdown', { half: true, num: true, ph: 'Service engine hours countdown' })),
        h('label', { class: 'lbl' }, 'Status di Livelink', h('span', { class: 'req' }, ' *')),
        h('div', { class: 'seg pm-seg', 'data-missing': F.tried && !F.pm ? '1' : null }, cfg.pmStatus.map(function (p) {
          return h('button', { type: 'button', class: 'seg-btn' + (F.pm === p ? ' on ' + (p === 'Overdue PM' ? 'pm-red' : 'pm-yellow') : ''), onclick: function () { F.pm = p; render(); } }, p === 'Overdue PM' ? '🔴 Overdue PM (merah)' : '🟡 Mendekati PM (kuning)');
        })),
        h('div', { class: 'grid2' }, coField(F, 'Contact Person', 'contact', { half: true }), coField(F, 'Telepon', 'phone', { half: true, type: 'tel', required: !!F.result })),
        coCustomerPicker(F, 'Cari kontak dari Population / riwayat Call In (opsional)'),
        coResultBlock(F, cfg.lvResults, 'lvNew'),
        h('button', { class: 'btn primary block', id: 'lv-save', disabled: !!F.busy || !!openDup, onclick: function () {
          F.tried = true;
          var miss = [!F.date && 'Tanggal', !F.branch && 'Cabang', !F.sn.trim() && 'SN', !F.customer.trim() && 'Customer', !F.model.trim() && 'Model', String(F.hm).trim() === '' && 'HM', !F.pm && 'Status PM', F.result && !F.phone.trim() && 'Telepon'].filter(Boolean);
          if (miss.length) { render(); markBad(); return toast('Belum diisi: ' + miss.join(', '), 'err'); }
          F.busy = true; render();
          api('formLivelinkSave', { token: S.session.token, clientId: F.clientId, values: F }).then(function (r) {
            toast('Reminder ' + r.id + ' tersimpan · ' + r.status + (r.callInId ? ' · Call In ' + r.callInId : ''), 'ok'); loadCounts(); S.co.lvFilter = r.status === 'Selesai' ? 'all' : 'open'; openCallOut('lv');
            if (r.callInId) coCallInDone(r.callInId);
          }).catch(function (e) { F.busy = false; toast(e.message, 'err'); render(); });
        } }, F.busy ? 'Menyimpan…' : F.result ? 'Simpan reminder & hasil telepon' : 'Simpan reminder (telepon nanti)'));
      return h('div', null, back, form);
    }
    if (F.kind === 'program') return h('div', null, back, programForm(F));
    return h('div', null, back, promoCallForm(F));
  }

  /* ---------- Promotion Program ---------- */
  function newProgram(p) {
    S.cof = p ? { kind: 'program', id: p.id, name: p.name, category: p.category, start: p.start, end: p.end, branches: p.branches === 'ALL' ? [] : p.branches.split(/,\s*/), benefit: p.benefit, link: p.link }
      : { kind: 'program', name: '', category: '', start: todayISO(), end: '', branches: [], benefit: '', link: '' };
    go('coForm');
  }
  function programForm(F) {
    var cfg = coCfg(), all = S.boot.branches || [];
    return h('div', { class: 'card' }, h('h2', null, F.id ? 'Ubah Promo Program ' + F.id : 'Promo Program baru'),
      h('p', { class: 'hint' }, 'Program dari Dept. Desain & Social Media. Diisi sekali, lalu dipilih saat menelepon customer.'),
      coField(F, 'Nama Promo Program', 'name', { required: true }),
      h('label', { class: 'lbl' }, 'Kategori', h('span', { class: 'req' }, ' *')),
      h('div', { class: 'chips', 'data-missing': F.tried && !F.category ? '1' : null }, cfg.promoCategories.map(function (c) { return h('button', { type: 'button', class: 'fchip big' + (F.category === c ? ' on' : ''), onclick: function () { F.category = c; render(); } }, c); })),
      h('div', { class: 'grid2' }, coField(F, 'Berlaku mulai', 'start', { type: 'date', half: true, required: true }), coField(F, 'Berlaku sampai', 'end', { type: 'date', half: true, required: true })),
      h('label', { class: 'lbl' }, 'Cabang yang berlaku', h('span', { class: 'muted' }, ' (tidak dipilih = semua cabang)')),
      h('div', { class: 'chips' }, all.map(function (b) { var on = F.branches.indexOf(b) >= 0; return h('button', { type: 'button', class: 'fchip' + (on ? ' on' : ''), onclick: function () { if (on) F.branches = F.branches.filter(function (x) { return x !== b; }); else F.branches.push(b); render(); } }, b); })),
      coField(F, 'Isi / benefit promo', 'benefit', { textarea: true, ph: 'mis. Diskon 15% filter kit + gratis jasa ganti oli' }),
      coField(F, 'Link materi / flyer (opsional)', 'link', { ph: 'https://… (Google Drive / Instagram)' }),
      h('button', { class: 'btn primary block', disabled: !!F.busy, onclick: function () {
        F.tried = true;
        var miss = [!F.name.trim() && 'Nama', !F.category && 'Kategori', !F.start && 'Mulai', !F.end && 'Sampai'].filter(Boolean);
        if (miss.length) { render(); markBad(); return toast('Belum diisi: ' + miss.join(', '), 'err'); }
        F.busy = true; render();
        api('formPromoSaveProgram', { token: S.session.token, id: F.id || '', values: F, clientId: uid() }).then(function (r) { toast('Program ' + r.id + ' tersimpan', 'ok'); openCallOut('promo'); })
          .catch(function (e) { F.busy = false; toast(e.message, 'err'); render(); });
      } }, F.busy ? 'Menyimpan…' : 'Simpan Program'));
  }
  function newPromoCall(p, again) {
    S.cof = again ? { kind: 'promoCall', id: again.id, again: again, programId: again.programId, branch: again.branch, customer: again.customer, contact: again.contact, phone: again.phone, channel: again.channel || 'Telepon',
                      result: '', reason: '', interest: '', note: '', next: '', attempts: again.attempts, clientId: uid() }
      : { kind: 'promoCall', programId: p ? p.id : '', branch: '', customer: '', contact: '', phone: '', channel: 'Telepon', result: '', reason: '', interest: '', unit: '', sn: '', note: '', next: '', clientId: uid() };
    go('coForm');
  }
  function promoCallForm(F) {
    var cfg = coCfg(), progs = ((S.co.promo && S.co.promo.programs) || []).filter(function (p) { return p.active || p.id === F.programId; });
    var p = progs.filter(function (x) { return x.id === F.programId; })[0];
    var branchOk = !p || !F.branch || p.branches === 'ALL' || p.branches.split(/,\s*/).indexOf(F.branch) >= 0;
    var known = {}; coPickRows().forEach(function (r) { known[ciNorm(r[3])] = 1; });
    var isNew = !F.again && F.customer.trim().length >= 3 && !known[ciNorm(F.customer)];
    var A = F.again;
    return h('div', { class: 'card' }, h('h2', null, A ? 'Telepon ulang ' + A.id : 'Catat telepon Promo'),
      h('label', { class: 'lbl' }, 'Promo Program', h('span', { class: 'req' }, ' *')),
      A ? h('p', null, h('b', null, A.program)) : h('select', { class: 'inp', id: 'pc-program', 'data-missing': F.tried && !F.programId ? '1' : null, onchange: function (e) { F.programId = e.target.value; render(); } },
        h('option', { value: '' }, progs.length ? '— pilih promo yang berlaku —' : '(belum ada promo yang berlaku — buat dulu di tab Promotion Program)'),
        progs.map(function (x) { return h('option', { value: x.id, selected: x.id === F.programId }, x.name + ' · ' + x.category + ' · s/d ' + fmtDate(x.end)); })),
      p ? h('div', { class: 'promo-box' }, h('div', { class: 'chips' }, chip(p.category, 'info'), h('span', { class: 'chip' }, fmtDate(p.start) + ' – ' + fmtDate(p.end)), h('span', { class: 'chip' }, p.branches === 'ALL' ? 'Semua cabang' : p.branches)),
        p.benefit ? h('div', { class: 'small' }, p.benefit) : null, p.link ? h('a', { class: 'small', href: p.link, target: '_blank', rel: 'noopener' }, '🔗 Buka materi / flyer') : null) : null,
      A ? null : [coCustomerPicker(F),
        isNew ? h('p', { class: 'hint ok-text' }, '⭐ Customer baru — belum ada di Population / riwayat Call In.') : null,
        coField(F, 'Nama Customer', 'customer', { required: true, onchange: function () { render(); } }),
        h('label', { class: 'lbl' }, 'Cabang', h('span', { class: 'req' }, ' *')), branchSelect(F, 'pc-branch'),
        !branchOk ? h('p', { class: 'hint err-text' }, 'Promo ini hanya berlaku di cabang ' + p.branches + '.') : null],
      h('div', { class: 'grid2' }, coField(F, 'Contact Person', 'contact', { half: true }), coField(F, 'Telepon', 'phone', { half: true, type: 'tel', required: true })),
      h('label', { class: 'lbl' }, 'Dihubungi via'), segmented(cfg.channels, F.channel, function (v) { F.channel = v; }),
      F.phone ? h('div', { class: 'row-btns' }, h('a', { class: 'btn small primary', href: 'tel:' + telOf(F.phone) }, '☎ Telepon'),
        waOf(F.phone) ? h('a', { class: 'btn small', href: waOf(F.phone) + (p ? '?text=' + encodeURIComponent('Halo ' + (F.contact || 'Bapak/Ibu') + ', kami dari ' + S.session.company + ' ingin menginformasikan promo "' + p.name + '"' + (p.benefit ? ': ' + p.benefit : '') + ', berlaku sampai ' + fmtDate(p.end) + '.' + (p.link ? ' Info lengkap: ' + p.link : '')) : ''), target: '_blank', rel: 'noopener' }, 'Kirim promo via WA') : null) : null,
      coResultBlock(F, cfg.promoResults, 'pc'),
      F.result === 'Tertarik' && p && p.category === 'Parts & Service' ? [h('label', { class: 'lbl' }, 'Tertarik untuk', h('span', { class: 'req' }, ' *')), segmented(['Part', 'Service'], F.interest, function (v) { F.interest = v; render(); })] : null,
      F.result === 'Tertarik' && p ? [h('p', { class: 'hint ok-text' }, '→ Otomatis menjadi Call In ' + (p.category === 'Parts' ? 'Part' : p.category === 'Parts & Service' ? (F.interest || 'Part / Service') : p.category) + ' ke cabang ' + (F.branch || '') + ', mengikuti alur Call In (email, notifikasi, info BM).'),
        A ? null : h('div', { class: 'grid2' }, coField(F, 'Unit (opsional)', 'unit', { half: true }), coField(F, 'Serial No (opsional)', 'sn', { half: true }))] : null,
      h('button', { class: 'btn primary block', id: 'pc-save', disabled: !!F.busy || !branchOk, onclick: function () {
        F.tried = true;
        var miss = [!F.programId && 'Promo', !A && !F.customer.trim() && 'Customer', !A && !F.branch && 'Cabang', !F.phone.trim() && 'Telepon', !F.result && 'Hasil telepon',
          F.result === 'Tidak tertarik' && !F.reason && 'Alasan', F.result === 'Tertarik' && p && p.category === 'Parts & Service' && !F.interest && 'Tertarik untuk'].filter(Boolean);
        if (miss.length) { render(); markBad(); return toast('Belum diisi: ' + miss.join(', '), 'err'); }
        F.busy = true; render();
        api('formPromoCall', { token: S.session.token, id: A ? A.id : '', clientId: F.clientId, values: F }, 60000).then(function (r) {
          toast(r.id + ' · ' + r.status + (r.callInId ? ' · Call In ' + r.callInId + ' → ' + (r.assignedTo || 'cabang') : ''), 'ok'); loadCounts(); openCallOut('promo');
          if (r.callInId && r.callInStatus !== 'Perlu diteruskan (WA)') coCallInDone(r.callInId);
          else if (r.callInId) coCallInDone(r.callInId);
        }).catch(function (e) { F.busy = false; toast(e.message, 'err'); render(); });
      } }, F.busy ? 'Menyimpan…' : 'Simpan hasil telepon'));
  }
  var PC_FILTERS = [['due', 'Perlu ditelepon ulang'], ['Tertarik', 'Tertarik'], ['Tidak tertarik', 'Tidak tertarik'], ['fail', 'Tidak bisa dihubungi'], ['all', 'Semua']];
  function pcMatch(k, f) { return f === 'due' ? k.due : f === 'fail' ? k.status === 'Tidak bisa dihubungi' : f === 'all' ? true : k.result === f && !k.open; }
  function promoAgg(calls) {
    var a = { n: calls.length, yes: 0, no: 0, fail: 0, again: 0, reasons: {} };
    calls.forEach(function (k) { if (k.result === 'Tertarik') a.yes++; else if (k.result === 'Tidak tertarik') { a.no++; a.reasons[k.reason] = (a.reasons[k.reason] || 0) + 1; } else if (k.status === 'Tidak bisa dihubungi') a.fail++; else if (k.open) a.again++; });
    a.reached = a.yes + a.no; a.rate = a.reached ? Math.round(a.yes / a.reached * 100) : null;
    return a;
  }
  function viewPromo() {
    var C = S.co, P = C.promo, ql = C.q.toLowerCase();
    var progs = P.programs.filter(function (p) { return C.showEnded || p.active || p.upcoming; });
    var calls = P.calls.filter(function (k) { return (!C.prog || k.programId === C.prog) && pcMatch(k, C.pcFilter) && (!ql || [k.id, k.customer, k.phone, k.program, k.branch].join(' ').toLowerCase().indexOf(ql) >= 0); });
    var progCard = function (p) {
      var a = promoAgg(P.calls.filter(function (k) { return k.programId === p.id; }));
      return h('div', { class: 'card item promo-card' + (C.prog === p.id ? ' on' : '') },
        h('div', { class: 'item-top' }, h('b', null, p.name), chip(p.active ? 'Berlaku' : p.upcoming ? 'Akan datang' : 'Berakhir', p.active ? 'ok' : p.upcoming ? 'info' : '')),
        h('div', { class: 'chips' }, chip(p.category, 'info'), h('span', { class: 'chip' }, fmtDate(p.start) + ' – ' + fmtDate(p.end)), h('span', { class: 'chip' }, p.branches === 'ALL' ? 'Semua cabang' : p.branches)),
        p.benefit ? h('div', { class: 'small' }, p.benefit) : null,
        h('div', { class: 'small muted' }, a.n + ' dihubungi · ' + a.yes + ' tertarik' + (a.rate != null ? ' (' + a.rate + '%)' : '') + ' · ' + a.no + ' tidak tertarik' + (a.again ? ' · ' + a.again + ' hubungi lagi' : '')),
        h('div', { class: 'row-btns' }, p.active ? h('button', { class: 'btn small primary', onclick: function () { newPromoCall(p); } }, '☎ Catat telepon') : null,
          h('button', { class: 'btn small', onclick: function () { C.prog = C.prog === p.id ? '' : p.id; C.pcFilter = 'all'; render(); } }, C.prog === p.id ? 'Semua program' : 'Lihat telepon'),
          p.link ? h('a', { class: 'btn small', href: p.link, target: '_blank', rel: 'noopener' }, '🔗 Materi') : null,
          h('button', { class: 'btn small ghost', onclick: function () { newProgram(p); } }, 'Ubah')));
    };
    var nEnded = P.programs.length - P.programs.filter(function (p) { return p.active || p.upcoming; }).length;
    var top = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Promotion Program'), h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: function () { newProgram(); } }, '＋ Program baru'),
        h('button', { class: 'btn small primary', onclick: function () { newPromoCall(); } }, '☎ Catat telepon promo'))),
      h('p', { class: 'hint' }, 'Program dari Dept. Desain & Social Media. Setelah promo di-share ke customer, catat hasil teleponnya. Customer Tertarik → otomatis menjadi Call In ke cabang.'),
      nEnded ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!C.showEnded, onchange: function (e) { C.showEnded = e.target.checked; render(); } }), 'Tampilkan program yang sudah berakhir (' + nEnded + ')') : null);
    var plist = progs.length ? h('div', { class: 'qlist' }, progs.map(progCard)) : h('div', { class: 'card center muted' }, 'Belum ada promo program yang berlaku. Klik "＋ Program baru".');
    // rekap per program
    var recap = P.programs.length ? h('details', { class: 'card recap', open: wide() }, h('summary', null, 'Rekap per program'),
      h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Program', 'Kategori', 'Periode', 'Dihubungi', 'Tertarik', '% tertarik', 'Tidak tertarik', 'Alasan', 'Tidak terhubung', 'Hubungi lagi'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, P.programs.map(function (p) {
          var a = promoAgg(P.calls.filter(function (k) { return k.programId === p.id; }));
          return h('tr', null, h('td', null, h('b', null, p.name)), h('td', null, p.category), h('td', { class: 'small' }, fmtDate(p.start) + ' – ' + fmtDate(p.end)), h('td', { class: 'num' }, a.n), h('td', { class: 'num' }, a.yes),
            h('td', { class: 'num' }, a.rate == null ? '—' : a.rate + '%'), h('td', { class: 'num' }, a.no), h('td', { class: 'small' }, Object.keys(a.reasons).map(function (r) { return r + ' ' + a.reasons[r]; }).join(', ') || '—'),
            h('td', { class: 'num' }, a.fail), h('td', { class: 'num' }, a.again));
        }))))) : null;
    var q = h('input', { class: 'inp sm', type: 'search', id: 'pc-search', placeholder: 'Cari customer / telepon / program…', value: C.q });
    q.addEventListener('input', debounce(function () { C.q = q.value.trim(); render(); var el = document.getElementById('pc-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300));
    var base = P.calls.filter(function (k) { return !C.prog || k.programId === C.prog; });
    var callHead = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Telepon promo' + (C.prog ? ' · ' + ((P.programs.filter(function (p) { return p.id === C.prog; })[0] || {}).name || '') : '')),
        h('button', { class: 'btn small', onclick: function () { exportPromoXlsx(); } }, '⬇ Excel')),
      h('div', { class: 'chips filt' }, PC_FILTERS.map(function (f) { var n = base.filter(function (k) { return pcMatch(k, f[0]); }).length;
        return h('button', { type: 'button', class: 'fchip' + (C.pcFilter === f[0] ? ' on' : ''), onclick: function () { C.pcFilter = f[0]; render(); } }, f[1], n && f[0] === 'due' ? h('span', { class: 'fn' }, n) : n && f[0] !== 'all' ? h('span', { class: 'fn muted-n' }, n) : null); })),
      h('div', { class: 'search-row' }, q));
    var clist = !calls.length ? h('div', { class: 'card center muted' }, C.pcFilter === 'due' ? 'Tidak ada yang perlu ditelepon ulang. 👍' : 'Tidak ada data.') : h('div', { class: 'qlist' }, calls.map(function (k) {
      return h('div', { class: 'card item' + (k.due ? ' due' : '') },
        h('div', { class: 'item-top' }, h('b', null, k.customer), chip(k.open ? 'Hubungi lagi' : k.status === 'Tidak bisa dihubungi' ? k.status : k.result, k.result === 'Tertarik' ? 'ok' : k.open ? 'wait' : k.result === 'Tidak tertarik' ? '' : 'bad')),
        h('div', { class: 'muted small' }, [k.id, fmtDt(k.date), k.branch, k.program, k.channel].filter(Boolean).join(' · ')),
        h('div', { class: 'chips' }, k.newCust ? chip('⭐ Customer baru', 'ok') : null, k.reason ? h('span', { class: 'chip' }, 'Alasan: ' + k.reason) : null, k.attempts ? h('span', { class: 'chip' }, k.attempts + '× telepon') : null,
          k.next && k.open ? h('span', { class: 'chip info' }, 'Telepon lagi ' + fmtDt(k.next)) : null, k.callInId ? h('span', { class: 'chip ok' }, '→ ' + k.callInId + (k.interest ? ' (' + k.interest + ')' : '')) : null),
        k.note ? h('div', { class: 'small' }, k.note) : null,
        h('div', { class: 'row-btns' }, k.phone ? h('a', { class: 'btn small', href: 'tel:' + telOf(k.phone) }, '☎ ' + k.phone) : null,
          k.open ? h('button', { class: 'btn small primary', onclick: function () { newPromoCall(null, k); } }, 'Isi hasil telepon ulang') : null,
          k.callInId ? h('button', { class: 'btn small', onclick: function () { S.ci = S.ci || { filter: 'all', cat: '', branch: '', q: '', rows: null, open: {} }; S.ci.q = k.callInId; S.ci.open[k.callInId] = true; openCallIn('all'); } }, 'Lihat Call In') : null));
    }));
    return h('div', null, top, plist, recap, callHead, clist);
  }
  function exportLivelinkXlsx(rows) {
    var out = [['No. Reminder', 'Tanggal', 'Cabang', 'Customer', 'Contact', 'Telepon', 'Serial No', 'Model', 'HM', 'Sisa jam ke PM', 'Status PM', 'Status', 'Hasil', 'Catatan', 'Jumlah telepon', 'Telepon lagi', 'Call In', 'Dicatat oleh']];
    rows.forEach(function (k) { out.push([k.id, k.date, k.branch, k.customer, k.contact, k.phone, k.sn, k.model, k.hm, k.countdown, k.pm, k.status, k.result, k.note, k.attempts, k.next, k.callInId, k.createdBy]); });
    saveBlob(makeXlsx([{ name: 'Livelink Reminder', rows: out, widths: [14, 11, 8, 28, 18, 14, 12, 10, 9, 10, 13, 16, 26, 30, 9, 16, 13, 18] }]), 'Livelink_Reminder_' + S.session.company + '_' + todayISO() + '.xlsx');
    toast('Excel Livelink diunduh', 'ok');
  }
  function exportPromoXlsx() {
    var P = S.co.promo, rec = [['Program', 'Kategori', 'Mulai', 'Sampai', 'Cabang', 'Benefit', 'Dihubungi', 'Tertarik', '% tertarik', 'Tidak tertarik', 'Alasan', 'Tidak terhubung', 'Hubungi lagi']];
    P.programs.forEach(function (p) { var a = promoAgg(P.calls.filter(function (k) { return k.programId === p.id; }));
      rec.push([p.name, p.category, p.start, p.end, p.branches, p.benefit, a.n, a.yes, a.rate == null ? '' : a.rate / 100, a.no, Object.keys(a.reasons).map(function (r) { return r + ' ' + a.reasons[r]; }).join(', '), a.fail, a.again]); });
    var det = [['No.', 'Tanggal', 'Program', 'Kategori', 'Cabang', 'Customer', 'Customer baru', 'Contact', 'Telepon', 'Via', 'Status', 'Hasil', 'Alasan', 'Catatan', 'Jumlah telepon', 'Tertarik untuk', 'Call In', 'Dicatat oleh']];
    P.calls.forEach(function (k) { det.push([k.id, k.date, k.program, k.category, k.branch, k.customer, k.newCust ? 'Ya' : '', k.contact, k.phone, k.channel, k.status, k.result, k.reason, k.note, k.attempts, k.interest, k.callInId, k.createdBy]); });
    saveBlob(makeXlsx([{ name: 'Rekap Promo', rows: rec, widths: [30, 14, 11, 11, 14, 36, 10, 9, 10, 12, 30, 12, 11] }, { name: 'Telepon Promo', rows: det, widths: [14, 16, 28, 14, 8, 28, 10, 18, 14, 10, 18, 14, 18, 30, 10, 10, 13, 18] }]),
      'Promo_Call_Out_' + S.session.company + '_' + todayISO() + '.xlsx');
    toast('Excel promo diunduh', 'ok');
  }

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
          var n = ((x.photoSlots || []).length * 2) + sigSlotsOf(x).length, up = Object.keys(x.uploaded || {}).length;
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
            x.notified ? h('div', { class: 'small muted' }, 'Email notifikasi JDS terkirim ke ' + x.notified + ' penerima') : null,
            x.kind === 'mhc' && x.marPrefill && can('marInput') ? h('button', { class: 'btn small', style: 'margin-top:6px', onclick: function () { openMar(Object.assign({ MHC_NO: x.mhcNo }, x.marPrefill)); } }, '◷ Buat MAR dari MHC ini') : null));
        })),
      S.boot ? h('p', { class: 'hint' }, 'Data unit & Call ID diperbarui ' + fmtTime(S.boot.fetchedAt) + ' · tekan ↻ untuk memperbarui.') : null);
  }

  /* ================= start ================= */
  window.addEventListener('online', function () { renderStatus(); syncQueue(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { syncQueue(); if (Date.now() - lastPoll > 20000) pollCounts(true); } });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.openFilter && S.session) { var f = e.data.openFilter; if (f === 'myfudue') openQuotes('due'); else if (f === 'cc') openCc('call'); else if (f === 'complaints') openComplaints(can('callCenter') ? 'open' : 'mine'); else if (f === 'callIn') openCallIn(); else if (f === 'callOut') openCallOut(); else openList(f); } });
  var lastWide = wide();
  window.addEventListener('resize', debounce(function () { if (wide() !== lastWide) { lastWide = wide(); if (S.view !== 'mhc') render(); } }, 200));
  setInterval(syncQueue, 60000);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; renderHeader(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadCtrl = !!navigator.serviceWorker.controller, reloaded = false;
    // versi baru aktif → muat ulang sekali supaya langsung memakai file terbaru
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!hadCtrl || reloaded) return; reloaded = true; location.reload(); });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update().catch(function () { }); });
    }).catch(function () { });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  loadQueue().catch(function () { }).then(function () { render(); if (S.session && !S.session.expired) refreshBoot(false).then(syncQueue); });
})();
