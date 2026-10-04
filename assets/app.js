/* app.js - 화면 동작. 계산은 모두 analysis.js 에 있다. */
(function () {
  'use strict';
  const A = window.Analysis;
  const $ = (id) => document.getElementById(id);

  // ---------- 공통 유틸 ----------
  const fmtMHz = (hz) => (hz / 1e6).toFixed(3);
  const fmtDb = (db) => db.toFixed(4);
  const fmtOpt = (v, f) => (v === null ? '—' : f(v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nfc = (s) => s.normalize('NFC');

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
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e);
        } while (batch.length);
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
      legend: { orientation: 'h', x: 0, y: 1.12, font: { color: cssVar('--text-primary') } },
    };
  }
  const plotConfig = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  /** 두 곡선 겹쳐 그리기 + 피크 표시 */
  function drawCurves(el, neutral, expressive) {
    const cN = cssVar('--series-neutral');
    const cE = cssVar('--series-expressive');
    const surface = cssVar('--surface-1');
    const line = (d, name, color) => ({
      x: d.freq.map((f) => f / 1e6), y: d.db, name, type: 'scatter', mode: 'lines',
      line: { color, width: 2 },
      hovertemplate: `${name}: %{y:.3f} dB<extra></extra>`,
    });
    const peak = (d, name, color) => ({
      x: [d.peak.hz / 1e6], y: [d.peak.db], name: `${name} 피크`, type: 'scatter', mode: 'markers',
      marker: { color, size: 11, line: { color: surface, width: 2 } },
      showlegend: false,
      hovertemplate: `${name} 피크<br>%{x:.3f} MHz · %{y:.4f} dB<extra></extra>`,
    });
    const layout = baseLayout();
    layout.xaxis.title = { text: '주파수 (MHz)' };
    layout.yaxis.title = { text: 'Return Loss (dB)' };
    layout.hovermode = 'x unified';
    layout.shapes = [neutral, expressive].map((d, i) => ({
      type: 'line', xref: 'x', yref: 'paper', x0: d.peak.hz / 1e6, x1: d.peak.hz / 1e6, y0: 0, y1: 1,
      line: { color: i ? cE : cN, width: 1, dash: 'dot' },
    }));
    // 좁은 화면에서는 라벨이 그래프 밖으로 넘치므로 생략 (마커·hover·표로 확인)
    layout.annotations = el.clientWidth < 600 ? [] : [neutral, expressive].map((d, i) => ({
      x: d.peak.hz / 1e6, y: d.peak.db, xref: 'x', yref: 'y',
      text: `${i ? '원상태' : '무표정'} ${fmtMHz(d.peak.hz)} MHz, ${d.peak.db.toFixed(2)} dB`,
      showarrow: true, arrowhead: 0, arrowcolor: cssVar('--text-muted'), ax: i ? 70 : -70, ay: i ? 36 : -36,
      xanchor: i ? 'left' : 'right',
      font: { color: cssVar('--text-primary'), size: 12 }, bgcolor: surface, borderpad: 3,
    }));
    Plotly.react(el, [line(neutral, '무표정', cN), line(expressive, '원상태', cE), peak(neutral, '무표정', cN), peak(expressive, '원상태', cE)], layout, plotConfig);
  }

  function drawStatBars(el, stats, key, sdKey, scale, unit) {
    const labels = stats.map((s) => `${A.EXPRESSION_NAMES[s.expr]}·${A.PART_NAMES[s.part]}`);
    const layout = baseLayout();
    layout.showlegend = false;
    layout.margin.b = 64;
    layout.yaxis.title = { text: unit };
    layout.yaxis.rangemode = 'tozero';
    layout.bargap = 0.45;
    Plotly.react(el, [{
      type: 'bar', x: labels, y: stats.map((s) => s[key] / scale),
      marker: { color: cssVar('--accent'), cornerradius: 4 },
      error_y: { type: 'data', array: stats.map((s) => (s[sdKey] === null ? 0 : s[sdKey] / scale)), color: cssVar('--text-muted'), thickness: 1.5, width: 4 },
      customdata: stats.map((s) => [s.count, s[sdKey] === null ? '—' : (s[sdKey] / scale).toFixed(3)]),
      hovertemplate: `%{x}<br>평균 %{y:.3f} ${unit}<br>SD %{customdata[1]} · n=%{customdata[0]}<extra></extra>`,
    }], layout, plotConfig);
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

    pairState = { n, e, nName: nfc(nFile.name), eName: nfc(eFile.name), info: check.info };
    renderPair();
  }

  function renderPair() {
    if (!pairState) return;
    const { n, e, nName, eName, info } = pairState;
    const diff = A.comparePeaks(n.peak, e.peak);
    $('pair-title').textContent = A.label(info);
    $('kpi-hz').textContent = `${fmtMHz(diff.absDeltaHz)} MHz`;
    $('kpi-hz-sub').textContent = `${diff.absDeltaHz.toLocaleString('ko-KR')} Hz`;
    $('kpi-db').textContent = `${diff.absDeltaDb.toFixed(4)} dB`;
    $('pair-table').innerHTML = [['무표정', '--series-neutral', nName, n.peak], ['원상태', '--series-expressive', eName, e.peak]]
      .map(([l, c, name, p]) => `<tr><td><span class="chip"><span class="swatch" style="background:var(${c})"></span>${l}</span></td><td class="file">${esc(name)}</td><td class="num">${fmtMHz(p.hz)}</td><td class="num">${fmtDb(p.db)}</td></tr>`).join('');
    $('pair-result').hidden = false;
    drawCurves($('pair-chart'), n, e);
  }

  $('pair-input').addEventListener('change', (ev) => { handlePairFiles(ev.target.files); ev.target.value = ''; });
  setupDrop($('pair-drop'), handlePairFiles);

  // ---------- 일괄 비교 ----------
  let batch = null; // { results, stats, curves: Map(name -> data), sortKey, sortDir, selected }

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
        await new Promise((r) => setTimeout(r));
      }
    }
    progress.hidden = true;

    const results = [];
    const failed = [];
    for (const p of pairs) {
      const n = curves.get(p.neutral);
      const e = curves.get(p.expressive);
      if (!n.peak || !e.peak) { failed.push(p.neutral, p.expressive); continue; }
      results.push({
        ...p, nHz: n.peak.hz, nDb: n.peak.db, eHz: e.peak.hz, eDb: e.peak.db,
        ...A.comparePeaks(n.peak, e.peak),
      });
    }

    const excluded = [
      ...unpaired.map((n) => ['짝 없음', n]),
      ...unrecognized.map((n) => ['파일명 규칙 불일치', n]),
      ...failed.map((n) => ['데이터 추출 실패', n]),
    ];
    batch = { results, stats: A.groupStats(results), curves, excluded, duplicates, sortKey: null, sortDir: 1, selected: null };
    renderBatch();
  }

  function renderBatch() {
    const { results, stats, excluded, duplicates } = batch;
    $('batch-result').hidden = false;
    $('kpi-pairs').textContent = `${results.length}쌍`;
    $('kpi-excluded').textContent = `${excluded.length}개`;
    $('kpi-dup').textContent = duplicates ? `중복 파일명 ${duplicates}개는 한 번만 계산` : '';
    const ex = $('batch-excluded');
    ex.hidden = !excluded.length;
    $('batch-excluded-list').innerHTML = excluded.map(([why, n]) => `<li><b>[${esc(why)}]</b> ${esc(n)}</li>`).join('');

    $('stats-table').innerHTML = stats.map((s) => `<tr><td>${A.EXPRESSION_NAMES[s.expr]}</td><td>${A.PART_NAMES[s.part]}</td><td class="num">${s.count}</td>
      <td class="num">${fmtMHz(s.hzMean)}</td><td class="num">${fmtOpt(s.hzSd, fmtMHz)}</td>
      <td class="num">${fmtDb(s.dbMean)}</td><td class="num">${fmtOpt(s.dbSd, fmtDb)}</td></tr>`).join('');

    const fillSelect = (el, values, names) => {
      const cur = el.value;
      el.innerHTML = '<option value="">전체</option>' + values.map((v) => `<option value="${v}">${names[v]}</option>`).join('');
      el.value = values.includes(cur) ? cur : '';
    };
    fillSelect($('f-expr'), A.EXPRESSIONS.filter((x) => results.some((r) => r.expr === x)), A.EXPRESSION_NAMES);
    fillSelect($('f-part'), A.PARTS.filter((x) => results.some((r) => r.part === x)), A.PART_NAMES);

    renderPairsTable();
    drawBatchCharts();
    $('batch-detail').hidden = true;
  }

  function drawBatchCharts() {
    if (!batch || !batch.stats.length) return;
    drawStatBars($('chart-hz'), batch.stats, 'hzMean', 'hzSd', 1e6, 'MHz');
    drawStatBars($('chart-db'), batch.stats, 'dbMean', 'dbSd', 1, 'dB');
  }

  function visibleRows() {
    const fe = $('f-expr').value;
    const fp = $('f-part').value;
    let rows = batch.results.filter((r) => (!fe || r.expr === fe) && (!fp || r.part === fp));
    if (batch.sortKey) {
      const k = batch.sortKey;
      const order = (r) => (k === 'expr' ? A.EXPRESSIONS.indexOf(r.expr) : k === 'part' ? A.PARTS.indexOf(r.part) : r[k]);
      rows = [...rows].sort((a, b) => (order(a) - order(b)) * batch.sortDir);
    }
    return rows;
  }

  function renderPairsTable() {
    const rows = visibleRows();
    $('pairs-table').innerHTML = rows.map((r) => {
      const id = `${r.expr}|${r.part}|${r.attempt}`;
      return `<tr data-id="${id}" tabindex="0" class="${batch.selected === id ? 'selected' : ''}">
        <td>${A.EXPRESSION_NAMES[r.expr]}</td><td>${A.PART_NAMES[r.part]}</td><td class="num">${r.attempt}</td>
        <td class="num">${fmtMHz(r.nHz)}</td><td class="num">${fmtDb(r.nDb)}</td>
        <td class="num">${fmtMHz(r.eHz)}</td><td class="num">${fmtDb(r.eDb)}</td>
        <td class="num">${fmtMHz(r.absDeltaHz)}</td><td class="num">${fmtDb(r.absDeltaDb)}</td></tr>`;
    }).join('');
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted-asc', th.dataset.sort === batch.sortKey && batch.sortDir === 1);
      th.classList.toggle('sorted-desc', th.dataset.sort === batch.sortKey && batch.sortDir === -1);
    });
  }

  function showBatchDetail(id) {
    const r = batch.results.find((x) => `${x.expr}|${x.part}|${x.attempt}` === id);
    if (!r) return;
    batch.selected = id;
    document.querySelectorAll('#pairs-table tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
    $('batch-detail').hidden = false;
    $('batch-detail-title').textContent = `${A.label(r)} — |Δf| ${fmtMHz(r.absDeltaHz)} MHz · |ΔdB| ${fmtDb(r.absDeltaDb)}`;
    drawCurves($('batch-chart'), batch.curves.get(r.neutral), batch.curves.get(r.expressive));
    $('batch-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('pairs-table').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) showBatchDetail(tr.dataset.id); });
  $('pairs-table').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr'); if (tr) showBatchDetail(tr.dataset.id); } });
  ['f-expr', 'f-part'].forEach((id) => $(id).addEventListener('change', renderPairsTable));
  document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    if (!batch) return;
    const k = th.dataset.sort;
    batch.sortDir = batch.sortKey === k ? -batch.sortDir : 1;
    batch.sortKey = k;
    renderPairsTable();
  }));

  $('dl-pairs').addEventListener('click', () => {
    downloadCsv(`비교결과_쌍별_${stamp()}.csv`, [
      ['표정', '부위', 'attempt', '무표정 파일', '원상태 파일', '무표정 주파수(Hz)', '무표정 피크(dB)', '원상태 주파수(Hz)', '원상태 피크(dB)', '|Δf|(Hz)', '|ΔdB|'],
      ...batch.results.map((r) => [r.expr, r.part, r.attempt, r.neutral, r.expressive, r.nHz, r.nDb, r.eHz, r.eDb, r.absDeltaHz, +r.absDeltaDb.toFixed(6)]),
    ]);
  });
  $('dl-stats').addEventListener('click', () => {
    downloadCsv(`비교결과_통계_${stamp()}.csv`, [
      ['표정', '부위', '쌍 수', '|Δf| 평균(Hz)', '|Δf| 표준편차(Hz)', '|ΔdB| 평균', '|ΔdB| 표준편차'],
      ...batch.stats.map((s) => [s.expr, s.part, s.count, s.hzMean, s.hzSd, s.dbMean, s.dbSd]),
    ]);
  });

  $('batch-files').addEventListener('change', (ev) => { handleBatchFiles(ev.target.files); ev.target.value = ''; });
  $('batch-folder').addEventListener('change', (ev) => { handleBatchFiles(ev.target.files); ev.target.value = ''; });
  setupDrop($('batch-drop'), handleBatchFiles);

  // 다크/라이트 전환 시 그래프 색 다시 칠하기
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    renderPair();
    if (batch) {
      drawBatchCharts();
      if (batch.selected && !$('batch-detail').hidden) showBatchDetail(batch.selected);
    }
  });
})();
