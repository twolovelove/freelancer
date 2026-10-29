'use strict';

/* ───────── Supabase 동기화 ─────────
 * 기록·할 일·휴식·분류를 항목 단위로 저장해서, 여러 기기에서 쓴 기록을 덮어쓰지 않고 합침.
 * 마지막으로 동기화한 상태(snap)와 비교해 이 기기에서 바뀐 항목만 올리고,
 * 서버에서 바뀐 항목은 이 기기에서 안 건드린 경우에만 내려받음 (같은 항목을 양쪽에서 고치면 이 기기 우선).
 */
const SYNC_KEY = 'worklog.sync';
const TABLE = 'worklog_items';

window.Sync = (() => {
  const cfg = window.WORKLOG_CONFIG || {};
  const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;
  let user = null, busy = false, again = false, timer = null;
  let status = 'off', lastError = '', lastSyncedAt = null, pendingRender = false;
  let meta = loadMeta();

  function loadMeta() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
  function saveMeta() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch (e) { /* 무시 */ } }

  // 키 순서와 상관없이 같은 내용이면 같은 문자열 (jsonb는 키 순서를 바꿔 저장함)
  const stable = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}`;
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + s.length.toString(36); };
  const hashOf = v => hash(stable(v));

  function toItems(s) {
    const m = {};
    s.categories.forEach((c, i) => { m['category:' + c.id] = { ...c, order: i }; });
    s.running.forEach((r, i) => { m['running:' + r.id] = { ...r, order: i }; });
    for (const r of s.records) m['record:' + r.id] = r;
    for (const b of s.breaks) m['break:' + b.start] = b;
    m['meta:onBreak'] = { v: s.onBreak };
    m['meta:corePrefs'] = s.corePrefs;
    return m;
  }
  function fromItems(m) {
    const s = { version: 1, categories: [], running: [], records: [], breaks: [], onBreak: null, corePrefs: null };
    for (const [key, v] of Object.entries(m)) {
      const kind = key.slice(0, key.indexOf(':'));
      if (kind === 'category') s.categories.push({ ...v });
      else if (kind === 'running') s.running.push({ ...v });
      else if (kind === 'record') s.records.push(v);
      else if (kind === 'break') s.breaks.push(v);
      else if (key === 'meta:onBreak') s.onBreak = v.v ?? null;
      else if (key === 'meta:corePrefs') s.corePrefs = v;
    }
    const byOrder = (a, b) => a.order - b.order;
    s.categories.sort(byOrder).forEach(c => delete c.order);
    s.running.sort(byOrder).forEach(r => delete r.order);
    s.records.sort((a, b) => a.end - b.end);
    s.breaks.sort((a, b) => a.start - b.start);
    return migrate(s);
  }

  async function pullRows(since) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(TABLE).select('kind,id,data,deleted,updated_at').order('updated_at').range(from, from + 999);
      if (since) q = q.gt('updated_at', since);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  async function sync() {
    if (!sb || !user) return;
    if (busy) { again = true; return; }
    busy = true;
    setStatus('syncing');
    try {
      if (meta.userId !== user.id) meta = { userId: user.id, snap: {}, lastPull: null };
      const snap = meta.snap;
      const local = toItems(state);
      const localHash = {};
      for (const k in local) localHash[k] = hashOf(local[k]);

      // 1) 내려받기 (시계 오차 대비 5초 겹쳐서)
      const since = meta.lastPull ? new Date(Date.parse(meta.lastPull) - 5000).toISOString() : null;
      const rows = await pullRows(since);
      const applied = [];
      let maxPull = meta.lastPull;
      for (const r of rows) {
        const k = r.kind + ':' + r.id;
        if (!maxPull || r.updated_at > maxPull) maxPull = r.updated_at;
        if (localHash[k] !== snap[k]) continue; // 이 기기에서 바꾼 항목은 이 기기 우선
        if (r.deleted || r.data == null) {
          if (k in local) applied.push([k, null]);
          delete local[k]; delete localHash[k]; delete snap[k];
        } else {
          const h = hashOf(r.data);
          if (localHash[k] !== h) applied.push([k, r.data]);
          local[k] = r.data; localHash[k] = snap[k] = h;
        }
      }

      // 2) 올리기: 마지막 동기화 이후 이 기기에서 바뀐 항목
      const ups = [];
      for (const k of new Set([...Object.keys(localHash), ...Object.keys(snap)])) {
        if (localHash[k] === snap[k]) continue;
        const i = k.indexOf(':');
        ups.push({ user_id: user.id, kind: k.slice(0, i), id: k.slice(i + 1), data: local[k] ?? null, deleted: !(k in local) });
      }
      for (let i = 0; i < ups.length; i += 500) {
        const { error } = await sb.from(TABLE).upsert(ups.slice(i, i + 500), { onConflict: 'user_id,kind,id' });
        if (error) throw error;
      }
      for (const u of ups) {
        const k = u.kind + ':' + u.id;
        if (u.deleted) delete snap[k]; else snap[k] = localHash[k];
      }

      // 3) 받은 변경을 지금 상태에 반영 (동기화하는 동안 입력한 내용은 유지)
      if (applied.length) {
        const cur = toItems(state);
        for (const [k, v] of applied) { if (v === null) delete cur[k]; else cur[k] = v; }
        state = fromItems(cur);
        if (!state.categories.some(c => c.id === ui.selCat)) ui.selCat = state.categories[0]?.id;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
        rerender();
      }

      meta.lastPull = maxPull;
      saveMeta();
      lastSyncedAt = Date.now();
      lastError = '';
      setStatus('ok');
    } catch (e) {
      lastError = e?.message || String(e);
      setStatus('error');
    } finally {
      busy = false;
      if (again) { again = false; sync(); }
    }
  }

  // 입력 중이면 화면을 다시 그리지 않고, 입력이 끝나면 그림
  function rerender() {
    const a = document.activeElement;
    if ((a && a.matches('input, textarea, select')) || document.querySelector('#editDlg[open]')) { pendingRender = true; return; }
    renderAll();
  }
  document.addEventListener('focusout', () => setTimeout(() => {
    if (pendingRender && !document.activeElement?.matches('input, textarea, select') && !document.querySelector('#editDlg[open]')) {
      pendingRender = false;
      renderAll();
    }
  }, 0));

  function schedule() {
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(sync, 1500);
  }

  function setStatus(s) { status = s; render(); }

  function render() {
    const dot = $('#syncDot');
    dot.hidden = !user;
    dot.className = 'sync-dot ' + status;
    dot.title = { ok: '동기화됨', syncing: '동기화 중', error: '동기화 오류', off: '' }[status] || '';

    let hint, actions;
    if (!sb) {
      hint = 'config.js에 Supabase 주소와 키를 넣으면 맥북·휴대폰 기록을 합칠 수 있어요.';
      actions = '';
    } else if (!user) {
      hint = 'Google 계정으로 로그인하면 맥북·휴대폰 기록이 자동으로 합쳐져요. 이 기기에 있는 기록도 함께 올라가요.';
      actions = `<button class="btn primary" data-sync="login"><span class="g">G</span> Google로 로그인</button>`;
    } else {
      const when = lastSyncedAt ? `마지막 동기화 ${fmtTime(lastSyncedAt)}` : '동기화 준비 중';
      hint = `<b>${esc(user.email)}</b> 계정으로 동기화 중이에요.<br>${status === 'error' ? `<span class="err">동기화 오류: ${esc(lastError)}</span>` : status === 'syncing' ? '동기화하는 중…' : when}`;
      actions = `<button class="btn" data-sync="now">지금 동기화</button><button class="btn ghost" data-sync="logout">로그아웃</button>`;
    }
    $('#syncHint').innerHTML = hint;
    $('#syncActions').innerHTML = actions;
  }

  async function signIn() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) toast('로그인 실패: ' + error.message);
  }
  async function signOut() {
    if (!confirm('로그아웃할까요? 이 기기의 기록은 그대로 남아요.')) return;
    await sb.auth.signOut();
    meta = {};
    saveMeta();
  }

  $('#syncCard').addEventListener('click', e => {
    const b = e.target.closest('[data-sync]');
    if (!b) return;
    ({ login: signIn, now: sync, logout: signOut })[b.dataset.sync]();
  });

  async function init() {
    render();
    if (!sb) return;
    sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user || null;
      const switched = u?.id !== user?.id;
      user = u;
      if (!user) status = 'off';
      render();
      if (user && switched) {
        if (event === 'SIGNED_IN' && location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search);
        sync();
      }
    });
    setInterval(() => { if (user && !document.hidden) sync(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    window.addEventListener('online', sync);
  }

  init();
  return { schedule, sync };
})();
