/* LaborPro Cloud: browser-safe Supabase Auth + owner-scoped snapshot sync.
   The publishable key is public by design; RLS is the security boundary. */
(function () {
  'use strict';
  const SUPABASE_URL = 'https://fjulqqnsbtiemrrgscxp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kN8cLf-UhJA4DSd5hVFYdQ_yHzBVH9W';
  const COLLECTIONS_EXCLUDED = new Set(['users']);
  const VERSION = new Map();
  const TIMERS = new Map();
  const DIRTY = new Set();
  const CONFLICTS = new Map();
  let client = null;
  let user = null;
  let channel = null;
  let suppressLocalWrite = false;
  let cloudLoginReady = false;
  let syncEnabled = false;
  let appInitialized = false;
  let remoteDataSeen = false;
  let freshInstall = false;

  function status(message, isError = false) {
    const el = document.getElementById('lp-cloud-status');
    if (el) {
      el.textContent = message;
      el.style.color = isError ? 'var(--error)' : 'var(--text2)';
    }
    const badge = document.getElementById('lp-cloud-badge');
    if (badge) {
      badge.textContent = 'Cloud: ' + message;
      badge.style.color = isError ? 'var(--error)' : 'var(--success)';
      badge.title = message;
    }
  }

  function loadSanitizer() {
    return new Promise((resolve, reject) => {
      if (window.DOMPurify) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/dompurify@3.4.15/dist/purify.min.js';
      script.onload = () => window.DOMPurify ? resolve() : reject(new Error('HTML sanitizer did not initialize.'));
      script.onerror = () => reject(new Error('Could not load the HTML security component.'));
      document.head.appendChild(script);
    });
  }

  function installHtmlProtection() {
    const templates = new Map();
    let sanitizing = false;
    document.querySelectorAll('script:not([src])').forEach(script => {
      const re = /\bon(click|change|input|keydown|keyup|submit)\s*=\s*"([^"]*)"/gi;
      let match;
      while ((match = re.exec(script.textContent || ''))) {
        const name = match[1].toLowerCase();
        const pieces = match[2].split(/(\$\{[^}]*\})/g).map(piece => {
          if (/^\$\{/.test(piece)) return '[A-Za-z0-9 _.-]{0,80}';
          return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        if (!templates.has(name)) templates.set(name, []);
        templates.get(name).push(new RegExp('^' + pieces.join('') + '$'));
      }
    });
    const attrs = [...templates.keys()].map(name => 'on' + name);
    window.DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      const name = data.attrName.toLowerCase();
      if (name.startsWith('on')) {
        const rules = templates.get(name.slice(2));
        if (!rules || !rules.some(rule => rule.test(data.attrValue))) data.keepAttr = false;
      }
      if (name === 'style' && /url\s*\(|expression\s*\(|behavior\s*:|@import/i.test(data.attrValue)) data.keepAttr = false;
    });
    const proto = Element.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
    if (!descriptor?.set || !descriptor?.get) throw new Error('Safe HTML rendering is unavailable in this browser.');
    Object.defineProperty(proto, 'innerHTML', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        if (sanitizing) return descriptor.set.call(this, value);
        sanitizing = true;
        let clean;
        try { clean = window.DOMPurify.sanitize(String(value), { ADD_ATTR: attrs, RETURN_TRUSTED_TYPE: false }); }
        finally { sanitizing = false; }
        return descriptor.set.call(this, clean);
      }
    });
    const originalToast = N.show.bind(N);
    N.show = function (message, type = 's') {
      const container = document.getElementById('TC');
      if (!container) return originalToast(message, type);
      const icon = { s: 'fa-check-circle', e: 'fa-exclamation-circle', i: 'fa-info-circle', w: 'fa-exclamation-triangle' };
      const toast = document.createElement('div'); toast.className = 'toast ' + ({s:'t-s',e:'t-e',i:'t-i',w:'t-w'}[type] || 't-s');
      const i = document.createElement('i'); i.className = 'fas ' + (icon[type] || icon.s);
      const span = document.createElement('span'); span.textContent = String(message ?? '');
      toast.append(i, span); container.append(toast);
      setTimeout(() => { toast.classList.add('rm'); setTimeout(() => toast.remove(), 300); }, 3500);
    };
  }

  function ensureUI() {
    const login = document.getElementById('LS');
    if (!login || document.getElementById('lp-cloud-panel')) return;
    const box = document.createElement('section');
    box.id = 'lp-cloud-panel';
    box.className = 'card';
    box.style.cssText = 'position:relative;z-index:2;width:min(420px,92vw);margin:16px auto;padding:18px';
    box.innerHTML = '<h2 class="font-bold mb-2">LaborPro Cloud</h2><p class="text-xs mb-3" style="color:var(--text2)">Sign in with the private account created for this LaborPro project.</p><label class="lbl" for="lp-cloud-email">Email</label><input class="inp mb-2" id="lp-cloud-email" type="email" autocomplete="username"><label class="lbl" for="lp-cloud-password">Password</label><input class="inp mb-3" id="lp-cloud-password" type="password" autocomplete="current-password"><div class="flex gap-2"><button class="btn btn-p" type="button" id="lp-cloud-signin">Sign In</button></div><p id="lp-cloud-status" class="text-xs mt-3" role="status">Connecting to LaborPro Cloud…</p>';
    login.prepend(box);
    const topbar = document.querySelector('.topbar');
    if (topbar && !document.getElementById('lp-cloud-badge')) {
      const badge = document.createElement('span');
      badge.id = 'lp-cloud-badge'; badge.className = 'text-xs';
      badge.style.cssText = 'max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      topbar.append(badge);
      const upload = document.createElement('button');
      upload.id = 'lp-cloud-upload'; upload.className = 'btn btn-s'; upload.type = 'button';
      upload.textContent = 'Upload device data'; upload.style.display = 'none'; upload.onclick = uploadThisDevice;
      topbar.append(upload);
    }
    document.getElementById('lp-cloud-signin').addEventListener('click', signIn);
  }

  function emailAndPassword() {
    return {
      email: document.getElementById('lp-cloud-email')?.value.trim() || '',
      password: document.getElementById('lp-cloud-password')?.value || ''
    };
  }

  async function signIn() {
    const { email, password } = emailAndPassword();
    if (!email || !password) return status('Enter the cloud account email and password.', true);
    status('Signing in…');
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) status(error.message, true);
  }

  function openAuthenticatedApp() {
    if (!user || appInitialized) return;
    cloudLoginReady = true;
    A.cu = { id: user.id, username: user.email || 'owner', name: user.email || 'Owner', role: 'Admin', permissions: ['all'] };
    AU.u = A.cu.username;
    A.check = function () { return !!user && !!cloudLoginReady; };
    A.login = function () { return false; };
    freshInstall = localStorage.getItem('lp_ok') !== '1';
    appInitialized = true;
    APP.init();
    D.s('users', []);
    localStorage.removeItem('lp_s');
    if (freshInstall) {
      ['labors','services','items','wageRates','workEntries','overtime','payments','cashReceived','cashPaid','expenses','expCats','attendance','salaries','loans','audit'].forEach(key => D.s(key, []));
      const settings = D.go('settings');
      D.so('settings', { ...settings, companyName: '', address: '', phone: '', email: '', openingBal: 0 });
      APP.go('dashboard');
    }
    document.querySelectorAll('#LS input, #LS button[onclick="APP.login()"], #LS .card').forEach(el => { if (!el.closest('#lp-cloud-panel')) el.hidden = true; });
    document.getElementById('LS').style.display = 'none';
    document.getElementById('AS').style.display = 'block';
    APP.showApp();
    APP.go = (function (go) { return function (page) { if (page === 'userMgmt') { status('Separate staff accounts are not enabled in this owner-only build.', true); return; } return go.call(this, page); }; })(APP.go);
    startSync();
  }

  function secureLoginScreen() {
    cloudLoginReady = false;
    syncEnabled = false;
    remoteDataSeen = false;
    const app = document.getElementById('AS');
    const login = document.getElementById('LS');
    if (app) app.style.display = 'none';
    if (login) {
      login.style.display = 'flex';
      // Keep the local-only username/password form hidden while signed out.
      for (const child of login.children) {
        if (child.id !== 'lp-cloud-panel') child.hidden = true;
      }
    }
    if (typeof A !== 'undefined' && A.cu) A.logout();
    status('Sign in to LaborPro Cloud before opening the local app.');
  }

  function localCollections() {
    return Object.keys(localStorage)
      .filter(key => key.startsWith('lp_') && !['lp_ok', 'lp_s'].includes(key))
      .map(key => key.slice(3))
      .filter(name => !COLLECTIONS_EXCLUDED.has(name));
  }

  function setLocalSnapshot(collection, value) {
    suppressLocalWrite = true;
    try { localStorage.setItem('lp_' + collection, JSON.stringify(value)); }
    finally { suppressLocalWrite = false; }
  }

  async function pushSnapshot(collection) {
    if (!client || !user || !syncEnabled || suppressLocalWrite || COLLECTIONS_EXCLUDED.has(collection)) return;
    let value;
    try { value = JSON.parse(localStorage.getItem('lp_' + collection) || 'null'); }
    catch { return status('Local data for ' + collection + ' is invalid; it was not synced.', true); }
    if (value === null || typeof value !== 'object') return;
    if (CONFLICTS.has(collection)) return;
    if (new Blob([JSON.stringify(value)]).size > 3900000) return status('This collection is too large to sync safely.', true);
    const expected = VERSION.get(collection) || 0;
    const { data, error } = await client.rpc('write_app_record', {
      p_collection: collection, p_record_id: 'snapshot', p_expected_version: expected, p_payload: { value }
    });
    if (error) {
      if (error.code === '40001') { CONFLICTS.set(collection, true); return showConflict(collection); }
      return status('Cloud sync failed: ' + error.message, true);
    }
    VERSION.set(collection, Number(data)); DIRTY.delete(collection);
  }

  function schedulePush(collection) {
    if (!user || !syncEnabled || suppressLocalWrite || COLLECTIONS_EXCLUDED.has(collection)) return;
    DIRTY.add(collection);
    clearTimeout(TIMERS.get(collection));
    TIMERS.set(collection, setTimeout(() => pushSnapshot(collection), 250));
  }

  function installRealtime() {
    if (channel) client.removeChannel(channel);
    return new Promise(resolve => {
      channel = client.channel('laborpro-owner-' + user.id)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'app_records',
        filter: 'owner_id=eq.' + user.id
      }, payload => {
        const row = payload.new;
        if (!row || row.record_id !== 'snapshot' || COLLECTIONS_EXCLUDED.has(row.collection)) return;
        remoteDataSeen = true;
        syncEnabled = true;
        const collection = row.collection;
        clearTimeout(TIMERS.get(collection));
        const remote = JSON.stringify(row.payload?.value);
        const local = localStorage.getItem('lp_' + collection);
        VERSION.set(collection, Number(row.version) || 1);
        if (DIRTY.has(collection) && local !== remote) { CONFLICTS.set(collection, true); showConflict(collection); return; }
        if (DIRTY.has(collection) && local === remote) DIRTY.delete(collection);
        setLocalSnapshot(collection, row.payload?.value);
        if (typeof APP !== 'undefined' && APP.pg) APP.go(APP.pg);
      }).subscribe(state => {
        if (state === 'SUBSCRIBED') resolve(true);
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') resolve(false);
      });
    });
  }

  function showConflict(collection) {
    status('Changes to ' + collection + ' differ between devices. Choose which copy to keep.', true);
    if (document.getElementById('lp-conflict-' + collection)) return;
    const box = document.createElement('div'); box.id = 'lp-conflict-' + collection;
    box.className = 'card'; box.style.cssText = 'position:fixed;z-index:120;bottom:16px;left:16px;max-width:420px';
    const title = document.createElement('strong'); title.textContent = 'Sync conflict: ' + collection;
    const help = document.createElement('p'); help.className = 'text-xs'; help.textContent = 'Load the cloud copy or explicitly replace it with this device’s copy.';
    const load = document.createElement('button'); load.className = 'btn btn-s'; load.textContent = 'Load cloud copy';
    const replace = document.createElement('button'); replace.className = 'btn btn-d'; replace.textContent = 'Replace cloud copy';
    load.onclick = async () => { const {data,error}=await client.from('app_records').select('payload,version').eq('owner_id',user.id).eq('collection',collection).eq('record_id','snapshot').maybeSingle(); if(error||!data)return status('Could not load cloud copy.',true); VERSION.set(collection,Number(data.version));setLocalSnapshot(collection,data.payload.value);DIRTY.delete(collection);CONFLICTS.delete(collection);box.remove();status('Cloud copy loaded.');if(APP.pg)APP.go(APP.pg); };
    replace.onclick = async () => { if(!confirm('Replace the cloud copy of '+collection+' with the copy on this device?'))return; const {data,error}=await client.from('app_records').select('version').eq('owner_id',user.id).eq('collection',collection).eq('record_id','snapshot').maybeSingle(); if(error)return status(error.message,true);VERSION.set(collection,Number(data?.version)||0);CONFLICTS.delete(collection);box.remove();await pushSnapshot(collection); };
    box.append(title,help,load,replace); document.body.append(box);
  }

  async function loadCloudSnapshots() {
    const { data, error } = await client.from('app_records')
      .select('collection,record_id,payload,version')
      .eq('owner_id', user.id);
    if (error) throw error;
    const rows = (data || []).filter(row => row.record_id === 'snapshot' && !COLLECTIONS_EXCLUDED.has(row.collection));
    rows.forEach(row => {
      VERSION.set(row.collection, Number(row.version) || 1);
      const local = localStorage.getItem('lp_' + row.collection);
      const remote = JSON.stringify(row.payload?.value);
      if (!freshInstall && local !== null && local !== remote) {
        CONFLICTS.set(row.collection, true);
        showConflict(row.collection);
        return;
      }
      setLocalSnapshot(row.collection, row.payload?.value);
    });
    if (typeof APP !== 'undefined' && APP.pg && typeof A !== 'undefined' && A.cu) APP.go(APP.pg);
    return rows.length;
  }

  async function uploadThisDevice() {
    const ok = window.confirm('Upload this browser’s LaborPro business records (labor, attendance, wages, payments, settings and related data) to your new LaborPro Supabase project? They will be scoped to this signed-in cloud account.');
    if (!ok) return;
    syncEnabled = true;
    status('Uploading this device’s records…');
    for (const collection of localCollections()) await pushSnapshot(collection);
    status('This device’s records are in LaborPro Cloud. Realtime sync is active.');
    const button = document.getElementById('lp-cloud-upload');
    if (button) button.style.display = 'none';
  }

  async function startSync() {
    const realtimeReady = await installRealtime();
    try {
      const cloudCount = await loadCloudSnapshots();
      if (cloudCount === 0 && !remoteDataSeen) {
        syncEnabled = false;
        status('Cloud is empty. Choose Upload this device to start syncing its records.');
        const button = document.getElementById('lp-cloud-upload');
        if (button) button.style.display = 'inline-flex';
      } else {
        syncEnabled = true;
        const button = document.getElementById('lp-cloud-upload');
        if (button) button.style.display = 'none';
        status(realtimeReady ? 'Cloud records loaded. Realtime sync is active for this account.' : 'Cloud records loaded; realtime is reconnecting.');
      }
    } catch (error) {
      status('Could not load cloud records: ' + (error.message || 'unknown error'), true);
    }
  }

  function watchAuth() {
    client.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      cloudLoginReady = !!user;
      if (!user) return secureLoginScreen();
      if (user) openAuthenticatedApp();
      else secureLoginScreen();
    });
  }

  function protectAppLogin() {
    // The dashboard is a physical cash balance; non-cash payment methods belong
    // in their own ledgers and must not change this figure.
    if (typeof U !== 'undefined') {
      const cashTotal = rows => rows.reduce((sum, row) =>
        sum + (String(row.method || '').trim().toLowerCase() === 'cash' ? Number(row.am) || 0 : 0), 0);
      U.cashBal = function () {
        const opening = Number(D.go('settings').openingBal) || 0;
        return opening + cashTotal(D.g('cashReceived')) - cashTotal(D.g('cashPaid'))
          - cashTotal(D.g('payments')) - cashTotal(D.g('expenses'));
      };
    }
    APP.login = function () { if (!cloudLoginReady || !user) return status('Sign in to LaborPro Cloud first.', true); openAuthenticatedApp(); };
    const originalAuthLogout = A.logout.bind(A);
    const originalUserLogin = A.login.bind(A);
    A.login = function (username, password) {
      const result = originalUserLogin(username, password);
      if (result === true) {
        const session = JSON.parse(localStorage.getItem('lp_s') || 'null');
        const minutes = Number(D.go('adminConfig').sessionTimeout) || 60;
        if (session) localStorage.setItem('lp_s', JSON.stringify({ ...session, exp: Date.now() + minutes * 60 * 1000 }));
      }
      return result;
    };
    const originalCheck = A.check.bind(A);
    A.check = function () {
      let session = null;
      try { session = JSON.parse(localStorage.getItem('lp_s') || 'null'); } catch {}
      if (session && (!Number.isFinite(session.exp) || Date.now() >= session.exp)) {
        localStorage.removeItem('lp_s'); this.cu = null; return false;
      }
      return originalCheck();
    };
    window.doRestore = function () {
      const file = document.getElementById('restoreFile')?.files?.[0];
      if (!file) return N.e('Select a backup file');
      if (file.size > 10 * 1024 * 1024) return N.e('Backup file exceeds the 10 MB limit');
      const arrays = new Set(['labors','services','items','wageRates','workEntries','overtime','payments','cashReceived','cashPaid','expenses','expCats','attendance','salaries','loans','audit']);
      const objects = new Set(['settings','adminConfig']);
      cfm('Restore validated business data? Existing data will be replaced. User accounts and passwords will be kept unchanged.', () => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Backup root must be an object');
            const keys = Object.keys(data);
            if (!keys.length || keys.some(key => !arrays.has(key) && !objects.has(key) && key !== 'users')) throw new Error('Backup contains unknown data collections');
            for (const key of arrays) if (Object.hasOwn(data, key) && (!Array.isArray(data[key]) || data[key].length > 100000 || data[key].some(row => !row || typeof row !== 'object' || Array.isArray(row)))) throw new Error('Invalid records in ' + key);
            for (const key of objects) if (Object.hasOwn(data, key) && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) throw new Error('Invalid settings in ' + key);
            for (const key of arrays) if (Object.hasOwn(data, key)) D.s(key, data[key]);
            for (const key of objects) if (Object.hasOwn(data, key)) D.so(key, data[key]);
            N.s('Validated business data restored; local users were preserved');
            AU.log('Restore', 'Validated business data restored'); APP.go('dashboard');
          } catch (error) { N.e('Backup rejected: ' + error.message); }
        };
        reader.onerror = () => N.e('Could not read the backup file');
        reader.readAsText(file);
      });
    };
    U.csv = function (filename, headers, rows) {
      const safe = value => {
        const text = String(value ?? '');
        return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" + text : text;
      };
      const csv = [headers, ...rows].map(row => row.map(value => '"' + safe(value).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    A.logout = function () {
      originalAuthLogout();
      if (channel) client.removeChannel(channel);
      channel = null; user = null; cloudLoginReady = false;
      syncEnabled = false;
      remoteDataSeen = false;
      appInitialized = false;
      client.auth.signOut();
      secureLoginScreen();
    };
    const originalStore = D.s.bind(D);
    D.s = function (key, data) {
      originalStore(key, data);
      schedulePush(key);
    };
    const originalObjectStore = D.so.bind(D);
    D.so = function (key, data) {
      originalObjectStore(key, data);
      schedulePush(key);
    };
    window.addEventListener('online', () => localCollections().forEach(schedulePush));
  }

  function loadClient() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the Supabase browser client.'));
      document.head.appendChild(script);
    });
  }

  async function init() {
    try {
      await loadClient();
      await loadSanitizer();
      installHtmlProtection();
      ensureUI();
      protectAppLogin();
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      watchAuth();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      user = data.session?.user || null;
      if (!user) localStorage.removeItem('lp_s');
      if (user) openAuthenticatedApp();
      else secureLoginScreen();
    } catch (error) {
      localStorage.removeItem('lp_s');
      secureLoginScreen();
      status('Cloud connection unavailable: ' + (error.message || 'unknown error'), true);
    }
  }

  window.LaborProCloud = { init, signIn };
  window.addEventListener('load', init, { once: true });
})();
