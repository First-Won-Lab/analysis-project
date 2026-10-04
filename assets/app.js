/* app.js - 화면 동작. 계산과 CSV 행 생성은 모두 analysis.js 에 있다. */
(function () {
  'use strict';
  const A = window.Analysis;
  const $ = (id) => document.getElementById(id);

  // ---------- 공통 유틸 ----------
  const MINUS = '−';
  const fmtMHz = (hz, d = 2) => (hz / 1e6).toFixed(d);
  const sign = (v, s) => (v > 0 ? '+' : v < 0 ? MINUS : '') + s.replace('-', '');
  const sMHz = (hz) => (hz === null || hz === undefined ? '—' : sign(hz, (hz / 1e6).toFixed(2)));
  const sDb = (v) => (v === null || v === undefined ? '—' : sign(v, v.toFixed(2)));
  const fDb = (v) => (v === null || v === undefined ? '—' : v.toFixed(2));
  const fNcc = (v) => (v === null || v === undefined ? '—' : v.toFixed(3));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nfc = (s) => s.normalize('NFC');

  /** 평균 ± SD 표기. summary = { n, mean, sd } */
  function msd(summary, scale, signed) {
    if (!summary || summary.mean === null) return '—';
    const m = summary.mean / scale;
    const ms = signed ? sign(m, m.toFixed(2)) : m.toFixed(2);
    return summary.sd === null ? ms : `${ms} ± ${(summary.sd / scale).toFixed(2)}`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function readText(file) {
    return file.text ? file.text() : new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
  }

  function downloadCsv(filename, rows) {
    const body = rows.map((r) => r.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  const nextFrame = () => new Promise((r) => setTimeout(r));

  // 드롭된 항목(파일/폴더)을 재귀로 펼쳐 File 목록으로
  async function filesFromDrop(dataTransfer) {
    const items = [...(dataTransfer.items || [])];
    const entries = items.map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return [...dataTransfer.files];
    const out = [];
    async function walk(entry) {
      if (entry.isFile) {
        out.push(await new Promise((res, rej) => entry.file(res, rej)));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batchEntries;
        do {
          batchEntries = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batchEntries) await walk(e);
        } while (batchEntries.length);
      }
    }
    for (const e of entries) await walk(e);
    return out;
  }

  function setupDrop(el, onFiles) {
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); el.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((t) => el.addEventListener(t, (e) => { e.preventDefault(); el.classList.remove('dragover'); }));
    el.addEventListener('drop', async (e) => onFiles(await filesFromDrop(e.dataTransfer)));
  }

  // ---------- 분석 설정 ----------
  let settings = A.withDefaults({});

  function bandRangeText(band) {
    const lo = Number.isFinite(band.lo) ? (band.lo / 1e6).toLocaleString('ko-KR') : null;
    const hi = Number.isFinite(band.hi) ? (band.hi / 1e6).toLocaleString('ko-KR') : null;
    if (lo === null) return `~${hi} MHz`;
    if (hi === null) return `${lo} MHz~`;
    return `${lo}–${hi} MHz`;
  }

  function fillSettings() {
    ['set-b1', 'set-b2', 'set-b3'].forEach((id, i) => { $(id).value = settings.bounds[i] / 1e6; });
    $('set-prom').value = settings.minProminence;
    $('settings-summary').textContent = '· ' + A.bandRanges(settings.bounds).map((b) => `${b.name} ${bandRangeText(b)}`).join(' · ') +
      ` · 최소 돌출도 ${settings.minProminence} dB`;
  }

  async function applySettings(next) {
    settings = A.withDefaults(next);
    fillSettings();
    if (pairState) renderPair();
    if (batch) { await computeBands(); renderBatch(); }
  }

  $('set-apply').addEventListener('click', () => {
    const bounds = ['set-b1', 'set-b2', 'set-b3'].map((id) => parseFloat($(id).value) * 1e6);
    const prom = parseFloat($('set-prom').value);
    const err = $('set-error');
    if (bounds.some((b) => !Number.isFinite(b) || b <= 0) || bounds[0] >= bounds[1] || bounds[1] >= bounds[2]) {
      err.textContent = '대역 경계는 0보다 크고 R1|R2 < R2|R3 < R3|R4 순서여야 합니다.';
      return;
    }
    if (!Number.isFinite(prom) || prom < 0) { err.textContent = '최소 돌출도는 0 이상이어야 합니다.'; return; }
    err.textContent = '';
    applySettings({ bounds, minProminence: prom });
  });
  $('set-reset').addEventListener('click', () => { $('set-error').textContent = ''; applySettings({}); });
  fillSettings();

  // ---------- 그래프 ----------
  function baseLayout() {
    const text = cssVar('--text-secondary');
    const grid = cssVar('--grid');
    return {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: '"Noto Sans KR", system-ui, sans-serif', color: text, size: 12 },
      margin: { l: 56, r: 16, t: 8, b: 48 },
      xaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
      yaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
      hoverlabel: { bgcolor: cssVar('--surface-1'), bordercolor: cssVar('--border'), font: { color: cssVar('--text-primary') } },
      legend: { orientation: 'h', x: 0, y: 1.1, font: { color: cssVar('--text-primary') } },
    };
  }
  const plotConfig = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  /**
   * 두 곡선 + 대역 띠 + 대역별 피크 + 무표정 → 원상태 이동 화살표.
   * highlight: 강조할 대역 번호 (없으면 -1)
   */
  function drawCurves(el, neutral, expressive, bands, highlight) {
    const cN = cssVar('--series-neutral');
    const cE = cssVar('--series-expressive');
    const surface = cssVar('--surface-1');
    const ink = cssVar('--text-primary');
    const narrow = el.clientWidth < 600;
    const ranges = A.bandRanges(settings.bounds);

    const fs = neutral.freq.concat(expressive.freq).map((f) => f / 1e6);
    const ds = neutral.db.concat(expressive.db);
    const x0 = Math.min(...fs);
    const x1 = Math.max(...fs);
    const yTop = Math.max(...ds);
    const yBot = Math.min(...ds);
    const yArrow = yTop + 2;

    const line = (d, name, color) => ({
      x: d.freq.map((f) => f / 1e6), y: d.db, name, type: 'scatter', mode: 'lines',
      line: { color, width: 2 }, hovertemplate: `${name}: %{y:.2f} dB<extra></extra>`,
    });
    const peaks = (key, name, color) => {
      const pts = bands.filter((b) => b[key]);
      return {
        x: pts.map((b) => b[key].hz / 1e6), y: pts.map((b) => b[key].db), type: 'scatter', mode: 'markers',
        name: `${name} 피크`, showlegend: false,
        marker: { color, size: 11, line: { color: surface, width: 2 } },
        customdata: pts.map((b) => [b.band, b[key].prominence.toFixed(2)]),
        hovertemplate: `%{customdata[0]} ${name} 피크<br>%{x:.2f} MHz · %{y:.2f} dB · 돌출도 %{customdata[1]} dB<extra></extra>`,
      };
    };

    const layout = baseLayout();
    layout.xaxis.title = { text: '주파수 (MHz)' };
    layout.xaxis.range = [x0, x1];
    layout.yaxis.title = { text: 'Return Loss (dB)' };
    layout.yaxis.range = [yBot - 2, yTop + 5];
    layout.hovermode = 'closest';
    layout.shapes = ranges.map((r, i) => ({
      type: 'rect', layer: 'below', xref: 'x', yref: 'paper',
      x0: Math.max(r.lo / 1e6, x0), x1: Math.min(r.hi / 1e6, x1), y0: 0, y1: 1,
      fillcolor: cssVar(`--band-${i + 1}`), opacity: highlight === -1 || highlight === i ? 1 : 0.35, line: { width: 0 },
    }));
    layout.annotations = ranges.map((r) => ({
      x: (Math.max(r.lo / 1e6, x0) + Math.min(r.hi / 1e6, x1)) / 2, y: 0, xref: 'x', yref: 'paper', yanchor: 'bottom', yshift: 4,
      text: `<b>${r.name}</b>`, showarrow: false, font: { color: cssVar('--text-secondary'), size: 13 },
    }));
    for (const b of bands) {
      if (!b.neutral || !b.expressive) continue;
      const xn = b.neutral.hz / 1e6;
      const xe = b.expressive.hz / 1e6;
      const color = b.status === 'mismatch' ? cssVar('--warn-ink') : ink;
      layout.annotations.push({
        x: xe, y: yArrow, ax: xn, ay: yArrow, xref: 'x', yref: 'y', axref: 'x', ayref: 'y',
        showarrow: true, arrowhead: 2, arrowsize: 1, arrowwidth: 2, arrowcolor: color, text: '',
      });
      if (!narrow) {
        layout.annotations.push({
          x: (xn + xe) / 2, y: yArrow, xref: 'x', yref: 'y', yshift: 11, showarrow: false,
          text: `${sMHz(b.shiftMin)} MHz${b.status === 'mismatch' ? ' ⚠' : ''}`, font: { color, size: 11 },
        });
      }
    }
    Plotly.react(el, [line(neutral, '무표정', cN), line(expressive, '원상태', cE),
      peaks('neutral', '무표정', cN), peaks('expressive', '원상태', cE)], layout, plotConfig);
  }

  function drawStatBars(el, stats, key, scale, unit) {
    const labels = stats.map((s) => `${A.EXPRESSION_NAMES[s.expr]}·${A.PART_NAMES[s.part]}`);
    const layout = baseLayout();
    layout.showlegend = false;
    layout.margin.b = 64;
    layout.yaxis.title = { text: unit };
    layout.yaxis.zeroline = true;
    layout.yaxis.zerolinecolor = cssVar('--text-muted');
    layout.bargap = 0.45;
    const val = (s) => (s[key].mean === null ? null : s[key].mean / scale);
    Plotly.react(el, [{
      type: 'bar', x: labels, y: stats.map(val),
      marker: { color: cssVar('--chart-bar'), cornerradius: 4 },
      error_y: { type: 'data', array: stats.map((s) => (s[key].sd === null ? 0 : s[key].sd / scale)), color: cssVar('--text-muted'), thickness: 1.5, width: 4 },
      customdata: stats.map((s) => [s[key].n, s[key].sd === null ? '—' : (s[key].sd / scale).toFixed(2)]),
      hovertemplate: `%{x}<br>평균 %{y:+.2f} ${unit}<br>SD %{customdata[1]} · n=%{customdata[0]}<extra></extra>`,
    }], layout, plotConfig);
  }

  // ---------- 상태 표시 ----------
  function statusBadges(b) {
    if (b.status === 'missing') return `<span class="st st-missing">${esc(A.statusLabel(b))}</span>`;
    const main = b.status === 'mismatch' ? '<span class="st st-mismatch">⚠ 불일치</span>' : '<span class="st st-ok">정상</span>';
    return main + (b.shapeChanged ? ' <span class="st st-shape">◐ 모양</span>' : '');
  }

  // ---------- 탭 ----------
  const tabs = [['tab-pair', 'panel-pair'], ['tab-batch', 'panel-batch']];
  tabs.forEach(([tabId]) => $(tabId).addEventListener('click', () => {
    tabs.forEach(([t, p]) => {
      const on = t === tabId;
      $(t).setAttribute('aria-selected', String(on));
      $(p).hidden = !on;
    });
    window.dispatchEvent(new Event('resize')); // 숨겨져 있던 그래프 크기 다시 맞춤
  }));

  // ---------- 2개 파일 비교 ----------
  let pairState = null;

  function showPairError(title, messages) {
    $('pair-result').hidden = true;
    const box = $('pair-error');
    box.innerHTML = `<strong>${esc(title)}</strong><ul>${messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
    box.hidden = false;
  }

  async function handlePairFiles(fileList) {
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name));
    $('pair-error').hidden = true;
    $('pair-files').innerHTML = files.map((f) => `<span class="chip">${esc(nfc(f.name))}</span>`).join('');

    if (files.length !== 2) {
      showPairError('CSV 파일을 정확히 2개 올려 주세요.', [`지금 올린 CSV: ${files.length}개${files.length ? ' — ' + files.map((f) => nfc(f.name)).join(', ') : ''}`]);
      return;
    }
    const check = A.checkPair(files[0].name, files[1].name);
    if (!check.ok) { showPairError('비교할 수 없는 조합이라 비교하지 않았습니다.', check.errors); return; }

    const nFile = files[check.neutral];
    const eFile = files[check.expressive];
    const [n, e] = (await Promise.all([readText(nFile), readText(eFile)])).map(A.parseCsv);
    const failed = [[nFile, n], [eFile, e]].filter(([, d]) => !d.peak).map(([f]) => `숫자 데이터(A열 주파수, B열 dB)를 찾지 못했습니다: ${nfc(f.name)}`);
    if (failed.length) { showPairError('데이터를 읽지 못했습니다.', failed); return; }

    $('pair-files').innerHTML = [[nFile, '--series-neutral', '무표정'], [eFile, '--series-expressive', '원상태']]
      .map(([f, c, l]) => `<span class="chip"><span class="swatch" style="background:var(${c})"></span>${l} · ${esc(nfc(f.name))}</span>`).join('');

    pairState = { n, e, info: check.info };
    renderPair();
  }

  function renderPair() {
    if (!pairState) return;
    const { n, e, info } = pairState;
    const bands = A.compareBands(n, e, settings);
    const ranges = A.bandRanges(settings.bounds);
    $('pair-title').textContent = A.label(info);

    $('pair-cards').innerHTML = bands.map((b, i) => {
      const head = `<div class="bc-head"><b>${b.band}</b> <span class="muted">${bandRangeText(ranges[i])}</span></div>`;
      if (b.status === 'missing') {
        return `<div class="band-card missing">${head}<div class="bc-value muted">피크 없음</div>
          <div class="bc-sub">${esc(A.statusLabel(b))} — 이 대역은 비교에서 제외</div></div>`;
      }
      const arrow = b.shiftMin > 0 ? '→' : b.shiftMin < 0 ? '←' : '·';
      return `<div class="band-card ${b.status}">${head}
        <div class="bc-value">${arrow} ${sMHz(b.shiftMin)} <small>MHz</small></div>
        <div class="bc-sub">모양정렬 ${sMHz(b.shiftShape)} MHz · 상관 ${fNcc(b.ncc)}</div>
        <div class="bc-sub">깊이 ${sDb(b.depthDiff)} dB · 돌출도 ${sDb(b.promDiff)} dB</div>
        <div class="bc-badges">${statusBadges(b)}</div></div>`;
    }).join('');

    $('pair-table').innerHTML = bands.map((b) => {
      const pn = b.neutral;
      const pe = b.expressive;
      return `<tr><td><b>${b.band}</b></td><td>${statusBadges(b)}</td>
        <td class="num">${pn ? fmtMHz(pn.hz) : '—'}</td><td class="num">${pe ? fmtMHz(pe.hz) : '—'}</td>
        <td class="num">${sMHz(b.shiftMin)}</td><td class="num">${sMHz(b.shiftShape)}</td><td class="num">${fNcc(b.ncc)}</td>
        <td class="num">${pn ? fDb(pn.db) : '—'}</td><td class="num">${pe ? fDb(pe.db) : '—'}</td>
        <td class="num">${sDb(b.depthDiff)}</td><td class="num">${sDb(b.promDiff)}</td></tr>`;
    }).join('');

    const lg = A.comparePeaks(n.peak, e.peak);
    $('pair-legacy').textContent = `무표정 ${fmtMHz(n.peak.hz, 3)} MHz, ${n.peak.db.toFixed(2)} dB · 원상태 ${fmtMHz(e.peak.hz, 3)} MHz, ${e.peak.db.toFixed(2)} dB` +
      ` → |Δf| ${fmtMHz(lg.absDeltaHz, 3)} MHz · |ΔdB| ${lg.absDeltaDb.toFixed(4)} (곡선 전체에서 가장 낮은 점 하나끼리 비교)`;

    $('pair-result').hidden = false;
    drawCurves($('pair-chart'), n, e, bands, -1);
  }

  $('pair-input').addEventListener('change', (ev) => { handlePairFiles(ev.target.files); ev.target.value = ''; });
  setupDrop($('pair-drop'), handlePairFiles);

  // ---------- 일괄 비교 ----------
  // batch = { results, curves, unpaired, excluded, duplicates, stats, legacyStats, matrix,
  //           band, group, sortKey, sortDir, selected }
  let batch = null;

  async function handleBatchFiles(fileList) {
    const all = [...fileList].filter((f) => /\.csv$/i.test(f.name));
    if (!all.length) { alert('CSV 파일이 없습니다.'); return; }

    // 같은 이름은 한 번만 (통합 폴더 + 종합 폴더를 같이 올린 경우)
    const byName = new Map();
    let duplicates = 0;
    for (const f of all) {
      const name = nfc(f.name);
      if (byName.has(name)) duplicates++;
      else byName.set(name, f);
    }

    const { pairs, unrecognized, unpaired } = A.buildPairs([...byName.keys()]);
    const needed = new Set(pairs.flatMap((p) => [p.neutral, p.expressive]));
    const curves = new Map();
    const progress = $('batch-progress');
    progress.hidden = false;
    let done = 0;
    for (const name of needed) {
      curves.set(name, A.parseCsv(await readText(byName.get(name))));
      if (++done % 25 === 0 || done === needed.size) {
        progress.textContent = `파일 읽는 중… ${done} / ${needed.size}`;
        await nextFrame();
      }
    }

    const results = [];
    const failed = [];
    for (const p of pairs) {
      const n = curves.get(p.neutral);
      const e = curves.get(p.expressive);
      if (!n.peak || !e.peak) { failed.push(p.neutral, p.expressive); continue; }
      results.push({
        ...p, nHz: n.peak.hz, nDb: n.peak.db, eHz: e.peak.hz, eDb: e.peak.db,
        ...A.comparePeaks(n.peak, e.peak), bands: [],
      });
    }

    const excluded = [
      ...unpaired.map((n) => ['짝 없음', n]),
      ...unrecognized.map((n) => ['파일명 규칙 불일치', n]),
      ...failed.map((n) => ['데이터 추출 실패', n]),
    ];
    batch = { results, curves, unpaired, excluded, duplicates, band: 1, group: null, sortKey: null, sortDir: 1, selected: null };
    await computeBands();
    renderBatch();
  }

  /** 현재 설정으로 모든 쌍의 대역별 비교를 다시 계산 */
  async function computeBands() {
    const progress = $('batch-progress');
    progress.hidden = false;
    const { results, curves } = batch;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      r.bands = A.compareBands(curves.get(r.neutral), curves.get(r.expressive), settings);
      if ((i + 1) % 20 === 0 || i === results.length - 1) {
        progress.textContent = `대역별 피크 분석 중… ${i + 1} / ${results.length}`;
        await nextFrame();
      }
    }
    progress.hidden = true;
    batch.stats = A.bandStats(results, settings);
    batch.legacyStats = A.groupStats(results);
    batch.matrix = A.attemptMatrix(results, batch.unpaired);
    if (!batch.group && batch.matrix.groups.length) batch.group = groupKey(batch.matrix.groups[0]);
  }

  const groupKey = (g) => `${g.expr}|${g.part}`;
  const groupName = (g) => `${A.EXPRESSION_NAMES[g.expr]}·${A.PART_NAMES[g.part]}`;
  const pairId = (r) => `${r.expr}|${r.part}|${r.attempt}`;

  function renderBatch() {
    const { results, excluded, duplicates } = batch;
    $('batch-result').hidden = false;
    $('kpi-pairs').textContent = `${results.length}쌍`;
    $('kpi-excluded').textContent = `${excluded.length}개`;
    $('kpi-dup').textContent = duplicates ? `중복 파일명 ${duplicates}개는 한 번만 계산` : '';
    $('batch-excluded').hidden = !excluded.length;
    $('batch-excluded-list').innerHTML = excluded.map(([why, n]) => `<li><b>[${esc(why)}]</b> ${esc(n)}</li>`).join('');

    const fillSelect = (el, values, names) => {
      const cur = el.value;
      el.innerHTML = '<option value="">전체</option>' + values.map((v) => `<option value="${v}">${names[v]}</option>`).join('');
      el.value = values.includes(cur) ? cur : '';
    };
    fillSelect($('f-expr'), A.EXPRESSIONS.filter((x) => results.some((r) => r.expr === x)), A.EXPRESSION_NAMES);
    fillSelect($('f-part'), A.PARTS.filter((x) => results.some((r) => r.part === x)), A.PART_NAMES);

    $('legacy-table').innerHTML = batch.legacyStats.map((s) => `<tr><td>${A.EXPRESSION_NAMES[s.expr]}</td><td>${A.PART_NAMES[s.part]}</td><td class="num">${s.count}</td>
      <td class="num">${fmtMHz(s.hzMean, 3)}</td><td class="num">${s.hzSd === null ? '—' : fmtMHz(s.hzSd, 3)}</td>
      <td class="num">${s.dbMean.toFixed(4)}</td><td class="num">${s.dbSd === null ? '—' : s.dbSd.toFixed(4)}</td></tr>`).join('');

    renderBand();
  }

  function renderBand() {
    const ranges = A.bandRanges(settings.bounds);
    if (batch.band >= ranges.length) batch.band = 0;
    const bi = batch.band;
    const band = ranges[bi];

    $('band-tabs').innerHTML = ranges.map((r, i) =>
      `<button class="band-tab" role="tab" data-band="${i}" aria-selected="${i === bi}"><b>${r.name}</b> <span>${bandRangeText(r)}</span></button>`).join('');

    const rows = batch.results.map((r) => r.bands[bi]);
    const cnt = (pred) => rows.filter(pred).length;
    $('band-caption').textContent = `${band.name} (${bandRangeText(band)}) — 비교 ${cnt((b) => b.status !== 'missing')}쌍 · ` +
      `피크 없음 ${cnt((b) => b.status === 'missing')} · ⚠ 불일치 ${cnt((b) => b.status === 'mismatch')} · ◐ 모양 변화 ${cnt((b) => b.shapeChanged)}`;
    const titles = { 'stats-title': '표정·부위별 통계', 'attempt-title': '비교군별 attempt 차이', 'pairs-title': '쌍별 결과' };
    Object.entries(titles).forEach(([id, base]) => { $(id).textContent = `${base} · ${band.name}`; });

    const stats = batch.stats.filter((s) => s.band === band.name);
    $('stats-table').innerHTML = stats.map((s) => `<tr><td>${A.EXPRESSION_NAMES[s.expr]}</td><td>${A.PART_NAMES[s.part]}</td>
      <td class="num">${s.pairs}</td><td class="num">${s.missing}</td><td class="num">${s.mismatch}</td><td class="num">${s.shapeChanged}</td>
      <td class="num">${msd(s.shiftMin, 1e6, true)}</td><td class="num">${msd(s.absShiftMin, 1e6, false)}</td><td class="num">${msd(s.shiftShape, 1e6, true)}</td>
      <td class="num">${msd(s.depthDiff, 1, true)}</td><td class="num">${msd(s.promDiff, 1, true)}</td><td class="num">${msd(s.shiftMinClean, 1e6, true)}</td></tr>`).join('');
    drawStatBars($('chart-shift'), stats, 'shiftMin', 1e6, 'MHz');
    drawStatBars($('chart-depth'), stats, 'depthDiff', 1, 'dB');

    renderGroupTabs();
    renderAttemptTable();
    renderPairsTable();
    if (batch.selected && !$('batch-detail').hidden) showBatchDetail(batch.selected, false);
  }

  $('band-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-band]');
    if (!b) return;
    batch.band = +b.dataset.band;
    renderBand();
  });

  // ---------- 비교군별 attempt 차이 ----------
  function renderGroupTabs() {
    $('group-tabs').innerHTML = batch.matrix.groups.map((g) => {
      const n = g.rows.filter((r) => r.result).length;
      const on = groupKey(g) === batch.group;
      return `<button class="group-tab" role="tab" data-group="${groupKey(g)}" aria-selected="${on}">${groupName(g)} <span class="muted">${n}</span></button>`;
    }).join('');
  }

  const sdText = (summary, scale) => (summary.sd === null ? '—' : (summary.sd / scale).toFixed(2));

  function renderAttemptTable() {
    const g = batch.matrix.groups.find((x) => groupKey(x) === batch.group);
    if (!g) { $('attempt-body').innerHTML = ''; $('attempt-foot').innerHTML = ''; $('group-caption').textContent = ''; return; }
    const bi = batch.band;
    const st = batch.stats.find((s) => s.band === `R${bi + 1}` && s.expr === g.expr && s.part === g.part);
    const paired = g.rows.filter((r) => r.result);
    $('group-caption').textContent = `${groupName(g)} — attempt ${g.rows.length}개 · 비교 ${paired.length}쌍` +
      (st ? ` · 피크 없음 ${st.missing} · ⚠ 불일치 ${st.mismatch} · ◐ 모양 변화 ${st.shapeChanged}` : '') +
      ' · 행을 누르면 아래에 곡선을 보여 줍니다.';
    $('attempt-body').innerHTML = g.rows.map((row) => {
      if (!row.result) {
        const role = A.parseFileName(row.unpaired).neutral ? '원상태' : '무표정';
        return `<tr class="missing"><td class="num">${row.attempt}</td><td colspan="6">짝 없음 (${role} 파일 없음: ${esc(row.unpaired)} 만 있음)</td></tr>`;
      }
      const r = row.result;
      const b = r.bands[bi];
      const id = pairId(r);
      return `<tr data-id="${id}" tabindex="0" class="${batch.selected === id ? 'selected' : ''}"><td class="num">${r.attempt}</td><td>${statusBadges(b)}</td>
        <td class="num">${sMHz(b.shiftMin)}</td><td class="num">${sMHz(b.shiftShape)}</td><td class="num">${fNcc(b.ncc)}</td>
        <td class="num">${sDb(b.depthDiff)}</td><td class="num">${sDb(b.promDiff)}</td></tr>`;
    }).join('');
    const meanOnly = (summary, scale) => msd({ ...summary, sd: null }, scale, true);
    $('attempt-foot').innerHTML = st && st.shiftMin.n ? `
      <tr><td class="num">평균</td><td>n = ${st.shiftMin.n}</td><td class="num">${meanOnly(st.shiftMin, 1e6)}</td>
        <td class="num">${meanOnly(st.shiftShape, 1e6)}</td><td></td>
        <td class="num">${meanOnly(st.depthDiff, 1)}</td><td class="num">${meanOnly(st.promDiff, 1)}</td></tr>
      <tr><td class="num">SD</td><td>표본표준편차</td><td class="num">${sdText(st.shiftMin, 1e6)}</td>
        <td class="num">${sdText(st.shiftShape, 1e6)}</td><td></td>
        <td class="num">${sdText(st.depthDiff, 1)}</td><td class="num">${sdText(st.promDiff, 1)}</td></tr>` : '';
  }

  $('group-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    batch.group = b.dataset.group;
    renderGroupTabs();
    renderAttemptTable();
  });

  // ---------- 쌍별 결과 ----------
  const STATUS_ORDER = { ok: 0, mismatch: 1, missing: 2 };
  function sortValue(r, b, k) {
    switch (k) {
      case 'expr': return A.EXPRESSIONS.indexOf(r.expr);
      case 'part': return A.PARTS.indexOf(r.part);
      case 'attempt': return r.attempt;
      case 'status': return STATUS_ORDER[b.status] * 2 + (b.shapeChanged ? 1 : 0);
      case 'nHz': return b.neutral ? b.neutral.hz : null;
      case 'eHz': return b.expressive ? b.expressive.hz : null;
      default: return b[k];
    }
  }

  function visibleRows() {
    const fe = $('f-expr').value;
    const fp = $('f-part').value;
    const fs = $('f-status').value;
    const bi = batch.band;
    let rows = batch.results.filter((r) => {
      const b = r.bands[bi];
      if (fe && r.expr !== fe) return false;
      if (fp && r.part !== fp) return false;
      if (fs === 'shape') return b.shapeChanged;
      return !fs || b.status === fs;
    });
    if (batch.sortKey) {
      const k = batch.sortKey;
      rows = [...rows].sort((x, y) => {
        const a = sortValue(x, x.bands[bi], k);
        const c = sortValue(y, y.bands[bi], k);
        if (a === null && c === null) return 0;
        if (a === null) return 1; // 값 없는 행은 항상 아래로
        if (c === null) return -1;
        return (a - c) * batch.sortDir;
      });
    }
    return rows;
  }

  function renderPairsTable() {
    const bi = batch.band;
    $('pairs-table').innerHTML = visibleRows().map((r) => {
      const b = r.bands[bi];
      const id = pairId(r);
      return `<tr data-id="${id}" tabindex="0" class="${batch.selected === id ? 'selected' : ''}">
        <td>${A.EXPRESSION_NAMES[r.expr]}</td><td>${A.PART_NAMES[r.part]}</td><td class="num">${r.attempt}</td><td>${statusBadges(b)}</td>
        <td class="num">${b.neutral ? fmtMHz(b.neutral.hz) : '—'}</td><td class="num">${b.expressive ? fmtMHz(b.expressive.hz) : '—'}</td>
        <td class="num">${sMHz(b.shiftMin)}</td><td class="num">${sMHz(b.shiftShape)}</td><td class="num">${fNcc(b.ncc)}</td>
        <td class="num">${sDb(b.depthDiff)}</td><td class="num">${sDb(b.promDiff)}</td></tr>`;
    }).join('');
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted-asc', th.dataset.sort === batch.sortKey && batch.sortDir === 1);
      th.classList.toggle('sorted-desc', th.dataset.sort === batch.sortKey && batch.sortDir === -1);
    });
  }

  function showBatchDetail(id, scroll = true) {
    const r = batch.results.find((x) => pairId(x) === id);
    if (!r) return;
    batch.selected = id;
    document.querySelectorAll('#pairs-table tr, #attempt-body tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
    const b = r.bands[batch.band];
    $('batch-detail').hidden = false;
    $('batch-detail-title').textContent = `${A.label(r)} — ${b.band} ` +
      (b.status === 'missing' ? A.statusLabel(b) : `Δf ${sMHz(b.shiftMin)} MHz · 깊이 ${sDb(b.depthDiff)} dB${b.status === 'mismatch' ? ' · ⚠ 불일치' : ''}`);
    drawCurves($('batch-chart'), batch.curves.get(r.neutral), batch.curves.get(r.expressive), r.bands, batch.band);
    if (scroll) $('batch-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  ['pairs-table', 'attempt-body'].forEach((id) => {
    $(id).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) showBatchDetail(tr.dataset.id); });
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) showBatchDetail(tr.dataset.id); } });
  });
  ['f-expr', 'f-part', 'f-status'].forEach((id) => $(id).addEventListener('change', renderPairsTable));
  document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    if (!batch) return;
    const k = th.dataset.sort;
    batch.sortDir = batch.sortKey === k ? -batch.sortDir : 1;
    batch.sortKey = k;
    renderPairsTable();
  }));

  // ---------- 다운로드 (python/auto_ver4.py 와 같은 형식) ----------
  $('dl-pairs').addEventListener('click', () => downloadCsv(`대역별_쌍별_${stamp()}.csv`, A.bandPairRows(batch.results, settings)));
  $('dl-stats').addEventListener('click', () => downloadCsv(`대역별_통계_${stamp()}.csv`, A.bandStatRows(batch.stats, settings)));
  $('dl-matrix').addEventListener('click', () => downloadCsv(`대역별_attempt별_${stamp()}.csv`, A.bandMatrixRows(batch.matrix, settings)));
  $('dl-legacy-pairs').addEventListener('click', () => downloadCsv(`이전방식_쌍별_${stamp()}.csv`, [
    ['표정', '부위', 'attempt', '무표정 파일', '원상태 파일', '무표정 주파수(Hz)', '무표정 피크(dB)', '원상태 주파수(Hz)', '원상태 피크(dB)', '|Δf|(Hz)', '|ΔdB|'],
    ...batch.results.map((r) => [r.expr, r.part, r.attempt, r.neutral, r.expressive, r.nHz, r.nDb, r.eHz, r.eDb, r.absDeltaHz, +r.absDeltaDb.toFixed(6)]),
  ]));
  $('dl-legacy-stats').addEventListener('click', () => downloadCsv(`이전방식_통계_${stamp()}.csv`, [
    ['표정', '부위', '쌍 수', '|Δf| 평균(Hz)', '|Δf| 표준편차(Hz)', '|ΔdB| 평균', '|ΔdB| 표준편차'],
    ...batch.legacyStats.map((s) => [s.expr, s.part, s.count, s.hzMean, s.hzSd, s.dbMean, s.dbSd]),
  ]));

  $('batch-files').addEventListener('change', (ev) => { handleBatchFiles(ev.target.files); ev.target.value = ''; });
  $('batch-folder').addEventListener('change', (ev) => { handleBatchFiles(ev.target.files); ev.target.value = ''; });
  setupDrop($('batch-drop'), handleBatchFiles);

  // 다크/라이트 전환 시 그래프 색 다시 칠하기
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    renderPair();
    if (batch && batch.stats) renderBand();
  });
})();
