'use strict';

/* ───────── 기본값 & 유틸 ───────── */
const STORE_KEY = 'worklog.v1';
const MAX_CATS = 8;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const DEFAULT_CATS = [
  ['제작', true], ['디자인·기획', true], ['포장·발송', false], ['서류·세무', false],
  ['고객응대', false], ['재료 구매', false], ['마케팅·SNS', false], ['기타', false],
];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}
function fmtDur(ms) {
  if (ms > 0 && ms < 60000) return '1분 미만';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}
const fmtTime = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = t => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
const toLocalInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* ───────── 저장소 ───────── */
function defaultState() {
  return {
    version: 1,
    categories: DEFAULT_CATS.map(([name, core], i) => ({ id: 'c' + i, name, slot: i, goal: 0, core })),
    running: [],
    records: [],
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.categories) && Array.isArray(s.records) && Array.isArray(s.running)) return s;
  } catch (e) { /* 손상된 데이터면 새로 시작 */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('저장에 실패했어요. 백업을 먼저 해두세요!'); }
}

let state = load();
const ui = { tab: 'now', selCat: state.categories[0]?.id, period: 'week', anchor: new Date(), editing: null };

const catById = id => state.categories.find(c => c.id === id) || { id, name: '(삭제된 분류)', slot: 7, goal: 0, core: false };
const catColor = id => `var(--c${catById(id).slot})`;
const segDur = (segs, upTo = Date.now()) => segs.reduce((a, s) => a + ((s.end ?? upTo) - s.start), 0);
const isLive = r => r.segments.at(-1).end == null;

/* ───────── 작업 동작 ───────── */
function startTask(catId, title) {
  const cat = catById(catId);
  state.running.unshift({ id: uid(), catId, title: title?.trim() || cat.name, memo: '', segments: [{ start: Date.now(), end: null }] });
  save();
  renderNow();
  toast(`${cat.name} 시작!`);
}
function togglePause(id) {
  const r = state.running.find(x => x.id === id);
  if (!r) return;
  if (isLive(r)) r.segments.at(-1).end = Date.now();
  else r.segments.push({ start: Date.now(), end: null });
  save();
  renderNow();
}
function finishTask(id) {
  const i = state.running.findIndex(x => x.id === id);
  if (i < 0) return;
  const r = state.running[i];
  if (isLive(r)) r.segments.at(-1).end = Date.now();
  const rec = { id: r.id, catId: r.catId, title: r.title, memo: r.memo, segments: r.segments, start: r.segments[0].start, end: r.segments.at(-1).end };
  state.running.splice(i, 1);
  state.records.push(rec);
  save();
  renderNow();
  toast(`${rec.title} · ${fmtDur(segDur(rec.segments))} 기록했어요`);
}
function cancelTask(id) {
  if (!confirm('이 작업을 기록하지 않고 취소할까요?')) return;
  state.running = state.running.filter(x => x.id !== id);
  save();
  renderNow();
}

/* ───────── 집계 ───────── */
function allIntervals() {
  const t = Date.now(), out = [];
  for (const r of state.records) for (const s of r.segments) out.push({ cat: r.catId, start: s.start, end: s.end, rec: r });
  for (const r of state.running) for (const s of r.segments) out.push({ cat: r.catId, start: s.start, end: s.end ?? t, rec: r });
  return out;
}
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// 동시에 한 일은 한 번만 세는 "실제 일한 시간"
function unionMs(ivs, from, to) {
  const parts = ivs.map(i => [Math.max(i.start, from), Math.min(i.end, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, cs = null, ce = null;
  for (const [a, b] of parts) {
    if (ce === null || a > ce) { if (ce !== null) total += ce - cs; cs = a; ce = b; }
    else ce = Math.max(ce, b);
  }
  if (ce !== null) total += ce - cs;
  return total;
}
function summarize(from, to, ivs = allIntervals()) {
  const byCat = {}, recs = new Set();
  let total = 0;
  for (const i of ivs) {
    const o = overlap(i.start, i.end, from, to);
    if (o <= 0) continue;
    byCat[i.cat] = (byCat[i.cat] || 0) + o;
    total += o;
    recs.add(i.rec);
  }
  return { byCat, total, actual: unionMs(ivs, from, to), count: recs.size };
}
function periodRange(type, anchor) {
  const d = startOfDay(anchor);
  let from, to;
  if (type === 'day') { from = d; to = addDays(d, 1); }
  else if (type === 'week') { from = addDays(d, -((d.getDay() + 6) % 7)); to = addDays(from, 7); }
  else { from = new Date(d.getFullYear(), d.getMonth(), 1); to = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  return { from: +from, to: +to, days: Math.round((to - from) / 86400000) };
}
function shiftAnchor(type, anchor, n) {
  const d = new Date(anchor);
  if (type === 'day') d.setDate(d.getDate() + n);
  else if (type === 'week') d.setDate(d.getDate() + 7 * n);
  else { d.setDate(1); d.setMonth(d.getMonth() + n); }
  return d;
}
function periodLabel(type, { from, to }) {
  const f = new Date(from), l = new Date(to - 1);
  if (type === 'day') return `${f.getFullYear()}. ${fmtDate(from)}`;
  if (type === 'week') return `${f.getMonth() + 1}/${f.getDate()} – ${l.getMonth() + 1}/${l.getDate()}`;
  return `${f.getFullYear()}년 ${f.getMonth() + 1}월`;
}

/* ───────── 렌더: 기록 탭 ───────── */
function renderCatChips() {
  $('#catChips').innerHTML = state.categories.map(c =>
    `<button class="chip" role="radio" aria-checked="${c.id === ui.selCat}" data-cat="${c.id}" style="--cat:var(--c${c.slot})"><span class="dot"></span>${esc(c.name)}</button>`
  ).join('');
  const titles = [...new Set(state.records.filter(r => r.catId === ui.selCat).reverse().map(r => r.title))].slice(0, 20);
  $('#titleList').innerHTML = titles.map(t => `<option value="${esc(t)}">`).join('');

  const seen = new Set(), recent = [];
  for (let i = state.records.length - 1; i >= 0 && recent.length < 6; i--) {
    const r = state.records[i], key = r.catId + '|' + r.title;
    if (seen.has(key) || !state.categories.some(c => c.id === r.catId)) continue;
    seen.add(key);
    recent.push(r);
  }
  $('#recentWrap').hidden = !recent.length;
  $('#recentChips').innerHTML = recent.map(r =>
    `<button class="chip" data-quick="${esc(r.catId)}" data-title="${esc(r.title)}" style="--cat:${catColor(r.catId)}"><span class="dot"></span>${esc(r.title)}</button>`
  ).join('');
}

function renderRunning() {
  const list = state.running;
  $('#runCount').textContent = list.length ? list.length + '개' : '';
  if (!list.length) { $('#runningList').innerHTML = '<p class="empty">진행 중인 작업이 없어요. 위에서 시작해보세요!</p>'; return; }
  $('#runningList').innerHTML = list.map(r => {
    const live = isLive(r), cat = catById(r.catId);
    return `<div class="card run ${live ? '' : 'paused'}" data-id="${r.id}" style="--cat:var(--c${cat.slot})">
      <div class="run-head"><span class="dot"></span>${esc(cat.name)}<span class="state ${live ? 'live' : ''}">${live ? '진행 중' : '일시정지'}</span></div>
      <input class="run-title" data-title-of="${r.id}" value="${esc(r.title)}" aria-label="작업 이름">
      <div class="timer" data-timer="${r.id}">${fmtClock(segDur(r.segments))}</div>
      <div class="since">${fmtTime(r.segments[0].start)} 시작${r.segments.length > 1 ? ` · 쉬는 시간 제외` : ''}</div>
      <textarea data-memo-of="${r.id}" rows="2" placeholder="메모 (예: 키링 20개 조립, 부가세 자료 정리)">${esc(r.memo)}</textarea>
      <div class="run-actions">
        <button class="btn" data-act="pause">${live ? '일시정지' : '다시 시작'}</button>
        <button class="btn primary" data-act="finish">완료</button>
        <button class="btn ghost" data-act="cancel" aria-label="취소">✕</button>
      </div>
    </div>`;
  }).join('');
}

function recordItem(r, showDate = false) {
  const cat = catById(r.catId), dur = segDur(r.segments);
  return `<button class="item" data-edit="${r.id}" style="--cat:var(--c${cat.slot})">
    <span class="dot"></span><span class="t">${esc(r.title)}</span><span class="d">${fmtDur(dur)}</span>
    <span class="meta">${esc(cat.name)} · ${showDate ? fmtDate(r.start) + ' ' : ''}${fmtTime(r.start)}–${fmtTime(r.end)}${r.segments.length > 1 ? ` · 일시정지 ${r.segments.length - 1}회` : ''}</span>
    ${r.memo ? `<span class="memo">${esc(r.memo)}</span>` : ''}
  </button>`;
}

function renderToday() {
  const from = +startOfDay(Date.now()), to = from + 86400000;
  const recs = state.records.filter(r => r.end > from && r.start < to).sort((a, b) => b.end - a.end);
  const s = summarize(from, to);
  $('#todayTotal').textContent = s.actual ? `오늘 ${fmtDur(s.actual)}` : '';
  $('#doneTotal').textContent = recs.length ? `${recs.length}건` : '';
  $('#todayList').innerHTML = recs.length ? recs.map(r => recordItem(r)).join('') : '<p class="empty">아직 완료한 작업이 없어요.</p>';
}

function renderNow() {
  renderCatChips();
  renderRunning();
  renderToday();
}

/* ───────── 렌더: 통계 탭 ───────── */
function buckets(type, from, to) {
  const list = [];
  const today = +startOfDay(Date.now());
  if (type === 'day') {
    for (let h = 0; h < 24; h++) {
      const s = new Date(from); s.setHours(h);
      const e = new Date(from); e.setHours(h + 1);
      list.push({ from: +s, to: +e, label: h % 6 === 0 ? `${h}시` : '', tip: `${h}시 – ${h + 1}시`, now: false });
    }
  } else {
    for (let d = new Date(from); +d < to; d = addDays(d, 1)) {
      const day = d.getDate();
      const label = type === 'week' ? WD[d.getDay()] : (day === 1 || day % 5 === 0 ? String(day) : '');
      list.push({ from: +d, to: +addDays(d, 1), label, tip: fmtDate(+d), now: +d === today });
    }
  }
  return list;
}

function niceMax(ms, type) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const step = type === 'day' ? 15 : (min <= 120 ? 30 : 60);
  return Math.ceil(min / step) * step * 60000;
}

function renderTrend(type, range, ivs) {
  const bs = buckets(type, range.from, range.to);
  for (const b of bs) { b.byCat = {}; b.total = 0; }
  for (const i of ivs) for (const b of bs) {
    const o = overlap(i.start, i.end, b.from, b.to);
    if (o > 0) { b.byCat[i.cat] = (b.byCat[i.cat] || 0) + o; b.total += o; }
  }
  const max = niceMax(Math.max(...bs.map(b => b.total)), type);
  const order = state.categories.map(c => c.id);
  const extra = [...new Set(ivs.map(i => i.cat))].filter(id => !order.includes(id));
  const cats = [...order, ...extra];

  const cols = bs.map(b => {
    const lines = cats.filter(id => b.byCat[id]).map(id => `● ${catById(id).name} ${fmtDur(b.byCat[id])}`);
    const tip = `${b.tip}\n합계 ${b.total ? fmtDur(b.total) : '0분'}${lines.length ? '\n' + lines.join('\n') : ''}`;
    const segs = cats.filter(id => b.byCat[id]).map(id => `<i style="flex-grow:${b.byCat[id]};background:${catColor(id)}"></i>`).join('');
    return `<div class="col" data-tip="${esc(tip)}">${b.total ? `<div class="stack" style="height:${(b.total / max) * 100}%">${segs}</div>` : ''}</div>`;
  }).join('');

  $('#trendTitle').textContent = type === 'day' ? '시간대별 작업' : '일별 작업 시간';
  $('#trend').innerHTML = `<div class="chart">
    <div class="yaxis"><span>${fmtDur(max)}</span><span>${fmtDur(max / 2)}</span><span>0</span></div>
    <div class="plot"><div class="gl" style="top:0"></div><div class="gl" style="top:50%"></div><div class="cols">${cols}</div></div>
    <div class="xlabels">${bs.map(b => `<span class="${b.now ? 'now' : ''}">${b.label}</span>`).join('')}</div>
  </div>`;

  const used = cats.filter(id => ivs.some(i => i.cat === id && overlap(i.start, i.end, range.from, range.to) > 0));
  $('#legend').innerHTML = used.map(id => `<span><span class="dot" style="--cat:${catColor(id)}"></span>${esc(catById(id).name)}</span>`).join('');
  return bs;
}

function renderBreakdown(sum, range) {
  const factor = range.days / 7;
  const rows = state.categories
    .map(c => ({ c, ms: sum.byCat[c.id] || 0, goalMs: (c.goal || 0) * 3600000 * factor }))
    .filter(r => r.ms > 0 || r.goalMs > 0);
  for (const id of Object.keys(sum.byCat)) if (!state.categories.some(c => c.id === id)) rows.push({ c: catById(id), ms: sum.byCat[id], goalMs: 0 });
  rows.sort((a, b) => b.ms - a.ms || b.goalMs - a.goalMs);

  $('#goalHint').textContent = state.categories.some(c => c.goal) ? (ui.period === 'week' ? '| 주간 목표' : `| 주간 목표를 ${ui.period === 'day' ? '하루' : '한 달'}로 환산`) : '';
  if (!rows.length) { $('#breakdown').innerHTML = '<p class="empty">이 기간에는 기록이 없어요.</p>'; return rows; }
  const scale = Math.max(...rows.map(r => Math.max(r.ms, r.goalMs)));
  $('#breakdown').innerHTML = rows.map(({ c, ms, goalMs }) => {
    const pct = sum.total ? Math.round((ms / sum.total) * 100) : 0;
    let gtext = '';
    if (goalMs) {
      const left = goalMs - ms;
      gtext = left > 0
        ? `<div class="gtext">목표 ${fmtDur(goalMs)} 중 ${Math.round((ms / goalMs) * 100)}% · <b>${fmtDur(left)} 더 필요</b></div>`
        : `<div class="gtext ok">✓ 목표 ${fmtDur(goalMs)} 달성</div>`;
    }
    return `<div class="brow" style="--cat:var(--c${c.slot})">
      <div class="top-line"><span class="dot"></span><span class="name">${esc(c.name)}</span><span class="val">${ms ? fmtDur(ms) : '0분'}</span><span class="pct">${pct}%</span></div>
      <div class="track"><div class="bg"></div>${ms ? `<div class="fill" style="width:${(ms / scale) * 100}%"></div>` : ''}${goalMs ? `<div class="goal" style="left:calc(${(goalMs / scale) * 100}% - 1px)" title="목표"></div>` : ''}</div>
      ${gtext}
    </div>`;
  }).join('');
  return rows;
}

function renderInsights(type, range, sum, prev, rows, ivs) {
  const out = [];
  const unit = { day: '어제', week: '지난주', month: '지난달' }[type];
  if (!sum.total) {
    out.push(['📝', '이 기간에는 아직 기록이 없어요. 작업을 시작하면 여기에서 분석해드려요.']);
  } else {
    if (prev.actual) {
      const diff = sum.actual - prev.actual;
      const pct = Math.round((diff / prev.actual) * 100);
      out.push([diff >= 0 ? '📈' : '📉', `${unit}보다 <b>${fmtDur(Math.abs(diff))} ${diff >= 0 ? '더' : '덜'}</b> 일했어요 (${pct >= 0 ? '+' : ''}${pct}%).`]);
    }
    const top = rows[0];
    if (top?.ms) out.push(['🏆', `가장 많이 한 일은 <b>${esc(top.c.name)}</b> (${fmtDur(top.ms)}, ${Math.round((top.ms / sum.total) * 100)}%)이에요.`]);

    const core = state.categories.filter(c => c.core);
    if (core.length) {
      const coreMs = core.reduce((a, c) => a + (sum.byCat[c.id] || 0), 0);
      const ratio = Math.round((coreMs / sum.total) * 100);
      const names = core.map(c => c.name).join('·');
      out.push([ratio >= 50 ? '🎨' : '🗂️', ratio >= 50
        ? `핵심 작업(${esc(names)}) 비중이 <b>${ratio}%</b>예요. 본업에 잘 집중하고 있어요.`
        : `핵심 작업(${esc(names)}) 비중이 <b>${ratio}%</b>뿐이에요. 나머지 ${100 - ratio}%는 서류·발송 같은 부가 업무예요. 묶어서 처리하거나 줄일 방법을 찾아보세요.`]);

      if (prev.total) {
        const prevCore = core.reduce((a, c) => a + (prev.byCat[c.id] || 0), 0);
        const prevRatio = Math.round((prevCore / prev.total) * 100);
        if (Math.abs(ratio - prevRatio) >= 5) out.push(['↕️', `${unit} 대비 핵심 작업 비중이 ${prevRatio}% → ${ratio}%로 ${ratio > prevRatio ? '늘었어요' : '줄었어요'}.`]);
      }
    }

    // 지난 기간보다 크게 늘어난 부가 업무
    const grown = state.categories
      .filter(c => !c.core && prev.total && (sum.byCat[c.id] || 0) - (prev.byCat[c.id] || 0) >= 30 * 60000)
      .sort((a, b) => ((sum.byCat[b.id] || 0) - (prev.byCat[b.id] || 0)) - ((sum.byCat[a.id] || 0) - (prev.byCat[a.id] || 0)))[0];
    if (grown) out.push(['⚠️', `<b>${esc(grown.name)}</b>에 ${unit}보다 ${fmtDur((sum.byCat[grown.id] || 0) - (prev.byCat[grown.id] || 0))} 더 썼어요.`]);

    if (sum.total - sum.actual >= 60000) out.push(['🔀', `여러 일을 동시에 진행한 시간이 <b>${fmtDur(sum.total - sum.actual)}</b>이에요. (작업별 누적 ${fmtDur(sum.total)} / 실제 ${fmtDur(sum.actual)})`]);

    if (type !== 'day') {
      const activeDays = buckets(type, range.from, range.to).filter(b => unionMs(ivs, b.from, b.to) > 0).length;
      if (activeDays) out.push(['📅', `${activeDays}일 일했고, 일한 날 평균 <b>${fmtDur(sum.actual / activeDays)}</b>씩 작업했어요.`]);
    }

    // 주로 일하는 시간대
    const hours = Array(24).fill(0);
    for (let d = range.from; d < range.to; d += 86400000) {
      for (let h = 0; h < 24; h++) {
        const s = new Date(d); s.setHours(h); const e = new Date(d); e.setHours(h + 1);
        hours[h] += unionMs(ivs, +s, +e);
      }
    }
    let best = 0, bestH = 0;
    for (let h = 0; h < 24; h++) { const v = hours[h] + hours[(h + 1) % 24]; if (v > best) { best = v; bestH = h; } }
    if (best) out.push(['⏰', `가장 집중해서 일한 시간대는 <b>${bestH}시–${(bestH + 2) % 24}시</b>예요.`]);
  }

  // 목표
  const goals = rows.filter(r => r.goalMs);
  if (goals.length) {
    const behind = goals.filter(r => r.ms < r.goalMs).sort((a, b) => (b.goalMs - b.ms) - (a.goalMs - a.ms));
    if (!behind.length) out.push(['🎉', '모든 목표를 달성했어요!']);
    else {
      const nowT = Date.now();
      const daysLeft = range.to > nowT ? Math.max(1, Math.ceil((range.to - Math.max(nowT, range.from)) / 86400000)) : 0;
      const list = behind.slice(0, 3).map(r => `${esc(r.c.name)} ${fmtDur(r.goalMs - r.ms)}`).join(', ');
      out.push(['🎯', `목표까지 <b>${list}</b> 남았어요.${daysLeft > 1 ? ` 남은 ${daysLeft}일 동안 하루 ${behind.slice(0, 3).map(r => `${esc(r.c.name)} ${fmtDur((r.goalMs - r.ms) / daysLeft)}`).join(', ')}씩 하면 돼요.` : ''}`]);
    }
  } else if (sum.total) {
    out.push(['💡', '설정에서 분류별 <b>주간 목표</b>를 정하면 무엇을 얼마나 더 해야 할지 알려드려요.']);
  }

  $('#insights').innerHTML = out.map(([ic, t]) => `<li><span class="ic">${ic}</span><span>${t}</span></li>`).join('');
}

function renderPeriodList(range) {
  const recs = state.records.filter(r => r.end > range.from && r.start < range.to).sort((a, b) => b.start - a.start);
  $('#periodCount').textContent = recs.length ? `${recs.length}건` : '';
  if (!recs.length) { $('#periodList').innerHTML = '<p class="empty">기록이 없어요.</p>'; return; }
  if (ui.period === 'day') { $('#periodList').innerHTML = recs.map(r => recordItem(r)).join(''); return; }
  let html = '', lastDay = null;
  for (const r of recs) {
    const day = +startOfDay(r.start);
    if (day !== lastDay) {
      const daySum = summarize(day, day + 86400000);
      html += `<div class="day-head"><span>${fmtDate(day)}</span><span>${fmtDur(daySum.actual)}</span></div>`;
      lastDay = day;
    }
    html += recordItem(r);
  }
  $('#periodList').innerHTML = html;
}

function renderStats() {
  const type = ui.period;
  const range = periodRange(type, ui.anchor);
  const prevRange = periodRange(type, shiftAnchor(type, ui.anchor, -1));
  const ivs = allIntervals();
  const sum = summarize(range.from, range.to, ivs);
  const prev = summarize(prevRange.from, prevRange.to, ivs);

  $$('#periodSeg button').forEach(b => b.classList.toggle('active', b.dataset.period === type));
  $('#periodLabel').textContent = periodLabel(type, range);
  $('#nextP').disabled = range.to > Date.now();

  const core = state.categories.filter(c => c.core);
  const coreMs = core.reduce((a, c) => a + (sum.byCat[c.id] || 0), 0);
  const activeDays = type === 'day' ? 1 : buckets(type, range.from, range.to).filter(b => unionMs(ivs, b.from, b.to) > 0).length;
  const tiles = [
    ['실제 작업 시간', fmtDur(sum.actual) || '0분', '동시 작업은 한 번만'],
    ['작업별 누적', fmtDur(sum.total) || '0분', '동시 작업 모두 합산'],
    ['완료 작업', `${sum.count}건`, type === 'day' ? '' : `${activeDays}일 일함`],
    type === 'day'
      ? ['핵심 작업 비중', sum.total ? `${Math.round((coreMs / sum.total) * 100)}%` : '–', core.map(c => c.name).join('·')]
      : ['하루 평균', activeDays ? fmtDur(sum.actual / activeDays) : '–', '일한 날 기준'],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${esc(s)}</div></div>`).join('');

  renderTrend(type, range, ivs);
  const rows = renderBreakdown(sum, range);
  renderInsights(type, range, sum, prev, rows, ivs);
  renderPeriodList(range);
}

/* ───────── 렌더: 설정 탭 ───────── */
function renderSettings() {
  $('#catSettings').innerHTML = `<div class="cat-head"><span></span><span>이름</span><span>주간 목표</span><span>핵심</span><span></span></div>` +
    state.categories.map(c => `<div class="cat-row" data-cid="${c.id}" style="--cat:var(--c${c.slot})">
      <span class="dot"></span>
      <input data-f="name" value="${esc(c.name)}" maxlength="20" aria-label="분류 이름">
      <div class="goal-in"><input data-f="goal" type="number" inputmode="decimal" min="0" step="0.5" value="${c.goal || ''}" placeholder="0" aria-label="주간 목표 시간"><span>시간</span></div>
      <label class="core"><input data-f="core" type="checkbox" ${c.core ? 'checked' : ''}></label>
      <button class="del" data-del="${c.id}" aria-label="삭제">✕</button>
    </div>`).join('');
  $('#addCat').hidden = state.categories.length >= MAX_CATS;
}

/* ───────── 편집 다이얼로그 ───────── */
function openEditor(rec) {
  ui.editing = rec;
  const isNew = !rec.id;
  $('#editTitle').textContent = isNew ? '기록 직접 추가' : '기록 수정';
  $('#fCat').innerHTML = state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (!state.categories.some(c => c.id === rec.catId)) $('#fCat').insertAdjacentHTML('beforeend', `<option value="${esc(rec.catId)}">${esc(catById(rec.catId).name)}</option>`);
  $('#fCat').value = rec.catId;
  $('#fTitle').value = rec.title || '';
  $('#fStart').value = toLocalInput(rec.start);
  $('#fEnd').value = toLocalInput(rec.end);
  $('#fMemo').value = rec.memo || '';
  $('#fNote').textContent = rec.segments?.length > 1 ? `일시정지 ${rec.segments.length - 1}회 포함 · 실제 ${fmtDur(segDur(rec.segments))}. 시간을 바꾸면 쉬는 시간 없이 하나로 합쳐져요.` : '';
  $('#fDelete').hidden = isNew;
  $('#editDlg').showModal();
}

function saveEditor(e) {
  e.preventDefault();
  const rec = ui.editing;
  const start = new Date($('#fStart').value).getTime();
  const end = new Date($('#fEnd').value).getTime();
  if (!(start < end)) { toast('종료 시간이 시작보다 늦어야 해요'); return; }
  const catId = $('#fCat').value;
  const title = $('#fTitle').value.trim() || catById(catId).name;
  const timesChanged = !rec.id || toLocalInput(rec.start) !== $('#fStart').value || toLocalInput(rec.end) !== $('#fEnd').value;
  const next = { ...rec, catId, title, memo: $('#fMemo').value, start, end, segments: timesChanged ? [{ start, end }] : rec.segments };
  if (!rec.id) { next.id = uid(); state.records.push(next); }
  else state.records[state.records.findIndex(r => r.id === rec.id)] = next;
  save();
  $('#editDlg').close();
  renderAll();
  toast('저장했어요');
}

/* ───────── 데이터 내보내기/가져오기 ───────── */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };

function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['날짜', '분류', '작업', '시작', '종료', '작업시간(분)', '메모']];
  for (const r of [...state.records].sort((a, b) => a.start - b.start)) {
    const d = new Date(r.start);
    rows.push([`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, catById(r.catId).name, r.title, fmtTime(r.start), fmtTime(r.end), Math.round(segDur(r.segments) / 60000), r.memo]);
  }
  download(`작업기록_${stamp()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!Array.isArray(s.categories) || !Array.isArray(s.records) || !Array.isArray(s.running)) throw new Error('형식 오류');
      if (!confirm(`기록 ${s.records.length}건을 불러올까요? 지금 기기의 기록은 덮어써져요.`)) return;
      state = s;
      ui.selCat = state.categories[0]?.id;
      save();
      renderAll();
      toast('불러왔어요');
    } catch (e) { toast('올바른 백업 파일이 아니에요'); }
  };
  reader.readAsText(file);
}

/* ───────── 공통 ───────── */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function setTab(tab) {
  ui.tab = tab;
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#pageTitle').textContent = { now: '지금 하는 일', stats: '통계', settings: '설정' }[tab];
  renderAll();
  window.scrollTo(0, 0);
}

function renderAll() {
  renderToday();
  if (ui.tab === 'now') renderNow();
  if (ui.tab === 'stats') renderStats();
  if (ui.tab === 'settings') renderSettings();
}

/* ───────── 이벤트 ───────── */
$('.tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

$('#catChips').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  ui.selCat = b.dataset.cat;
  renderCatChips();
});
$('#startBtn').addEventListener('click', () => {
  if (!ui.selCat) return toast('분류를 먼저 골라주세요');
  startTask(ui.selCat, $('#taskTitle').value);
  $('#taskTitle').value = '';
});
$('#taskTitle').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('#startBtn').click(); });
$('#recentChips').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]');
  if (b) startTask(b.dataset.quick, b.dataset.title);
});

$('#runningList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  ({ pause: togglePause, finish: finishTask, cancel: cancelTask })[b.dataset.act](id);
});
$('#runningList').addEventListener('input', e => {
  const t = e.target;
  const id = t.dataset.memoOf || t.dataset.titleOf;
  const r = id && state.running.find(x => x.id === id);
  if (!r) return;
  if (t.dataset.memoOf) r.memo = t.value; else r.title = t.value;
  save();
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-edit]');
  if (!b) return;
  const rec = state.records.find(r => r.id === b.dataset.edit);
  if (rec) openEditor(rec);
});
$('#addManual').addEventListener('click', () => {
  const end = Date.now();
  openEditor({ catId: ui.selCat || state.categories[0].id, title: '', memo: '', start: end - 3600000, end });
});
$('#editForm').addEventListener('submit', saveEditor);
$('#fCancel').addEventListener('click', () => $('#editDlg').close());
$('#fDelete').addEventListener('click', () => {
  if (!confirm('이 기록을 삭제할까요?')) return;
  state.records = state.records.filter(r => r.id !== ui.editing.id);
  save();
  $('#editDlg').close();
  renderAll();
});

$('#periodSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-period]');
  if (!b) return;
  ui.period = b.dataset.period;
  renderStats();
});
$('#prevP').addEventListener('click', () => { ui.anchor = shiftAnchor(ui.period, ui.anchor, -1); renderStats(); });
$('#nextP').addEventListener('click', () => { ui.anchor = shiftAnchor(ui.period, ui.anchor, 1); renderStats(); });
$('#periodLabel').addEventListener('click', () => { ui.anchor = new Date(); renderStats(); });

$('#catSettings').addEventListener('change', e => {
  const row = e.target.closest('[data-cid]');
  if (!row) return;
  const c = state.categories.find(x => x.id === row.dataset.cid);
  const f = e.target.dataset.f;
  if (f === 'name') c.name = e.target.value.trim() || c.name;
  if (f === 'goal') c.goal = Math.max(0, parseFloat(e.target.value) || 0);
  if (f === 'core') c.core = e.target.checked;
  save();
  renderSettings();
});
$('#catSettings').addEventListener('click', e => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const id = b.dataset.del;
  if (state.records.some(r => r.catId === id) || state.running.some(r => r.catId === id)) {
    return toast('기록이 있는 분류는 삭제할 수 없어요. 이름을 바꿔서 써주세요');
  }
  if (state.categories.length <= 1) return;
  state.categories = state.categories.filter(c => c.id !== id);
  if (ui.selCat === id) ui.selCat = state.categories[0].id;
  save();
  renderSettings();
});
$('#addCat').addEventListener('click', () => {
  const used = new Set(state.categories.map(c => c.slot));
  const slot = [...Array(MAX_CATS).keys()].find(i => !used.has(i));
  if (slot === undefined) return;
  state.categories.push({ id: uid(), name: '새 분류', slot, goal: 0, core: false });
  save();
  renderSettings();
  $$('#catSettings input[data-f="name"]').at(-1).select();
});

$('#exportJson').addEventListener('click', () => download(`작업기록_백업_${stamp()}.json`, JSON.stringify(state, null, 2), 'application/json'));
$('#importJson').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
$('#exportCsv').addEventListener('click', exportCsv);
$('#resetAll').addEventListener('click', () => {
  if (!confirm('모든 기록과 설정을 삭제할까요? 되돌릴 수 없어요.')) return;
  if (!confirm('정말 삭제할까요? 백업은 해두셨나요?')) return;
  state = defaultState();
  ui.selCat = state.categories[0].id;
  save();
  renderAll();
  toast('초기화했어요');
});

// 차트 툴팁 (마우스 hover / 터치 탭)
const tip = $('#tip');
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
  tip.style.top = Math.max(8, y - h - 14) + 'px';
}
document.addEventListener('pointermove', e => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY);
  else if (e.pointerType === 'mouse') tip.hidden = true;
});
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
});
window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

// 1초마다 타이머 갱신 (입력 중인 메모가 지워지지 않도록 숫자만 바꿈)
let tickCount = 0;
setInterval(() => {
  for (const el of $$('[data-timer]')) {
    const r = state.running.find(x => x.id === el.dataset.timer);
    if (r) el.textContent = fmtClock(segDur(r.segments));
  }
  if (++tickCount % 30 === 0 && state.running.some(isLive)) {
    renderToday();
    if (ui.tab === 'stats' && !document.querySelector('#editDlg[open]')) renderStats();
  }
}, 1000);

// 다른 탭/기기에서 돌아왔을 때 최신 상태로
window.addEventListener('storage', e => { if (e.key === STORE_KEY) { state = load(); renderAll(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

renderAll();
