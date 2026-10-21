/* BIKESIZE · app.js — 公路车几何对比与尺码推荐（重新实现版）
   算法与 bikesize.netlify.app 一致：STR/跨高/立管角度排序彩条、
   官网区间与几何基准线双推荐、跨高安全下修、Reach/Stack 图 + 真实比例缩略图 */
'use strict';
/* 全局函数（供内联 onclick 使用） */
function copyContact(text, el) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showCopyFeedback(text, el)).catch(() => fallbackCopy(text, el));
  } else { fallbackCopy(text, el); }
}
function fallbackCopy(text, el) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); showCopyFeedback(text, el); } catch (err) { console.error('复制失败', err); }
  document.body.removeChild(ta);
}
function showCopyFeedback(text, el) {
  if (el) {
    if (!el.dataset.original) el.dataset.original = el.textContent;
    clearTimeout(el._t);
    el.textContent = '已复制 ✓'; el.classList.add('copied');
    el._t = setTimeout(() => { el.textContent = el.dataset.original; el.classList.remove('copied'); }, 1200);
  }
  let toast = document.getElementById('copyToast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'copyToast'; toast.className = 'copy-toast'; document.body.appendChild(toast); }
  toast.textContent = '已复制：' + text; toast.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}
function showAlgoModal() {
  document.getElementById('algoModalBody').innerHTML = `
    <p><strong>推荐模式：</strong>通过标题右侧下拉菜单切换，仅在开启「身高」功能后可选。</p>
    <p><strong>① 品牌官网推荐：</strong>依据各品牌官网给出的身高区间。当身高落入某个尺码的区间时选中该尺码；若同时落入多个相邻尺码的区间（区间常有重叠），取区间下限更高的那一个；都不落入时取最接近的尺码。</p>
    <p><strong>② 几何基准线：</strong>按身高动态生成一条理想几何基准线 <code>Stack = m(H) × Reach + b(H)</code>，系统遍历每个车型的所有尺码，取距离基准线垂直距离最近的那个作为推荐。超出官方尺码范围时，会从最大/最小尺码按「相邻两码间距」延伸一个虚拟点，基准线吸附到虚拟点即判定为「无合适尺码」，并在最大/最小尺码上绘制红色 ×。</p>
    <p><strong>跨高独立提示（两种模式通用）：</strong>跨高（Standover）仅作为安全警告，不参与初始推荐。若跨高不足，会从初始推荐向下修正尺码，并在图表中以橙色虚线标示下修前的理想尺码。安全界限随车架跨高动态变化：≤65cm 时为 1.0cm，≥90cm 时为 3.0cm，中间线性插值。</p>
    <p style="color:#999;font-size:11.5px;">💡 仅「几何基准线」模式会显示红色基准线。</p>
    <p><strong>免责声明：</strong>以上推荐仅供选购参考，个体身材比例差异较大，实际选码请以线下试骑和 Bike Fitting 结论为准。</p>`;
  document.getElementById('algoModal').classList.add('show');
}
function hideAlgoModal() { document.getElementById('algoModal').classList.remove('show'); }
function showBarHelpModal() { document.getElementById('barHelpModal').classList.add('show'); }
function hideBarHelpModal() { document.getElementById('barHelpModal').classList.remove('show'); }
function showMiniInfoModal() { document.getElementById('miniInfoModal').classList.add('show'); }
function hideMiniInfoModal() { document.getElementById('miniInfoModal').classList.remove('show'); }

const $ = id => document.getElementById(id);
const IS_M = window.innerWidth <= 520;
const IS_TOUCH = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;

/* ── 常量 ── */
const H_MIN = 150, H_MAX = 205, H_DEFAULT = 175;
const L_MIN = 68, L_MAX = 100, L_DEFAULT = 80.5;
const SLIDER_ANIM_MS = 215;
const BASE_SLOPE = -1.25, SLOPE_FACTOR = 0.0;
const BASE_PIVOT_REACH = 388, BASE_PIVOT_STACK = 555;
const HEIGHT_OFFSET_FACTOR = 4.4, BASE_PIVOT_HEIGHT = 175;
const PAD_L = 46, PAD_R = 16, PAD_T = 15, PAD_B = 40;
const X_MIN = 330, X_MAX = 440, Y_MIN = 460, Y_MAX = 680, AXIS_STEP = 20;
const MINI_X_MIN = 340, MINI_X_MAX = 440, MINI_Y_MIN = 470, MINI_Y_MAX = 670, MINI_STEP = 25;
const CROSS_PATH = 'path://M5,5 L19,19 M19,5 L5,19';

/* ── 状态 ── */
let sel = {}, isFocus = false, focBrand = null, lockFocus = false;
let isRec = false, isLeg = false, algoMode = 'official', barDim = 'str', searchKeyword = '';
let pinnedTip = null, tooltipAnchor = null;
let clicked = [];
let clickCycle = { x: -9999, y: -9999, candidates: [], index: -1 };
let strSortDir = 'aggressive', lastFocusedBrand = null;
let hAnimCancel = null, lAnimCancel = null, hAnimActive = false, lAnimActive = false;
let quickAnimate = false, sortingFast = false, _brandGen = {}, _lockShown = false, _lockBrand = null, _lockHideTimer = null;
let _statusExpanded = false, _lastStHtml = '', _lastStrMode = 'str', _rafPending = false, _miniSig = '';

const EL = {
  main: $('main'), miniChart: $('miniChart'), heightSlider: $('heightSlider'), legSlider: $('legSlider'),
  heightDisplay: $('heightDisplay'), legDisplay: $('legDisplay'), heightToggle: $('heightToggle'), legToggle: $('legToggle'),
  heightRow: $('heightRow'), legRow: $('legRow'), heightLabelHit: $('heightLabelHit'), legLabelHit: $('legLabelHit'),
  legHintOuter: $('legHintOuter'), statusText: $('statusText'), statusInner: $('statusInner'),
  nodePopup: $('nodePopup'), chartLockMarker: $('chartLockMarker'), strDisplay: $('strDisplay'),
  legendChips: $('legendChips'), chipsScroll: $('chipsScroll'), sortSelect: $('sortSelect'), barSelect: $('barSelect'),
  sortLabel: $('sortLabel'), barLabel: $('barLabel'), algoSelect: $('algoSelect'), accordionContainer: $('accordionContainer')
};

/* ── FBD：按品牌聚合数据 ── */
const FBD = {};
function buildFBD() {
  Object.keys(DATA).forEach(b => {
    const raw = DATA[b];
    const bd = { color: raw.c, columns: ['尺码', 'Reach (mm)', 'Stack (mm)', '跨高 (mm)', '头管角度', '立管角度', '轴距 (mm)', '推荐身高 (cm)'], rows: [], recommendData: [], variants: raw.variants || null, currentVariant: 'race' };
    const rows = raw.r;
    if (raw.variants) {
      const def = raw.variants.race;
      if (def && def.rows) rows.length = 0, rows.push(...def.rows);
    }
    const n = rows.length;
    rows.forEach((r, i) => {
      const sa = (r[12] != null && r[12] !== '' && !isNaN(+r[12])) ? +r[12] : 74.0 - (i / (n - 1 || 1)) * 1.0;
      bd.rows.push([r[0], r[1], r[2], r[3], r[4], sa.toFixed(1) + '°', r[5], r[6]]);
      bd.recommendData.push({ size: r[0], reach: +r[1], stack: +r[2], standover: (r[3] === '—' || r[3] === '' || r[3] == null) ? null : +r[3], minH: +r[8], maxH: +r[9], seatAngle: sa });
    });
    FBD[b] = bd;
  });
}
function adjustRecommendations() {
  const SMALLER_OFFSET = new Map([['Colnago Y1Rs', -2], ['Colnago V5Rs', -2], ['Sp Roubaix', 5], ['Tavelo GROW', 5], ['Orbea Orca Aero', 5], ['BMC RM', 5], ['Wilier Granturismo', 5], ['CUBE Attain', 5], ['CUBE Agree', 5]]);
  const LARGER_OFFSET = new Map([['Colnago C72', 2]]);
  ORDER.forEach(b => {
    const bd = FBD[b]; if (!bd || !bd.recommendData) return;
    const lo = LARGER_OFFSET.get(b), so = SMALLER_OFFSET.get(b);
    bd.recommendData.forEach(s => {
      if (so) { s.minH += so; s.maxH += so; }
      if (lo) { s.minH += lo; s.maxH += lo; }
      s.minH = Math.max(130, s.minH); s.maxH = Math.min(215, s.maxH);
    });
  });
}
function fillHeightGaps() {
  ORDER.forEach(b => {
    const bd = FBD[b]; if (!bd) return;
    for (let i = 0; i < bd.recommendData.length - 1; i++) {
      const cur = bd.recommendData[i], nxt = bd.recommendData[i + 1];
      if (cur.maxH < nxt.minH) cur.maxH = nxt.minH;
    }
  });
}
function avgSTR(b) { return FBD[b] && FBD[b]._avgSTR ? FBD[b]._avgSTR : 0; }
function avgSO(b) { return FBD[b] && FBD[b]._avgSO ? FBD[b]._avgSO : 0; }
function computeAverages() {
  ORDER.forEach(b => {
    const bd = FBD[b]; if (!bd || !bd.recommendData.length) return;
    let sr = 0, sc = 0, so = 0, ns = 0, nso = 0;
    bd.recommendData.forEach(s => {
      if (s.reach > 0 && s.stack > 0) { sr += s.stack / s.reach; sc++; }
      if (s.standover != null) { so += s.standover; nso++; }
    });
    bd._avgSTR = sc ? sr / sc : 0;
    bd._avgSO = nso ? so / nso : 0;
    ns = bd.recommendData.length;
    bd._seatAvg = bd.recommendData.reduce((a, s) => a + (s.seatAngle || 0), 0) / (ns || 1);
  });
}
function rebuildIncolorData(brand, variant) {
  if (!DATA[brand] || !DATA[brand].variants || !DATA[brand].variants[variant]) return;
  const bd = FBD[brand];
  bd.currentVariant = variant;
  const rows = DATA[brand].variants[variant].rows;
  const n = rows.length;
  bd.rows = []; bd.recommendData = [];
  rows.forEach((r, i) => {
    const sa = (r[12] != null && r[12] !== '' && !isNaN(+r[12])) ? +r[12] : 74.0 - (i / (n - 1 || 1)) * 1.0;
    bd.rows.push([r[0], r[1], r[2], r[3], r[4], sa.toFixed(1) + '°', r[5], r[6]]);
    bd.recommendData.push({ size: r[0], reach: +r[1], stack: +r[2], standover: (r[3] === '—' || r[3] === '' || r[3] == null) ? null : +r[3], minH: +r[8], maxH: +r[9], seatAngle: sa });
  });
  computeAverages();
}

/* ── 尺码推荐核心 ── */
function getSM(standoverMM) {
  if (standoverMM === undefined || standoverMM === null || isNaN(standoverMM)) return 20;
  if (standoverMM <= 650) return 10;
  if (standoverMM >= 900) return 30;
  return Math.round(10 + (standoverMM - 650) * 0.08);
}
function getVirtualPoints(sz) {
  if (!sz || sz.length < 2) return { larger: null, smaller: null };
  const last = sz[sz.length - 1], prev = sz[sz.length - 2];
  const lastDR = (last.reach - prev.reach) * 1.5, lastDS = (last.stack - prev.stack) * 1.5;
  const first = sz[0], second = sz[1];
  const firstDR = (first.reach - second.reach) * 1.5, firstDS = (first.stack - second.stack) * 1.5;
  return { larger: { reach: last.reach + lastDR, stack: last.stack + lastDS }, smaller: { reach: first.reach + firstDR, stack: first.stack + firstDS } };
}
function getBaselineRec(sz, h) {
  if (!sz || !sz.length) return { index: -1, virtual: null, side: null };
  const m = BASE_SLOPE + (h - BASE_PIVOT_HEIGHT) * SLOPE_FACTOR;
  const b = BASE_PIVOT_STACK - m * BASE_PIVOT_REACH + (h - BASE_PIVOT_HEIGHT) * HEIGHT_OFFSET_FACTOR;
  const normFactor = Math.sqrt(m * m + 1);
  const targetStack = reach => m * reach + b;
  let minDist = Infinity, bestIndex = -1, bestVirtual = null, bestSide = null;
  sz.forEach(s => {
    const d = Math.abs(s.stack - targetStack(s.reach)) / normFactor;
    if (d < minDist) { minDist = d; bestIndex = sz.indexOf(s); bestVirtual = null; bestSide = null; }
  });
  const vp = getVirtualPoints(sz);
  ['larger', 'smaller'].forEach(k => {
    const v = vp[k]; if (!v) return;
    const d = Math.abs(v.stack - targetStack(v.reach)) / normFactor;
    if (d < minDist) { minDist = d; bestIndex = -1; bestVirtual = { reach: v.reach, stack: v.stack }; bestSide = k; }
  });
  return { index: bestIndex, virtual: bestVirtual, side: bestSide };
}
function bestSize(sz, h, leg, useLeg) {
  if (!sz || !sz.length) return -1;
  let bestIndex = -1;
  if (algoMode === 'official') {
    let bestMinH = -Infinity;
    sz.forEach((s, i) => { if (h >= s.minH && h <= s.maxH && s.minH > bestMinH) { bestMinH = s.minH; bestIndex = i; } });
    if (bestIndex < 0) return -1;
  } else {
    const rec = getBaselineRec(sz, h);
    bestIndex = rec.index;
    if (bestIndex < 0) return -1;
  }
  if (!useLeg) return bestIndex;
  for (let i = bestIndex; i >= 0; i--) {
    const so = sz[i].standover;
    if (so === undefined || so === null) return i;
    if (leg * 10 - so >= getSM(so)) return i;
  }
  return -1;
}
function getSeatAngleForBrand(brand) {
  const bd = FBD[brand]; if (!bd) return null;
  if (!isRec) return bd._seatAvg;
  const h = hAnimActive ? H_DEFAULT : +EL.heightSlider.value;
  const bi = bestSize(bd.recommendData, h, L_DEFAULT, false);
  if (bi >= 0 && bd.recommendData[bi].seatAngle != null) return bd.recommendData[bi].seatAngle;
  return bd._seatAvg;
}

/* ── 彩条 ── */
const SORT_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'str_desc', label: 'STR 激进→耐力' },
  { value: 'str_asc', label: 'STR 耐力→激进' },
  { value: 'so_desc', label: '跨高要求 高→低' },
  { value: 'so_asc', label: '跨高要求 低→高' },
  { value: 'import', label: '进口→国产' },
  { value: 'domestic', label: '国产→进口' }
];
const BAR_OPTIONS = [
  { value: 'str', label: 'STR 激进程度' },
  { value: 'standover', label: '跨高要求' },
  { value: 'seatangle', label: '立管角度（需开启身高）' }
];
function getBarValue(b, dim) {
  const dim2 = (dim === 'seatangle' && !isRec) ? 'str' : dim;
  if (dim2 === 'str') { const v = avgSTR(b); return v > 0 && v < 900 ? v : null; }
  if (dim2 === 'standover') { const v = avgSO(b); return v > 0 ? v : null; }
  const v = getSeatAngleForBrand(b); return v != null ? v : null;
}
function computeBarRange(dim) {
  if (dim === 'seatangle') return { min: 71, max: 76 };
  let lo = Infinity, hi = -Infinity;
  ORDER.forEach(b => { const v = getBarValue(b, dim); if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
  if (!isFinite(lo) || !isFinite(hi)) return { min: 68, max: 75 };
  return { min: lo, max: hi };
}
function computeBarPct(b, dim, range) {
  const v = getBarValue(b, dim);
  if (v == null) return 5;
  const span = range.max - range.min || 1;
  let pct = dim === 'str' ? (range.max - v) / span * 100 : (v - range.min) / span * 100;
  return Math.max(5, Math.min(100, pct));
}

/* ── 排序与搜索 ── */
function brandKeyOf(b) { return b.replace(/ [A-Z].*$/, ''); }
function pickRandomSelection() {
  const seen = new Set(), chosen = [];
  ORDER.forEach(b => {
    const key = brandKeyOf(b);
    if (!seen.has(key)) { seen.add(key); chosen.push(b); }
  });
  if (!chosen.includes('Trek Madone')) chosen.push('Trek Madone');
  const need = Math.max(chosen.length, Math.round(ORDER.length / 3));
  const rest = ORDER.filter(b => !chosen.includes(b));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  for (let i = 0; chosen.length < need && i < rest.length; i++) chosen.push(rest[i]);
  sel = {};
  chosen.forEach(b => { sel[b] = true; });
}
function applySort() {
  const kind = EL.sortSelect.dataset.kind || 'default';
  if (kind === 'search') {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) { ORDER.splice(0, ORDER.length, ...DEFAULT_ORDER); }
    else {
      const matched = DEFAULT_ORDER.filter(b => b.toLowerCase().includes(kw));
      const rest = DEFAULT_ORDER.filter(b => !matched.includes(b));
      ORDER.splice(0, ORDER.length, ...matched, ...rest);
    }
    sel = {};
    ORDER.forEach(b => { sel[b] = true; });
  } else if (kind === 'default') {
    ORDER.splice(0, ORDER.length, ...DEFAULT_ORDER);
    pickRandomSelection();
  } else {
    let arr = ORDER.slice();
    if (kind === 'str_desc') arr.sort((a, b) => avgSTR(b) - avgSTR(a));
    else if (kind === 'str_asc') arr.sort((a, b) => avgSTR(a) - avgSTR(b));
    else if (kind === 'so_desc') arr.sort((a, b) => avgSO(b) - avgSO(a));
    else if (kind === 'so_asc') arr.sort((a, b) => avgSO(a) - avgSO(b));
    ORDER.splice(0, ORDER.length, ...arr);
    const topN = Math.max(1, Math.round(arr.length * 0.5));
    sel = {};
    if (kind === 'import') { ORDER.forEach(b => { if (!DOMESTIC_BRANDS.has(b)) sel[b] = true; }); }
    else if (kind === 'domestic') { ORDER.forEach(b => { if (DOMESTIC_BRANDS.has(b)) sel[b] = true; }); }
    else { arr.slice(0, topN).forEach(b => { sel[b] = true; }); }
  }
  if (lockFocus) { if (focBrand && sel[focBrand] === false) { focBrand = null; lockFocus = false; } }
  ensureFocus();
}
function commitSearch() {
  const v = $('searchInput').value.trim();
  searchKeyword = v;
  EL.sortSelect.value = 'default';
  EL.sortSelect.dataset.kind = 'search';
  EL.sortLabel.textContent = v ? '搜索：' + v : '搜索';
  $('searchOverlay').classList.add('hidden');
  sortingFast = true;
  applySort();
  renderChips(true, true); syncToggle(); clearNodeHighlight();
  setTimeout(() => { sortingFast = false; }, 900);
}
function rebuildSortSelect() {
  EL.sortSelect.innerHTML = SORT_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
}
function rebuildBarSelect() {
  EL.barSelect.innerHTML = BAR_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  EL.barSelect.value = barDim;
  EL.barLabel.textContent = '彩条：' + (BAR_OPTIONS.find(o => o.value === barDim) || {}).label;
}
function refreshSortKind() {
  EL.sortSelect.dataset.kind = 'default';
  EL.sortLabel.textContent = '排序：默认';
}
function onSortChange() {
  EL.sortSelect.dataset.kind = EL.sortSelect.value;
  const o = SORT_OPTIONS.find(x => x.value === EL.sortSelect.value);
  EL.sortLabel.textContent = '排序：' + o.label;
  sortingFast = true;
  applySort();
  renderChips(true, true); syncToggle(); clearNodeHighlight();
  setTimeout(() => { sortingFast = false; }, 900);
}
function onBarChange() {
  barDim = EL.barSelect.value;
  const o = BAR_OPTIONS.find(x => x.value === barDim);
  EL.barLabel.textContent = '彩条：' + o.label;
  renderChips(false, false);
  if (barDim === 'seatangle') updateBarProgress();
  update();
}

/* ── 图表 ── */
const _dpr = Math.min(window.devicePixelRatio || 1, 2);
const chart = echarts.init($('main'), null, { devicePixelRatio: _dpr });
const miniChart = echarts.init($('miniChart'), null, { devicePixelRatio: _dpr });
function getContainerWidth() { return EL.main.clientWidth || (EL.main.parentElement ? EL.main.parentElement.clientWidth : 0) || innerWidth || 440; }
function getGridWidth() { return Math.max(100, getContainerWidth() - PAD_L - PAD_R); }
function compressedHeight() { return 300; }
function getGridHeightPx() { return Math.max(60, compressedHeight() - PAD_T - PAD_B); }
function calcGrid() { return { left: PAD_L, top: PAD_T, width: getGridWidth(), height: getGridHeightPx(), containLabel: false }; }
function applyHeight() { EL.main.style.height = compressedHeight() + 'px'; }
function getPointStyle(ib, isF, dim, rec) {
  if (dim) return { opacity: 0.12, borderWidth: 0 };
  if (isF) { return ib ? { opacity: 1, borderColor: '#fff', borderWidth: 3, shadowColor: 'rgba(0,0,0,0.15)', shadowBlur: 3, shadowOffsetY: 0 } : { opacity: 1, borderColor: '#fff', borderWidth: 2 }; }
  return { opacity: rec ? (ib ? 1 : 0.12) : 0.6, borderColor: ib ? '#fff' : 'transparent', borderWidth: ib ? 2 : 0 };
}
function getSymSize(ib, isF, rec) { return isF ? (ib ? 24 : 10) : rec ? (ib ? 20 : 5) : 7; }
function getSuppressedStyle(isF, dim) { const opa = dim ? 0.18 : (isF ? 1 : 0.55); return { color: 'rgba(243,156,18,0.06)', borderColor: '#f39c12', borderWidth: 2.5, borderType: [8, 4], opacity: opa }; }
function makeCrossPair(reach, stack, isF, dim) {
  const size = isF ? 15 : 10, outW = isF ? 9 : 4.4, mainW = isF ? 8 : 6;
  const opacity = dim ? 0.5 : 1;
  return {
    outline: { value: [reach, stack], symbol: CROSS_PATH, symbolSize: size, itemStyle: { color: 'transparent', borderColor: dim ? 'rgba(255,255,255,0.6)' : '#fff', borderWidth: outW, opacity: opacity, shadowColor: 'rgba(0,0,0,0.22)', shadowBlur: isF ? 4 : 0, shadowOffsetY: isF ? 1 : 0 }, label: { show: false }, silent: true },
    main: { value: [reach, stack], symbol: CROSS_PATH, symbolSize: size, itemStyle: { color: 'transparent', borderColor: dim ? 'rgba(229,57,53,0.45)' : '#e53935', borderWidth: mainW, opacity: opacity }, label: { show: false }, silent: true }
  };
}
function buildOption(h, leg, rec, useLeg, bestMap, idealMap, virtualMap) {
  bestMap = bestMap || {}; idealMap = idealMap || {}; virtualMap = virtualMap || {};
  const Z_BASELINE = 5, Z_SUPP_NORMAL = 50, Z_LINE_NORMAL = 100, Z_X_NORMAL = 150, Z_REC_NORMAL = 200;
  const Z_SUPP_FOCUS = 1100, Z_LINE_FOCUS = 1200, Z_X_FOCUS = 1500, Z_REC_FOCUS = 2000, Z_CLICKED = 10000;
  const series = [];
  const suppressedNormal = [], suppressedFocus = [], crossOutlineNormal = [], crossMainNormal = [];
  const crossOutlineFocus = [], crossMainFocus = [], curveSeriesNormal = [], curveSeriesFocus = [];
  const recSymNormal = [], recSymFocus = [];
  const activeBrand = isFocus ? focBrand : (pinnedTip ? pinnedTip.brand : null);
  const focOn = !!activeBrand;
  const norm = [], foc = [];
  ORDER.forEach(b => { if (sel[b] === false || !FBD[b]) return; if (focOn && b === activeBrand) foc.push(b); else norm.push(b); });
  const ord = norm.concat(foc);
  ord.forEach((b, idx) => {
    const sz = FBD[b].recommendData, isF = (b === activeBrand), dim = focOn && !isF;
    const zLine = isF ? Z_LINE_FOCUS : Z_LINE_NORMAL;
    const lOp = () => dim ? 0.2 : (isF ? 1 : (rec ? 0.25 : 0.8));
    const lW = isF ? 2.8 : 2;
    const bi = rec ? (bestMap[b] != null ? bestMap[b] : -1) : -1;
    if (rec && useLeg && bi >= 0) {
      const idealBi = idealMap[b] != null ? idealMap[b] : -1;
      if (idealBi >= 0 && bi < idealBi) {
        const it = sz[idealBi];
        const item = { id: 'sup|' + b, value: [it.reach, it.stack], itemStyle: getSuppressedStyle(isF, dim) };
        if (isF) suppressedFocus.push(item); else suppressedNormal.push(item);
      }
    }
    if (rec && bi === -1) {
      let anchor = null;
      if (virtualMap && virtualMap[b]) { anchor = (virtualMap[b].side === 'larger') ? sz[sz.length - 1] : sz[0]; }
      else { const last = sz[sz.length - 1]; anchor = (h > last.maxH) ? last : sz[0]; }
      const P = makeCrossPair(anchor.reach, anchor.stack, isF, dim);
      if (isF) { crossOutlineFocus.push(P.outline); crossMainFocus.push(P.main); }
      else { crossOutlineNormal.push(P.outline); crossMainNormal.push(P.main); }
    }
    const recActive = rec && bi >= 0;
    const bg = _brandGen[b] || 0;
    const data = sz.map((it, i) => {
      if (i === bi && recActive) return { value: [it.reach, it.stack], symbolSize: 0, itemStyle: { opacity: 0 } };
      return { value: [it.reach, it.stack], name: it.size, standover: it.standover, itemStyle: getPointStyle(false, isF, dim, rec), symbolSize: getSymSize(false, isF, rec), label: { show: false } };
    });
    if (isF) {
      curveSeriesFocus.push({ id: b + '__lineHalo_' + bg, name: '__halo__', type: 'line', data: data.map(d => ({ value: d.value })), symbol: 'none', silent: true, tooltip: { show: false }, emphasis: { disabled: true }, lineStyle: { width: lW + 5, color: '#fff', opacity: 0.95 }, z: zLine - 1, animation: false });
    }
    const curve = { id: b + '__line_' + bg, name: b, type: 'line', data, symbol: SYM[b] || 'circle', itemStyle: { color: FBD[b].color }, lineStyle: { width: lW, opacity: lOp(), color: FBD[b].color }, z: zLine };
    if (isF) curveSeriesFocus.push(curve); else curveSeriesNormal.push(curve);
    if (recActive) {
      const it = sz[bi];
      const nearRight = it.reach > X_MAX - AXIS_STEP * 0.9;
      const showLabel = !dim;
      const recSize = isF ? 24 : (dim ? 12 : 20);
      const itemOpacity = dim ? 0.40 : 1;
      const borderW = isF ? 3 : (dim ? 1.5 : 2);
      const zRec = isF ? (Z_REC_FOCUS + idx) : (Z_REC_NORMAL + idx);
      let labelFmt;
      if (isF) { const r = it.reach, s = it.stack; const strTxt = (r > 0 && s > 0) ? '{t2|str: ' + (s / r).toFixed(2) + '}' : ''; labelFmt = '{t1|' + it.size + '}\n' + strTxt; }
      else { labelFmt = it.size; }
      const recSeries = {
        id: b + '__recPoint_' + (isF ? 'on' : 'off') + '_' + (dim ? 'dim' : 'norm') + '_' + bg, name: b + '__recPoint', type: 'scatter',
        data: [{ value: [it.reach, it.stack], name: it.size }], symbol: SYM[b] || 'circle', symbolSize: recSize,
        itemStyle: { opacity: itemOpacity, color: FBD[b].color, borderColor: '#fff', borderWidth: borderW, shadowColor: isF ? 'rgba(0,0,0,0.15)' : 'transparent', shadowBlur: isF ? 3 : 0, shadowOffsetY: 0 },
        label: { show: showLabel, position: nearRight ? 'left' : 'right', distance: 4, formatter: labelFmt, rich: { t1: { fontSize: 11, fontWeight: 'bold', color: FBD[b].color, lineHeight: 14 }, t2: { fontSize: 10, color: '#8a94a6', lineHeight: 12, fontWeight: '600' } }, color: FBD[b].color, fontWeight: 'bold', fontSize: 11, backgroundColor: 'rgba(255,255,255,1)', padding: [2, 4], borderRadius: 4 },
        z: zRec, animation: true, animationDuration: 255, animationEasing: 'cubicOut', animationDurationUpdate: 150, animationEasingUpdate: 'cubicOut'
      };
      if (isF) recSymFocus.push(recSeries); else recSymNormal.push(recSeries);
    }
  });
  if (rec && algoMode === 'baseline') {
    const currentH = hAnimActive ? H_DEFAULT : +EL.heightSlider.value;
    const m = BASE_SLOPE + (currentH - BASE_PIVOT_HEIGHT) * SLOPE_FACTOR;
    const b = BASE_PIVOT_STACK - m * BASE_PIVOT_REACH + (currentH - BASE_PIVOT_HEIGHT) * HEIGHT_OFFSET_FACTOR;
    series.push({ id: '__baseline__', name: '基准线', type: 'line', data: [[X_MIN, m * X_MIN + b], [X_MAX, m * X_MAX + b]], symbol: 'none', silent: true, tooltip: { show: false }, lineStyle: { color: '#ff4d4f', width: 2.5, type: 'dashed', opacity: 0.8 }, z: Z_BASELINE, animation: false });
  }
  if (suppressedNormal.length) series.push({ id: '__suppressed_normal__', name: '__suppressed_normal__', type: 'scatter', data: suppressedNormal, symbol: 'circle', symbolSize: focOn ? 20 : 30, itemStyle: { color: 'rgba(243,156,18,0.06)', borderColor: '#f39c12', borderWidth: 2.5, borderType: [8, 4] }, label: { show: false }, silent: true, emphasis: { disabled: true }, tooltip: { show: false }, z: Z_SUPP_NORMAL, animationDuration: 150, animationDurationUpdate: 150, animationEasing: 'cubicOut', animationEasingUpdate: 'cubicOut' });
  if (suppressedFocus.length) series.push({ id: '__suppressed_focus__', name: '__suppressed_focus__', type: 'scatter', data: suppressedFocus, symbol: 'circle', symbolSize: 30, itemStyle: { color: 'rgba(243,156,18,0.06)', borderColor: '#f39c12', borderWidth: 2.5, borderType: [8, 4] }, label: { show: false }, silent: true, emphasis: { disabled: true }, tooltip: { show: false }, z: Z_SUPP_FOCUS, animationDuration: 150, animationDurationUpdate: 150, animationEasing: 'cubicOut', animationEasingUpdate: 'cubicOut' });
  curveSeriesNormal.forEach(s => series.push(s));
  recSymNormal.forEach(s => series.push(s));
  if (crossOutlineNormal.length) { series.push({ id: '__crossNormalOutline__', name: '__crossNormalOutline__', type: 'scatter', data: crossOutlineNormal, symbol: CROSS_PATH, z: Z_X_NORMAL, silent: true, tooltip: { show: false }, animation: false }); series.push({ id: '__crossNormalMain__', name: '__crossNormalMain__', type: 'scatter', data: crossMainNormal, symbol: CROSS_PATH, z: Z_X_NORMAL + 1, silent: true, tooltip: { show: false }, animation: false }); }
  curveSeriesFocus.forEach(s => series.push(s));
  recSymFocus.forEach(s => series.push(s));
  if (crossOutlineFocus.length) { series.push({ id: '__crossFocusOutline__', name: '__crossFocusOutline__', type: 'scatter', data: crossOutlineFocus, symbol: CROSS_PATH, z: Z_X_FOCUS, silent: true, tooltip: { show: false }, animation: false }); series.push({ id: '__crossFocusMain__', name: '__crossFocusMain__', type: 'scatter', data: crossMainFocus, symbol: CROSS_PATH, z: Z_X_FOCUS + 1, silent: true, tooltip: { show: false }, animation: false }); }
  series.push({ id: '__clicked__', name: '__clicked__', type: 'scatter', data: clicked, symbol: 'circle', symbolSize: 14, itemStyle: { borderColor: '#fff', borderWidth: 2.5, shadowColor: 'rgba(0,0,0,.5)', shadowBlur: 6, shadowOffsetY: 1 }, label: { show: false }, z: Z_CLICKED, silent: true, tooltip: { show: false } });
  const baseDur = quickAnimate ? 300 : (sortingFast ? 220 : 600);
  const updDur = quickAnimate ? 360 : (sortingFast ? 120 : 250);
  return {
    animation: true,
    animationDuration: IS_M ? Math.min(baseDur, 280) : baseDur,
    animationDurationUpdate: IS_M ? Math.min(updDur, 180) : updDur,
    animationEasing: 'cubicOut', animationEasingUpdate: 'cubicOut',
    animationDelay: function (idx) { return sortingFast ? Math.min(idx * 8, 150) : Math.min(idx * 10, 200); },
    animationDelayUpdate: function () { return 0; },
    tooltip: { show: false },
    grid: calcGrid(),
    xAxis: { type: 'value', name: 'Reach (mm)', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 12, fontWeight: 'bold' }, min: X_MIN, max: X_MAX, interval: AXIS_STEP, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#e8e8e8' } }, axisLabel: { fontSize: 10, interval: 'auto', hideOverlap: true }, axisTick: { show: true, interval: AXIS_STEP } },
    yAxis: { type: 'value', name: 'Stack (mm)', nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: 12, fontWeight: 'bold' }, min: Y_MIN, max: Y_MAX, interval: AXIS_STEP, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#e8e8e8' } }, axisLabel: { fontSize: 10 }, axisTick: { show: true, interval: AXIS_STEP } },
    series
  };
}
function buildMiniOption() {
  const visibleBrands = ORDER.filter(b => sel[b] !== false && FBD[b]);
  const series = visibleBrands.map(b => {
    const isF = isFocus && focBrand === b;
    const data = FBD[b].recommendData.map(it => [it.reach, it.stack]);
    return { type: 'line', name: b, data, symbol: isF ? 'circle' : 'none', symbolSize: isF ? 4 : 0, itemStyle: { color: FBD[b].color, borderColor: '#fff', borderWidth: isF ? 1 : 0, opacity: isF ? 1 : 0.42 }, lineStyle: { width: isF ? 2 : 1.2, opacity: isF ? 1 : 0.42, color: FBD[b].color }, silent: true, tooltip: { show: false }, emphasis: { disabled: true }, animation: false, z: isF ? 10 : 1 };
  });
  return {
    animation: false,
    grid: { left: 2, right: 2, top: 2, bottom: 2, containLabel: false },
    xAxis: { show: true, type: 'value', min: MINI_X_MIN, max: MINI_X_MAX, interval: MINI_STEP, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#E7E7E8', width: 1, opacity: 1 } } },
    yAxis: { show: true, type: 'value', min: MINI_Y_MIN, max: MINI_Y_MAX, interval: MINI_STEP, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#E7E7E8', width: 1, opacity: 1 } } },
    series
  };
}
function updateMiniChart() {
  if (!miniChart) return;
  const visibleBrands = ORDER.filter(b => sel[b] !== false && FBD[b]);
  const sig = visibleBrands.join('|') + '|' + (isFocus ? focBrand : '') + '|' + isFocus;
  if (sig === _miniSig) return;
  _miniSig = sig;
  miniChart.setOption(buildMiniOption(), true);
}
function updateBarProgress() {
  if (barDim === 'seatangle') renderChips(false, false);
}

/* ── 主更新 ── */
function scheduleUpdate() { if (_rafPending) return; _rafPending = true; requestAnimationFrame(() => { _rafPending = false; update(); }); }
function update() {
  const hv = hAnimActive ? H_DEFAULT : +EL.heightSlider.value;
  const lv = lAnimActive ? L_DEFAULT : +EL.legSlider.value;
  if (!hAnimActive) { const hs = fmtVal(+EL.heightSlider.value); if (EL.heightDisplay.textContent !== hs) EL.heightDisplay.textContent = hs; }
  if (!lAnimActive) { const ls = fmtVal(+EL.legSlider.value); if (EL.legDisplay.textContent !== ls) EL.legDisplay.textContent = ls; }
  const bestMap = {}, idealMap = {}, virtualMap = {};
  if (isRec) {
    ORDER.forEach(b => {
      if (sel[b] === false || !FBD[b]) return;
      const sz = FBD[b].recommendData;
      bestMap[b] = bestSize(sz, hv, lv, isLeg);
      if (isLeg) idealMap[b] = bestSize(sz, hv, lv, false);
      if (algoMode === 'baseline') {
        const rec = getBaselineRec(sz, hv);
        if (rec.virtual) virtualMap[b] = { reach: rec.virtual.reach, stack: rec.virtual.stack, side: rec.side };
      }
    });
  }
  chart.setOption(buildOption(hv, lv, isRec, isLeg, bestMap, idealMap, virtualMap), { replaceMerge: ['series'], lazyUpdate: true, silent: false });
  const stHtml = statusHtml(bestMap, isRec, isLeg, hv, lv);
  if (stHtml !== _lastStHtml || (stHtml && EL.statusInner.children.length === 0)) { _lastStHtml = stHtml; EL.statusInner.innerHTML = stHtml; }
  syncStatusExpand(!!stHtml);
  if (pinnedTip) showNodePopup(pinnedTip.brand, pinnedTip.sizeName);
  updateStrDisplay();
  updateChartLockMarker();
  if (barDim === 'seatangle') updateBarProgress();
  updateMiniChart();
}
function forceSync() {
  if (!hAnimActive && !lAnimActive) {
    const hs = fmtVal(+EL.heightSlider.value), ls = fmtVal(+EL.legSlider.value);
    if (EL.heightDisplay.textContent !== hs) EL.heightDisplay.textContent = hs;
    if (EL.legDisplay.textContent !== ls) EL.legDisplay.textContent = ls;
  }
  applyToggleUI(); applyHeight(); chart.resize(); miniChart.resize(); update();
}
function scheduleForceSync() { requestAnimationFrame(() => requestAnimationFrame(forceSync)); }

/* ── 状态文本 ── */
function statusHtml(bestMap, rec, useLeg, h, leg) {
  if (!rec) return '';
  let html = '';
  ORDER.forEach(b => {
    if (sel[b] === false || !FBD[b]) return;
    const s = FBD[b].recommendData;
    const focusedCls = (focBrand === b) ? ' focused-badge' : '';
    const bi = bestMap[b] != null ? bestMap[b] : -1;
    const sizeTxt = bi >= 0 ? s[bi].size : '无';
    html += '<div class="status-badge' + focusedCls + '"><span class="color-dot" style="background:' + FBD[b].color + '"></span><span>' + b + ': <strong>' + sizeTxt + '</strong></span></div>';
  });
  if (!html) return '';
  let p = '📏 ' + h + 'cm'; if (useLeg) p += ' / 跨高 ' + leg + 'cm';
  return '<div class="status-info-line">' + p + ' 推荐尺码：</div><div class="status-badges-line">' + html + '</div>';
}
function syncStatusExpand(hasContent) {
  if (hasContent) { if (!_statusExpanded) { EL.statusText.classList.add('expanded'); _statusExpanded = true; } }
  else { if (_statusExpanded) EL.statusText.classList.remove('expanded'); _statusExpanded = false; }
}

/* ── 滑块动画 ── */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function fmtVal(v) { return Number.isInteger(v) ? String(v) : (+v).toFixed(1); }
function runSliderAnim(slider, from, to, display, onDone) {
  const prevStep = slider.step || '0.5';
  slider.step = '0.01'; slider.value = from; display.textContent = fmtVal(from);
  slider.style.pointerEvents = 'none';
  const t0 = performance.now();
  let cancelled = false, rafId = 0;
  function frame(now) {
    if (cancelled) return;
    const t = Math.min(1, (now - t0) / SLIDER_ANIM_MS);
    const e = easeOutCubic(t);
    const v = from + (to - from) * e;
    slider.value = v; display.textContent = fmtVal(v);
    if (t < 1) { rafId = requestAnimationFrame(frame); }
    else { slider.step = prevStep; slider.value = to; display.textContent = fmtVal(to); slider.style.pointerEvents = ''; if (onDone) onDone(); }
  }
  rafId = requestAnimationFrame(frame);
  return function cancel() {
    if (cancelled) return;
    cancelled = true; cancelAnimationFrame(rafId);
    slider.step = prevStep; slider.style.pointerEvents = '';
  };
}
function stopHAnim() { if (hAnimCancel) { hAnimCancel(); hAnimCancel = null; } }
function stopLAnim() { if (lAnimCancel) { lAnimCancel(); lAnimCancel = null; } }
function resetHeightSlider() { EL.heightSlider.step = '0.5'; EL.heightSlider.value = H_MIN; EL.heightDisplay.textContent = fmtVal(H_MIN); }
function resetLegSlider() { EL.legSlider.step = '0.5'; EL.legSlider.value = L_MIN; EL.legDisplay.textContent = fmtVal(L_MIN); }
function triggerStrDisplayPop() { const el = EL.strDisplay; if (!el || el.style.display === 'none') return; el.classList.remove('str-display-pop'); void el.offsetWidth; el.classList.add('str-display-pop'); }
function onHeightToggle() {
  if (isRec) {
    isRec = false; isLeg = false; stopHAnim(); stopLAnim(); hAnimActive = false; lAnimActive = false;
    applyToggleUI(); clearNodeHighlight();
    setTimeout(() => { if (!isRec) { resetHeightSlider(); resetLegSlider(); update(); } }, 300);
  } else {
    isRec = true; stopHAnim(); stopLAnim(); resetHeightSlider(); applyToggleUI();
    hAnimActive = true; quickAnimate = true;
    hAnimCancel = runSliderAnim(EL.heightSlider, H_MIN, H_DEFAULT, EL.heightDisplay, () => { hAnimCancel = null; hAnimActive = false; update(); });
    requestAnimationFrame(() => { if (!isRec) return; update(); setTimeout(() => { quickAnimate = false; }, 400); });
  }
}
function onLegToggle() {
  if (!isRec) return;
  if (isLeg) {
    isLeg = false; stopLAnim(); lAnimActive = false;
    applyToggleUI(); update();
    setTimeout(() => { if (!isLeg) resetLegSlider(); }, 300);
  } else {
    isLeg = true; stopLAnim(); resetLegSlider(); applyToggleUI();
    lAnimActive = true; quickAnimate = true;
    lAnimCancel = runSliderAnim(EL.legSlider, L_MIN, L_DEFAULT, EL.legDisplay, () => { lAnimCancel = null; lAnimActive = false; update(); });
    requestAnimationFrame(() => { if (!isLeg) return; update(); setTimeout(() => { quickAnimate = false; }, 400); });
  }
}
function applyToggleUI() {
  if (!isRec) isLeg = false;
  EL.heightToggle.classList.toggle('active', isRec);
  EL.heightToggle.textContent = isRec ? '◉' : '○';
  EL.heightToggle.setAttribute('aria-pressed', isRec ? 'true' : 'false');
  EL.heightRow.classList.toggle('disabled', !isRec);
  EL.legToggle.disabled = !isRec;
  EL.legToggle.classList.toggle('active', isLeg);
  EL.legToggle.textContent = isLeg ? '◉' : '○';
  EL.legToggle.setAttribute('aria-pressed', isLeg ? 'true' : 'false');
  EL.legRow.classList.toggle('disabled', !isLeg);
  EL.legHintOuter.classList.toggle('show', isLeg);
  EL.algoSelect.disabled = !isRec;
}

/* ── 品牌芯片（彩条） ── */
function svgLock() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0;display:block;margin:-1px;" aria-hidden="true">'
    + '<path d="M4.2 6 V4 a2.8 2.8 0 0 1 5.6 0 V6" fill="none" stroke="#1e8449" stroke-width="1.7" stroke-linecap="round"/>'
    + '<rect x="2.6" y="6" width="8.8" height="6.2" rx="1.3" fill="#1e8449"/></svg>';
}
function chartLockSvg(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 14 14" style="display:block;flex-shrink:0;" aria-hidden="true">'
    + '<path d="M4.2 6 V4 a2.8 2.8 0 0 1 5.6 0 V6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>'
    + '<rect x="2.6" y="6" width="8.8" height="6.2" rx="1.3" fill="#fff" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>'
    + '<path d="M4.2 6 V4 a2.8 2.8 0 0 1 5.6 0 V6" fill="none" stroke="#1e8449" stroke-width="1.7" stroke-linecap="round"/>'
    + '<rect x="2.6" y="6" width="8.8" height="6.2" rx="1.3" fill="#1e8449"/></svg>';
}
function svgSym(sym, color) {
  const s = '<svg width="12" height="12" viewBox="0 0 12 12" style="flex-shrink:0;display:block;">', e = '</svg>';
  switch (sym) {
    case 'circle': return s + '<circle cx="6" cy="6" r="5" fill="' + color + '"/>' + e;
    case 'triangle': return s + '<polygon points="6,1.5 1,10.5 11,10.5" fill="' + color + '"/>' + e;
    case 'diamond': return s + '<polygon points="6,1 11,6 6,11 1,6" fill="' + color + '"/>' + e;
    case 'rect': return s + '<rect x="1.5" y="1.5" width="9" height="9" fill="' + color + '"/>' + e;
    case 'roundRect': return s + '<rect x="1.5" y="1.5" width="9" height="9" rx="2.8" fill="' + color + '"/>' + e;
    case 'pin': return s + '<circle cx="6" cy="5" r="4" fill="' + color + '"/><polygon points="6,11.5 3.5,5.5 8.5,5.5" fill="' + color + '"/>' + e;
  }
  return s + '<circle cx="6" cy="6" r="5" fill="' + color + '"/>' + e;
}
function renderChips(animate, forSort) {
  const range = computeBarRange(barDim);
  EL.legendChips.innerHTML = ORDER.filter(n => FBD[n]).map((n, i) => {
    const act = sel[n] !== false, foc = (focBrand === n);
    const locked = (lockFocus && focBrand === n);
    const pct = computeBarPct(n, barDim, range);
    let cls = 'legend-chip' + (act ? ' active' : '') + (foc ? ' focused' : '') + (locked ? ' locked' : '');
    let sty = '';
    if (animate && !forSort) { cls += ' chip-appear'; sty = ' style="animation-delay:' + Math.min(i * 9, 160) + 'ms"'; }
    const iconHtml = locked ? svgLock() : svgSym(SYM[n] || 'circle', FBD[n].color);
    return '<button type="button" class="' + cls + '"' + sty + ' data-brand="' + n + '">' + iconHtml + '<span class="chip-name">' + n + '</span><span class="chip-progress-track"><span class="chip-progress-bar" style="width:' + pct.toFixed(1) + '%;background:' + FBD[n].color + '"></span></span></button>';
  }).join('');
  if (animate && forSort) {
    const chips = Array.from(EL.legendChips.querySelectorAll('.legend-chip'));
    if (chips.length > 0) {
      const tops = chips.map(c => Math.round(c.offsetTop));
      const uniqueTops = Array.from(new Set(tops)).sort((a, b) => a - b).slice(0, 5);
      const topSet = new Set(uniqueTops);
      let idx = 0;
      const applied = [];
      chips.forEach((chip, i) => {
        if (topSet.has(tops[i])) { chip.style.setProperty('--chip-i', idx++); chip.classList.add('chip-appear-sort'); applied.push(chip); }
      });
      setTimeout(() => { applied.forEach(chip => { chip.classList.remove('chip-appear-sort'); chip.style.removeProperty('--chip-i'); }); }, 900);
    }
  } else if (animate) {
    setTimeout(() => { EL.legendChips.querySelectorAll('.chip-appear').forEach(el => { el.classList.remove('chip-appear'); el.style.animationDelay = ''; }); }, 420);
  }
}
function syncToggle() {
  const count = ORDER.filter(n => sel[n] !== false).length;
  const multi = count >= 2;
  $('toggleAllBtn').textContent = multi ? '取消所有' : '选中所有';
  $('toggleAllBtn').classList.toggle('active', multi);
}
function updFocusUI() { $('focusToggle').textContent = isFocus ? '聚焦◉' : '聚焦○'; $('focusToggle').classList.toggle('active', isFocus); }
function toggleAll() {
  const count = ORDER.filter(n => sel[n] !== false).length;
  if (count >= 2) {
    if (focBrand) lastFocusedBrand = focBrand;
    ORDER.forEach(n => { sel[n] = false; });
    focBrand = null; lockFocus = false;
  } else {
    ORDER.forEach(n => { sel[n] = true; });
    if (isFocus) {
      if (lastFocusedBrand && FBD[lastFocusedBrand]) focBrand = lastFocusedBrand;
      else if (!focBrand || !FBD[focBrand]) focBrand = ORDER.find(b => FBD[b]) || null;
    } else { focBrand = null; }
    lockFocus = false; updFocusUI();
  }
  renderChips(false); syncToggle(); clearNodeHighlight();
}
function scrollChipIntoView(brand) {
  const scroller = EL.chipsScroll;
  const chip = EL.legendChips.querySelector('[data-brand="' + brand + '"]');
  if (!scroller || !chip) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const viewH = scroller.clientHeight, PAD = 8;
  const relTop = chipRect.top - scrollerRect.top;
  const relBottom = chipRect.bottom - scrollerRect.top;
  if (relTop >= PAD && relBottom <= viewH - PAD) return;
  let target;
  if (relTop < PAD) target = scroller.scrollTop + relTop - PAD;
  else target = scroller.scrollTop + relBottom - viewH + PAD;
  target = Math.max(0, Math.min(target, scroller.scrollHeight - viewH));
  scroller.scrollTo({ top: target, behavior: 'smooth' });
}
function ensureFocus() { if (isFocus && !focBrand) { const f = ORDER.find(b => sel[b] !== false && FBD[b]); if (f) focBrand = f; } }

/* ── 手风琴数据表 ── */
function rebuildAccordion() {
  EL.accordionContainer.innerHTML = '';
  let allHtml = '';
  ORDER.forEach(b => {
    const bd = FBD[b]; if (!bd) return;
    let h = '<table class="data-table"><thead><tr>';
    bd.columns.forEach(c => { const hid = HIDDEN_TABLE_COLS.has(c); h += '<th' + (hid ? ' class="col-hidden"' : '') + '>' + c + '</th>'; });
    h += '</tr></thead><tbody>';
    bd.rows.forEach(r => { h += '<tr>'; r.forEach((c, i) => { const hid = HIDDEN_TABLE_COLS.has(bd.columns[i]); h += '<td' + (hid ? ' class="col-hidden"' : '') + '>' + c + '</td>'; }); h += '</tr>'; });
    h += '</tbody></table>';
    allHtml += '<div class="accordion-item" data-brand="' + b + '"><div class="accordion-header"><span><span class="brand-color-bar" style="background:' + bd.color + '"></span>' + b + ' 几何数据</span><span class="accordion-icon">▼</span></div><div class="accordion-content"><div class="accordion-content-inner">' + h + '</div></div></div>';
  });
  EL.accordionContainer.innerHTML = allHtml;
}
function reorderAccordion() {
  const box = EL.accordionContainer;
  const map = {};
  box.querySelectorAll('.accordion-item').forEach(el => { map[el.dataset.brand] = el; });
  ORDER.forEach(b => { if (map[b]) box.appendChild(map[b]); });
}
function togAcc(el) { const c = el.nextElementSibling; if (!el.classList.contains('active')) { el.classList.add('active'); c.style.maxHeight = c.scrollHeight + 'px'; } else { el.classList.remove('active'); c.style.maxHeight = null; } }

/* ── 节点弹窗 ── */
function positionNodePopup(el) {
  const gap = 14;
  let ax = tooltipAnchor ? tooltipAnchor.x : 0, ay = tooltipAnchor ? tooltipAnchor.y : 0;
  if (!isFinite(ax)) ax = 0;
  if (!isFinite(ay)) ay = 0;
  const wrapper = document.querySelector('.chart-main-wrapper');
  const W = wrapper ? wrapper.clientWidth : (el.parentElement ? el.parentElement.clientWidth : 440);
  const H = wrapper ? wrapper.clientHeight : (el.parentElement ? el.parentElement.clientHeight : 380);
  const pw = el.offsetWidth || 200, ph = el.offsetHeight || 100;
  const MARGIN = 6;
  let left = ax + gap;
  if (left + pw > W - MARGIN) left = ax - gap - pw;
  if (left < MARGIN) left = MARGIN;
  if (left + pw > W - MARGIN) left = Math.max(MARGIN, W - pw - MARGIN);
  let top = ay + gap;
  if (top + ph > H - MARGIN) top = ay - gap - ph;
  if (top < MARGIN) top = MARGIN;
  if (top + ph > H - MARGIN) top = Math.max(MARGIN, H - ph - MARGIN);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function showNodePopup(brand, sizeName) {
  if (!FBD[brand]) return;
  const bd = FBD[brand];
  const it = bd.recommendData.find(x => x.size === sizeName);
  if (!it) return;
  const lv = +EL.legSlider.value;
  const el = EL.nodePopup;
  let html = '<div class="np-row"><b>' + brand + '</b></div>';
  html += '<div class="np-row">尺码: ' + it.size + '</div>';
  html += '<div class="np-row">Reach: <span class="np-val">' + it.reach + ' mm</span></div>';
  html += '<div class="np-row">Stack: <span class="np-val">' + it.stack + ' mm</span></div>';
  if (it.reach && it.stack && it.reach > 0) { html += '<div class="np-row">STR: <span class="np-val">' + (it.stack / it.reach).toFixed(3) + '</span></div>'; }
  if (it.seatAngle != null) { html += '<div class="np-row">立管角度: <span class="np-val">' + it.seatAngle.toFixed(1) + '°</span></div>'; }
  if (it.standover !== undefined && it.standover !== null && !(isLeg && lv > 0)) { html += '<div class="np-row"><span class="np-key">车架跨高:</span> ' + it.standover + ' mm</div>'; }
  if (isLeg && lv > 0 && it.standover !== undefined && it.standover !== null) {
    const diff = Math.round(lv * 10 - it.standover);
    const sm = getSM(it.standover);
    let bg, fg, bd2, label;
    if (diff >= sm) { bg = '#e8f8ef'; fg = '#1e7e34'; bd2 = '#27ae60'; label = '安全'; }
    else if (diff >= 0) { bg = '#fff5e6'; fg = '#c05600'; bd2 = '#e67e22'; label = '危险'; }
    else { bg = '#fdecea'; fg = '#c0392b'; bd2 = '#e53935'; label = '完全不可以'; }
    const sup = (diff >= sm) ? '' : ' ⚠';
    html += '<div class="np-divider" style="font-size:11.5px;color:#555;">安全界限: <b>' + sm + ' mm</b><br/>车架跨高: ' + it.standover + ' mm</div>';
    html += '<div class="np-diff" style="background:' + bg + ';color:' + fg + ';border:1px solid ' + bd2 + ';">差值 <b>' + diff + ' mm</b>（' + label + '）' + sup + '</div>';
  }
  if (bd.variants) {
    html += '<div class="np-divider"><div class="np-btns">';
    for (const key in bd.variants) { const v = bd.variants[key]; html += '<span class="np-btn' + (key === bd.currentVariant ? ' active' : '') + '" data-variant="' + key + '">' + v.label + '</span>'; }
    html += '</div><div class="np-hint">💡 该车架支持定制几何</div></div>';
  }
  if (!isFocus && !focBrand) { html += '<div class="np-divider np-focus-row"><button type="button" class="np-btn-focus" data-brand="' + brand + '">开启聚焦</button></div>'; }
  el.innerHTML = html;
  el.classList.add('show');
  positionNodePopup(el);
}
function hideNodePopup() { if (EL.nodePopup) EL.nodePopup.classList.remove('show'); }
function unpinTooltip() { pinnedTip = null; tooltipAnchor = null; }
function clearNodeHighlight() {
  unpinTooltip(); tooltipAnchor = null;
  clickCycle = { x: -9999, y: -9999, candidates: [], index: -1 };
  clicked = []; hideNodePopup(); update();
}
function collectNearbyNodes(px, py) {
  const THRESHOLD = IS_TOUCH ? 30 : 22, TH2 = THRESHOLD * THRESHOLD;
  const out = [];
  ORDER.forEach(brand => {
    if (sel[brand] === false || !FBD[brand]) return;
    if (isFocus && focBrand !== null && brand !== focBrand) return;
    const sz = FBD[brand].recommendData;
    if (!sz) return;
    for (let i = 0; i < sz.length; i++) {
      const pt = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [sz[i].reach, sz[i].stack]);
      if (!pt) continue;
      const dx = pt[0] - px, dy = pt[1] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < TH2) out.push({ brand, dataIndex: i, dist: d2 });
    }
  });
  out.sort((a, b) => a.dist - b.dist);
  return out;
}
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function findNearestSegmentPoint(px, py) {
  const THRESHOLD = IS_TOUCH ? 26 : 15;
  let best = null;
  ORDER.forEach(brand => {
    if (sel[brand] === false || !FBD[brand]) return;
    if (isFocus && focBrand !== null && brand !== focBrand) return;
    const sz = FBD[brand].recommendData;
    if (!sz || sz.length < 2) return;
    const pts = sz.map(it => chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [it.reach, it.stack]));
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      const d = distToSegment(px, py, p1[0], p1[1], p2[0], p2[1]);
      if (d < THRESHOLD && (!best || d < best.dist)) {
        const d1 = Math.hypot(px - p1[0], py - p1[1]), d2 = Math.hypot(px - p2[0], py - p2[1]);
        best = { brand, dataIndex: (d1 <= d2 ? i : i + 1), dist: d };
      }
    }
  });
  return best;
}
function pinTooltipToSize(brand, dataIndex) {
  if (!FBD[brand]) return;
  const sz = FBD[brand].recommendData;
  if (!sz || !sz[dataIndex]) return;
  const sizeName = sz[dataIndex].size;
  pinnedTip = { brand, sizeName };
  const px = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [sz[dataIndex].reach, sz[dataIndex].stack]);
  if (px) tooltipAnchor = { x: px[0], y: px[1] };
  clicked = [{ value: [sz[dataIndex].reach, sz[dataIndex].stack], itemStyle: { color: FBD[brand].color } }];
  update();
  showNodePopup(brand, sizeName);
}

/* ── 锁定标记 ── */
(function initChartLockMarker() { if (EL.chartLockMarker) EL.chartLockMarker.innerHTML = chartLockSvg(20); })();
function updateChartLockMarker() {
  const el = EL.chartLockMarker;
  if (!el) return;
  const brand = (isFocus && lockFocus && focBrand && FBD[focBrand] && sel[focBrand] !== false) ? focBrand : null;
  if (!brand) {
    if (_lockShown) {
      _lockShown = false; _lockBrand = null; clearTimeout(_lockHideTimer);
      el.classList.remove('show'); el.classList.add('hide');
      _lockHideTimer = setTimeout(() => { el.style.display = 'none'; el.classList.remove('hide'); }, 280);
    }
    return;
  }
  const sz = FBD[brand].recommendData;
  if (!sz || !sz.length) return;
  const midIdx = Math.floor((sz.length - 1) / 2);
  const anchor = sz[midIdx];
  const pt = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [anchor.reach, anchor.stack]);
  if (!pt || !isFinite(pt[0]) || !isFinite(pt[1])) return;
  const wrapper = document.querySelector('.chart-main-wrapper');
  const W = wrapper ? wrapper.clientWidth : 440;
  const H = wrapper ? wrapper.clientHeight : 260;
  const HALF = 15, GAP = 15;
  let left = pt[0] - GAP - HALF, top = pt[1];
  left = Math.min(W - HALF, Math.max(HALF, left));
  top = Math.min(H - HALF, Math.max(HALF, top));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  if (!_lockShown || _lockBrand !== brand) {
    _lockShown = true; _lockBrand = brand; clearTimeout(_lockHideTimer);
    el.classList.remove('hide'); el.classList.remove('show');
    el.style.display = 'block';
    void el.offsetWidth;
    requestAnimationFrame(() => el.classList.add('show'));
  }
}

/* ── STR / 跨高信息胶囊 ── */
function currentFocusItem() {
  let brand = isFocus ? focBrand : (pinnedTip ? pinnedTip.brand : null);
  if (!brand) brand = ORDER.find(n => sel[n] !== false && FBD[n]);
  if (!brand || !FBD[brand]) return null;
  const sz = FBD[brand].recommendData;
  if (!sz || !sz.length) return null;
  let idx = -1;
  if (isRec) {
    const h = hAnimActive ? H_DEFAULT : +EL.heightSlider.value;
    idx = bestSize(sz, h, L_DEFAULT, false);
    if (idx < 0) idx = Math.floor(sz.length / 2);
  }
  if (idx < 0) idx = Math.floor(sz.length / 2);
  const it = sz[idx];
  return it ? { brand, item: it, size: it.size } : null;
}
function updateStrDisplay() {
  const el = EL.strDisplay;
  if (!el) return;
  if (!isFocus || !focBrand) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const mode = isRec ? 'standover' : 'str';
  const cur = currentFocusItem();
  if (!cur) {
    el.classList.toggle('standover-mode', mode === 'standover');
    el.innerHTML = mode === 'standover' ? '<span class="str-info-btn">i</span><span>跨高 —</span>' : '<span>STR —</span>';
  } else {
    const it = cur.item, brandName = cur.brand;
    if (isRec) {
      el.classList.add('standover-mode');
      if (it.standover === undefined || it.standover === null) { el.innerHTML = '<span class="str-info-btn">i</span><span><span class="str-brand">' + brandName + '</span> · ' + it.size + ' · 跨高 —</span>'; }
      else {
        const sm = getSM(it.standover), minLeg = it.standover + sm;
        let valColor = '';
        if (isLeg) { const userLeg = lAnimActive ? L_DEFAULT * 10 : +EL.legSlider.value * 10; if (userLeg >= minLeg) valColor = '#27ae60'; else if (minLeg - userLeg < 15) valColor = '#e6a100'; else valColor = '#e53935'; }
        const valStyle = valColor ? ' style="color:' + valColor + '"' : '';
        el.innerHTML = '<span class="str-info-btn">i</span><span><span class="str-brand">' + brandName + '</span> · ' + it.size + '码 · 最低跨高 <span class="str-value"' + valStyle + '>≥ ' + minLeg + ' mm</span></span>';
      }
    } else {
      el.classList.remove('standover-mode');
      if (!it.reach || !it.stack) { el.innerHTML = '<span class="str-info-btn">i</span><span><span class="str-brand">' + brandName + '</span> · STR —</span>'; }
      else {
        const avg = FBD[cur.brand]._avgSTR;
        if (!avg || avg >= 900) { el.innerHTML = '<span class="str-info-btn">i</span><span><span class="str-brand">' + brandName + '</span> · STR —</span>'; }
        else { el.innerHTML = '<span class="str-info-btn">i</span><span><span class="str-brand">' + brandName + '</span> · STR · 平均值：<span class="str-value">' + avg.toFixed(3) + '</span></span>'; }
      }
    }
  }
  if (mode !== _lastStrMode) { _lastStrMode = mode; triggerStrDisplayPop(); }
}
function renderStrList() {
  const arr = ORDER.map(b => ({ b, str: avgSTR(b) })).filter(x => x.str > 0 && x.str < 900);
  arr.sort((a, b2) => strSortDir === 'aggressive' ? a.str - b2.str : b2.str - a.str);
  const html = arr.map((x, i) => { const c = FBD[x.b] ? FBD[x.b].color : '#888'; return '<div class="str-row"><span class="str-rank">' + (i + 1) + '</span><span class="str-dot" style="background:' + c + '"></span><span class="str-brand">' + x.b + '</span><span class="str-num">' + x.str.toFixed(3) + '</span></div>'; }).join('');
  const container = $('strModalContent');
  if (isRec) {
    const cur = currentFocusItem();
    let curLine = '';
    if (cur && cur.item.standover !== undefined && cur.item.standover !== null) {
      const sm = getSM(cur.item.standover), minLeg = cur.item.standover + sm;
      curLine = '<p style="background:#fff5eb;border-left:4px solid #e67e22;padding:10px 12px;border-radius:6px;margin:10px 0;"><strong>当前聚焦：</strong>' + cur.brand + ' · ' + cur.item.size + '<br/>车架跨高：<strong>' + cur.item.standover + ' mm</strong> ｜ 安全界限：<strong>' + sm + ' mm</strong> ｜ 最低要求跨高：<strong>≥ ' + minLeg + ' mm</strong></p>';
    }
    container.innerHTML = '<p><strong>什么是跨高（Standover）？</strong>车架上管下沿到地面的垂直高度。</p>'
      + '<p><strong>为什么需要安全界限？</strong>停车下车站立瞬间，髋部会自然下沉，车架上管离双腿越近越容易碰撞。骑手跨高必须大于「车架跨高 + 安全界限」。</p>'
      + '<p><strong>安全界限基于车架跨高动态计算：</strong>≤65cm 时为 1.0cm，≥90cm 时为 3.0cm，中间线性插值（每增加 1cm 车架跨高，安全界限增加约 0.08cm）。</p>'
      + '<p><strong>图表左下角的「最低跨高」：</strong>当前推荐尺码对应的「车架跨高 + 安全界限」的最小值。骑手跨高小于此值时应下修尺码。</p>'
      + curLine
      + '<p style="color:#999;font-size:11.5px;">💡 如需查看各品牌的平均 STR 排行，请关闭「尺码推荐」后再次点击本信息框。</p>';
  } else {
    container.innerHTML = '<div class="str-modal-head"><div class="str-modal-info">STR = Stack ÷ Reach。数值越低越激进，越高越耐力。本表为各车型全尺码 STR 的平均值。</div><button type="button" class="str-sort-btn" id="strSortToggle">' + (strSortDir === 'aggressive' ? '激进 → 耐力' : '耐力 → 激进') + '</button></div><div id="strList">' + html + '</div>';
    const btn = $('strSortToggle');
    if (btn) { btn.addEventListener('click', () => { strSortDir = strSortDir === 'aggressive' ? 'endurance' : 'aggressive'; renderStrList(); }); }
  }
}
function showStrModal() { document.getElementById('strModalTitle').textContent = isRec ? '跨高安全说明' : '平均 STR 排行'; renderStrList(); document.getElementById('strModal').classList.add('show'); }
function hideStrModal() { document.getElementById('strModal').classList.remove('show'); }

/* ── 事件绑定 ── */
EL.legendChips.addEventListener('click', e => {
  if (chipsDrag.justDragged) return;
  const chip = e.target.closest('.legend-chip');
  if (!chip) return;
  const b = chip.dataset.brand;
  if (!b || !FBD[b]) return;
  const wasSel = sel[b] !== false;
  const wasFoc = (focBrand === b);
  if (isFocus) {
    if (focBrand === b) {
      if (!lockFocus) { lockFocus = true; }
      else { sel[b] = false; focBrand = null; lockFocus = false; ensureFocus(); }
    } else { if (sel[b] === false) sel[b] = true; focBrand = b; lockFocus = false; }
  } else { sel[b] = (sel[b] === false); }
  const nowSel = sel[b] !== false;
  const nowFoc = (focBrand === b);
  if ((!wasSel && nowSel) || (!wasFoc && nowFoc)) { _brandGen[b] = (_brandGen[b] || 0) + 1; }
  clearNodeHighlight();
  renderChips(false); syncToggle(); update();
});
$('focusToggle').addEventListener('click', () => {
  isFocus = !isFocus;
  if (!isFocus) { focBrand = null; lockFocus = false; }
  ensureFocus(); clearNodeHighlight();
  updFocusUI(); renderChips(false); update();
});
const chipsDrag = { active: false, startY: 0, startX: 0, scrollTop: 0, moved: false, justDragged: false, pointerId: null };
(function initChipsDrag() {
  const el = EL.chipsScroll;
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    chipsDrag.active = true; chipsDrag.moved = false;
    chipsDrag.startY = e.clientY; chipsDrag.startX = e.clientX;
    chipsDrag.scrollTop = el.scrollTop; chipsDrag.pointerId = e.pointerId;
    el.classList.add('dragging');
  });
  document.addEventListener('pointermove', e => {
    if (!chipsDrag.active || e.pointerId !== chipsDrag.pointerId) return;
    const dy = e.clientY - chipsDrag.startY, dx = e.clientX - chipsDrag.startX;
    if (!chipsDrag.moved && Math.hypot(dx, dy) > 6) chipsDrag.moved = true;
    if (chipsDrag.moved) { el.scrollTop = chipsDrag.scrollTop - dy; if (e.cancelable) e.preventDefault(); }
  }, { passive: false });
  function endDrag(e) {
    if (!chipsDrag.active) return;
    if (e && e.pointerId !== undefined && e.pointerId !== chipsDrag.pointerId) return;
    if (chipsDrag.moved) { chipsDrag.justDragged = true; setTimeout(() => { chipsDrag.justDragged = false; }, 150); }
    chipsDrag.active = false; chipsDrag.pointerId = null; el.classList.remove('dragging');
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  el.addEventListener('click', e => { if (chipsDrag.justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
})();
$('toggleAllBtn').addEventListener('click', toggleAll);
EL.sortSelect.addEventListener('change', onSortChange);
EL.barSelect.addEventListener('change', onBarChange);
$('barHelpBtn').addEventListener('click', showBarHelpModal);
EL.algoSelect.addEventListener('change', () => { algoMode = EL.algoSelect.value; update(); });
$('searchConfirmBtn').addEventListener('click', () => commitSearch());
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitSearch(); } });
$('searchInput').addEventListener('blur', () => { const ov = $('searchOverlay'); if (!ov || ov.classList.contains('hidden')) return; commitSearch(); });
EL.heightToggle.addEventListener('click', onHeightToggle);
EL.legToggle.addEventListener('click', onLegToggle);
EL.heightLabelHit.addEventListener('click', onHeightToggle);
EL.legLabelHit.addEventListener('click', () => { if (isRec) onLegToggle(); });
EL.heightSlider.addEventListener('input', () => { if (isRec && !hAnimActive) scheduleUpdate(); });
EL.legSlider.addEventListener('input', () => { if (isRec && isLeg && !lAnimActive) scheduleUpdate(); });
EL.heightSlider.addEventListener('change', () => { if (isRec && !hAnimActive) update(); });
EL.legSlider.addEventListener('change', () => { if (isRec && isLeg && !lAnimActive) update(); });
$('heightMinus').addEventListener('click', e => { e.preventDefault(); if (!isRec || hAnimActive) return; const v = Math.max(H_MIN, +EL.heightSlider.value - 0.5); EL.heightSlider.value = v; update(); });
$('heightPlus').addEventListener('click', e => { e.preventDefault(); if (!isRec || hAnimActive) return; const v = Math.min(H_MAX, +EL.heightSlider.value + 0.5); EL.heightSlider.value = v; update(); });
$('legMinus').addEventListener('click', e => { e.preventDefault(); if (!isRec || !isLeg || lAnimActive) return; const v = Math.max(L_MIN, +EL.legSlider.value - 0.5); EL.legSlider.value = v; update(); });
$('legPlus').addEventListener('click', e => { e.preventDefault(); if (!isRec || !isLeg || lAnimActive) return; const v = Math.min(L_MAX, +EL.legSlider.value + 0.5); EL.legSlider.value = v; update(); });
$('dataSectionToggle').addEventListener('click', function () { this.classList.toggle('active'); $('dataSectionContent').classList.toggle('expanded'); });
EL.accordionContainer.addEventListener('click', e => { const h = e.target.closest('.accordion-header'); if (h) togAcc(h); });
document.getElementById('miniChartWrapper').addEventListener('click', e => { e.stopPropagation(); showMiniInfoModal(); });
if ($('miniInfoBtn')) $('miniInfoBtn').addEventListener('click', e => { e.stopPropagation(); showMiniInfoModal(); });
chart.getZr().on('click', e => {
  const px = e.offsetX, py = e.offsetY;
  const nearby = collectNearbyNodes(px, py);
  if (nearby.length > 0) {
    const sameArea = Math.hypot(px - clickCycle.x, py - clickCycle.y) < 12;
    if (!sameArea) { clickCycle.candidates = nearby; clickCycle.index = 0; clickCycle.x = px; clickCycle.y = py; }
    else { clickCycle.index = (clickCycle.index + 1) % clickCycle.candidates.length; }
    const cand = clickCycle.candidates[clickCycle.index];
    pinTooltipToSize(cand.brand, cand.dataIndex);
    return;
  }
  clickCycle.candidates = [];
  const hit = findNearestSegmentPoint(px, py);
  if (hit) { pinTooltipToSize(hit.brand, hit.dataIndex); return; }
  if (pinnedTip || clicked.length) clearNodeHighlight();
});
document.addEventListener('click', e => {
  const focusBtn = e.target.closest('.np-btn-focus');
  if (focusBtn) {
    e.stopPropagation();
    const brand = focusBtn.dataset.brand;
    if (brand && FBD[brand]) {
      unpinTooltip(); clicked = [];
      clickCycle = { x: -9999, y: -9999, candidates: [], index: -1 };
      hideNodePopup();
      if (sel[brand] === false) sel[brand] = true;
      focBrand = brand; isFocus = true; lockFocus = true;
      updFocusUI(); renderChips(false); syncToggle(); update();
      setTimeout(() => scrollChipIntoView(brand), 60);
    }
    return;
  }
  const variantBtn = e.target.closest('.np-btn');
  if (variantBtn && variantBtn.dataset.variant) {
    e.stopPropagation();
    const variant = variantBtn.dataset.variant;
    if (!DATA['Incolor SSR'] || !DATA['Incolor SSR'].variants) return;
    rebuildIncolorData('Incolor SSR', variant);
    update();
    if (pinnedTip) showNodePopup(pinnedTip.brand, pinnedTip.sizeName);
    return;
  }
  if (!pinnedTip && !clicked.length) return;
  const mainEl = $('main'), popEl = EL.nodePopup;
  if (mainEl && mainEl.contains(e.target)) return;
  if (popEl && popEl.contains(e.target)) return;
  clearNodeHighlight();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideAlgoModal(); hideStrModal(); hideBarHelpModal(); hideMiniInfoModal(); } });

window.addEventListener('pageshow', scheduleForceSync);
window.addEventListener('popstate', scheduleForceSync);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleForceSync(); });
window.addEventListener('focus', scheduleForceSync);
document.addEventListener('focusin', scheduleForceSync);
window.addEventListener('load', scheduleForceSync);

let lastW = 0, resizeScheduled = false;
function handleResize() {
  if (resizeScheduled) return;
  resizeScheduled = true;
  requestAnimationFrame(() => {
    resizeScheduled = false;
    const w = getContainerWidth();
    if (Math.abs(w - lastW) < 1) return;
    lastW = w;
    chart.resize(); miniChart.resize();
    update(); updateChartLockMarker();
  });
}
lastW = getContainerWidth();
if (window.ResizeObserver) { new ResizeObserver(handleResize).observe(document.querySelector('.chart-main-wrapper')); }
window.addEventListener('resize', handleResize);

/* ── 初始化 ── */
buildFBD();
adjustRecommendations();
fillHeightGaps();
computeAverages();
rebuildAccordion();
$('brandCount').textContent = ORDER.length;
$('lastUpdate').textContent = LAST_UPDATE;
rebuildSortSelect(); rebuildBarSelect(); refreshSortKind();
pickRandomSelection();
updFocusUI(); syncToggle(); ensureFocus(); renderChips(false);
applyToggleUI();
applyHeight(); chart.resize(); miniChart.resize();
chart.setOption({ series: [] }, true);
setTimeout(() => {
  applyHeight(); chart.resize(); miniChart.resize();
  chart.setOption(buildOption(H_MIN, L_MIN, false, false), true);
  updateMiniChart(); updateChartLockMarker();
}, 80);
