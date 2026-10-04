/*
 * analysis.js - 피크 추출 / 파일명 해석 / 쌍 비교 로직 (DOM 없음)
 *
 * python/auto_ver4.py 와 같은 결과를 내야 한다. 한쪽을 고치면 다른 쪽도 같이 고친다.
 *  - [v2, 기본] 대역별 공진 dip: compareBands / bandStats (아래 '분석 정의 v2' 블록)
 *  - [이전 방식, 참고용] 전체 최저점: parseCsv().peak, comparePeaks, groupStats
 *      피크 = B열 최저값과 그 행의 A열 주파수(동률이면 먼저 나온 행), |Δf|·|ΔdB| 절대값
 *  - 통계: 평균, 표본표준편차(n-1)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Analysis = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXPRESSIONS = ['놀', '화', '웃'];
  const PARTS = ['눈', '입', '볼'];
  const EXPRESSION_NAMES = { '놀': '놀람', '화': '화남', '웃': '웃음' };
  const PART_NAMES = { '눈': '눈꼬리', '입': '입', '볼': '볼' };
  const NAME_PATTERN = /(놀|화|웃)\s*(눈|입|볼)\s*(\d+)(\s*무)?\s*\.csv$/i;

  // Python float() 처럼: 빈 문자열은 숫자가 아니다
  function toNumber(s) {
    if (s === undefined) return NaN;
    const t = s.trim();
    return t === '' ? NaN : Number(t);
  }

  function splitCsvLine(line) {
    if (line.indexOf('"') === -1) return line.split(',');
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** CSV 텍스트 -> { freq: number[], db: number[], peak: {hz, db, index} | null } */
  function parseCsv(text) {
    const freq = [];
    const db = [];
    let peak = null;
    const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
    for (const line of lines) {
      const row = splitCsvLine(line);
      if (row.length < 2) continue;
      const hz = toNumber(row[0]);
      const b = toNumber(row[1]);
      if (Number.isNaN(hz) || Number.isNaN(b)) continue; // 헤더/숫자 아닌 행
      freq.push(hz);
      db.push(b);
      if (peak === null || b < peak.db) peak = { hz, db: b, index: freq.length - 1 };
    }
    return { freq, db, peak };
  }

  /** 파일명 -> { expr, part, attempt, neutral } | null */
  function parseFileName(fileName) {
    const name = fileName.normalize('NFC');
    const m = name.match(NAME_PATTERN);
    if (!m) return null;
    return { expr: m[1], part: m[2], attempt: parseInt(m[3], 10), neutral: m[4] !== undefined };
  }

  function label(info) {
    return `${EXPRESSION_NAMES[info.expr]} · ${PART_NAMES[info.part]} · attempt ${info.attempt}`;
  }

  /**
   * 파일 2개가 비교 대상인지 확인한다.
   * 반환: { ok: true, neutral: idx, expressive: idx, info } 또는 { ok: false, errors: string[] }
   */
  function checkPair(nameA, nameB) {
    const a = parseFileName(nameA);
    const b = parseFileName(nameB);
    const errors = [];
    if (!a) errors.push(`파일명 규칙에 맞지 않습니다: ${nameA}`);
    if (!b) errors.push(`파일명 규칙에 맞지 않습니다: ${nameB}`);
    if (errors.length) return { ok: false, errors };

    if (a.neutral === b.neutral) {
      const kind = a.neutral ? "둘 다 무표정('무')" : "둘 다 원상태('무' 없음)";
      errors.push(`${kind} 파일입니다. 무표정 1개 + 원상태 1개를 올려 주세요: ${nameA}, ${nameB}`);
    }
    if (a.expr !== b.expr) errors.push(`표정이 다릅니다 (${a.expr} ≠ ${b.expr}): ${nameA}, ${nameB}`);
    if (a.part !== b.part) errors.push(`부위가 다릅니다 (${a.part} ≠ ${b.part}): ${nameA}, ${nameB}`);
    if (a.attempt !== b.attempt) errors.push(`attempt가 다릅니다 (${a.attempt} ≠ ${b.attempt}): ${nameA}, ${nameB}`);
    if (errors.length) return { ok: false, errors };

    return { ok: true, neutral: a.neutral ? 0 : 1, expressive: a.neutral ? 1 : 0, info: a };
  }

  function comparePeaks(neutralPeak, expressivePeak) {
    return {
      absDeltaHz: Math.abs(expressivePeak.hz - neutralPeak.hz),
      absDeltaDb: Math.abs(expressivePeak.db - neutralPeak.db),
    };
  }

  /**
   * 여러 파일명을 무표정/원상태 쌍으로 묶는다.
   * names: string[] (중복 제거된 이름)
   * 반환: { pairs: [{expr, part, attempt, neutral, expressive}], unrecognized: [], unpaired: [] }
   */
  function buildPairs(names) {
    const slots = new Map();
    const unrecognized = [];
    for (const name of [...names].sort()) {
      const info = parseFileName(name);
      if (!info) { unrecognized.push(name); continue; }
      const key = `${info.expr}|${info.part}|${info.attempt}`;
      const role = info.neutral ? 'neutral' : 'expressive';
      if (!slots.has(key)) slots.set(key, { expr: info.expr, part: info.part, attempt: info.attempt });
      const slot = slots.get(key);
      if (slot[role]) { unrecognized.push(name); continue; }
      slot[role] = name;
    }
    const pairs = [];
    const unpaired = [];
    const ordered = [...slots.values()].sort((x, y) =>
      EXPRESSIONS.indexOf(x.expr) - EXPRESSIONS.indexOf(y.expr) ||
      PARTS.indexOf(x.part) - PARTS.indexOf(y.part) ||
      x.attempt - y.attempt);
    for (const s of ordered) {
      if (s.neutral && s.expressive) pairs.push(s);
      else unpaired.push(s.neutral || s.expressive);
    }
    return { pairs, unrecognized: unrecognized.sort(), unpaired };
  }

  function mean(values) {
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  function stdev(values) {
    if (values.length < 2) return null;
    const m = mean(values);
    return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
  }

  /** results: [{expr, part, absDeltaHz, absDeltaDb}] -> 표정·부위별 통계 */
  function groupStats(results) {
    const stats = [];
    for (const expr of EXPRESSIONS) {
      for (const part of PARTS) {
        const rows = results.filter((r) => r.expr === expr && r.part === part);
        if (!rows.length) continue;
        const hz = rows.map((r) => r.absDeltaHz);
        const db = rows.map((r) => r.absDeltaDb);
        stats.push({
          expr, part, count: rows.length,
          hzMean: mean(hz), hzSd: stdev(hz),
          dbMean: mean(db), dbSd: stdev(db),
        });
      }
    }
    return stats;
  }

  /**
   * 비교군(표정·부위) × attempt 표.
   * results: 쌍별 결과, unpaired: 짝 없는 파일명 목록
   * 반환: { attempts: number[] (전체 비교군의 attempt 합집합),
   *         groups: [{ expr, part, rows: [{ attempt, result | null, unpaired: 파일명 | null }] }] }
   * 각 비교군의 rows 는 그 비교군에 쌍이나 짝 없는 파일이 있는 attempt 만 담는다.
   */
  function attemptMatrix(results, unpaired) {
    const all = new Set();
    const groups = [];
    for (const expr of EXPRESSIONS) {
      for (const part of PARTS) {
        const byAttempt = new Map();
        for (const r of results) {
          if (r.expr === expr && r.part === part) byAttempt.set(r.attempt, { attempt: r.attempt, result: r, unpaired: null });
        }
        for (const name of unpaired || []) {
          const info = parseFileName(name);
          if (info && info.expr === expr && info.part === part && !byAttempt.has(info.attempt)) {
            byAttempt.set(info.attempt, { attempt: info.attempt, result: null, unpaired: name });
          }
        }
        if (!byAttempt.size) continue;
        const rows = [...byAttempt.values()].sort((a, b) => a.attempt - b.attempt);
        rows.forEach((row) => all.add(row.attempt));
        groups.push({ expr, part, rows });
      }
    }
    return { attempts: [...all].sort((a, b) => a - b), groups };
  }

  // ======================================================================
  // 분석 정의 v2: 대역별 공진 dip  (docs/MAINTENANCE.md §2 참고)
  // 주파수는 Hz, 깊이는 dB. curve = { freq: number[] (오름차순), db: number[] }
  // ======================================================================

  const DEFAULT_SETTINGS = {
    bounds: [450e6, 1100e6, 2000e6], // 대역 경계 (R1 | R2 | R3 | R4)
    minProminence: 3,                // dip 으로 인정할 최소 돌출도 (dB)
    shapeMinWindow: 30e6,            // 모양 정렬 비교 창 반폭 최소값 (Hz)
    shapeWidthFactor: 1.5,           // 비교 창 반폭 = max(최소값, 반치폭 × 이 값)
    shapeSearch: 300e6,              // 모양 정렬 이동 탐색 범위 ± (Hz)
    mismatchShift: 10e6,             // 이동량 불일치: 두 이동량 차이 > max(이 값,
    mismatchFrac: 0.15,              //                 |Δf 최저점| × 이 비율)
    shapeNcc: 0.9,                   // 모양 변화: 상관계수 < 이 값
  };

  function withDefaults(settings) {
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }

  /** 대역 목록: [{ name: 'R1', lo, hi }] (lo 이상, hi 미만) */
  function bandRanges(bounds) {
    const edges = [-Infinity, ...bounds, Infinity];
    return edges.slice(0, -1).map((lo, i) => ({ name: `R${i + 1}`, lo, hi: edges[i + 1] }));
  }

  /**
   * 국소 최저점과 돌출도. 돌출도 = min(왼쪽 최고점, 오른쪽 최고점) − 최저점,
   * 각 방향의 최고점은 이 점보다 낮은 점(또는 끝)을 만날 때까지의 최댓값.
   * 반환: [{ index, prominence }] (minProminence 이상만)
   */
  function findDips(curve, minProminence) {
    const d = curve.db;
    const n = d.length;
    const out = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(d[i] < d[i - 1] && d[i] <= d[i + 1])) continue;
      let j = i;
      let lm = d[i];
      while (j > 0 && d[j - 1] >= d[i]) { j--; if (d[j] > lm) lm = d[j]; }
      let k = i;
      let rm = d[i];
      while (k < n - 1 && d[k + 1] >= d[i]) { k++; if (d[k] > rm) rm = d[k]; }
      const prominence = Math.min(lm, rm) - d[i];
      if (prominence >= minProminence) out.push({ index: i, prominence });
    }
    return out;
  }

  /** 주변 3점 포물선 보간으로 최저점 위치·깊이 */
  function parabolicMin(curve, i) {
    const f = curve.freq;
    const d = curve.db;
    if (i <= 0 || i >= d.length - 1) return { hz: f[i], db: d[i] };
    const y0 = d[i - 1];
    const y1 = d[i];
    const y2 = d[i + 1];
    const den = y0 - 2 * y1 + y2;
    if (den <= 0) return { hz: f[i], db: d[i] };
    const o = 0.5 * (y0 - y2) / den;
    return { hz: f[i] + o * (f[i + 1] - f[i]), db: y1 - 0.25 * (y0 - y2) * o };
  }

  /** 반치폭: 최저점 + 돌출도/2 높이에서 dip 의 폭 (측정점 기준, Hz) */
  function halfWidth(curve, i, prominence) {
    const f = curve.freq;
    const d = curve.db;
    const level = d[i] + prominence / 2;
    let j = i;
    while (j > 0 && d[j] < level) j--;
    let k = i;
    while (k < d.length - 1 && d[k] < level) k++;
    return f[k] - f[j];
  }

  /** 대역 안에서 돌출도가 가장 큰 dip (동률이면 낮은 주파수). 없으면 null */
  function bandPeak(curve, dips, band) {
    let best = null;
    for (const dip of dips) {
      const hz = curve.freq[dip.index];
      if (hz < band.lo || hz >= band.hi) continue;
      if (best === null || dip.prominence > best.prominence) best = dip;
    }
    if (best === null) return null;
    const p = parabolicMin(curve, best.index);
    return {
      index: best.index, hz: p.hz, db: p.db,
      prominence: best.prominence, width: halfWidth(curve, best.index, best.prominence),
    };
  }

  /** 선형 보간. x 가 측정 범위 밖이면 null */
  function interpAt(curve, x) {
    const f = curve.freq;
    const n = f.length;
    if (x < f[0] || x > f[n - 1]) return null;
    if (x === f[n - 1]) return curve.db[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid] <= x) lo = mid; else hi = mid;
    }
    const a = (x - f[lo]) / (f[lo + 1] - f[lo]);
    return curve.db[lo] * (1 - a) + curve.db[lo + 1] * a;
  }

  /**
   * 모양 정렬 이동량: 무표정 dip 주변 곡선을 원상태 곡선 위에서 좌우로 밀며
   * 정규화 상관계수(평균 제거)가 최대인 이동량을 찾는다. 반환: { shift, ncc } | null
   */
  function shapeShift(neutral, peakN, expressive, band, settings) {
    const s = withDefaults(settings);
    const f = neutral.freq;
    const W = Math.max(s.shapeMinWindow, s.shapeWidthFactor * peakN.width);
    const xs = [];
    const ref = [];
    for (let i = 0; i < f.length; i++) {
      if (f[i] >= peakN.hz - W && f[i] <= peakN.hz + W) { xs.push(f[i]); ref.push(neutral.db[i]); }
    }
    if (xs.length < 3) return null;
    const mr = ref.reduce((a, v) => a + v, 0) / ref.length;
    for (let i = 0; i < ref.length; i++) ref[i] -= mr;
    const nr = Math.sqrt(ref.reduce((a, v) => a + v * v, 0));
    if (nr === 0) return null;

    const step = (f[f.length - 1] - f[0]) / (f.length - 1);
    const K = Math.floor(s.shapeSearch / step);
    const cs = [];
    for (let k = -K; k <= K; k++) {
      const sh = k * step;
      const c = peakN.hz + sh;
      if (c < band.lo || c >= band.hi) { cs.push(null); continue; }
      const seg = [];
      let ok = true;
      for (const x of xs) {
        const v = interpAt(expressive, x + sh);
        if (v === null) { ok = false; break; }
        seg.push(v);
      }
      if (!ok) { cs.push(null); continue; }
      const ms = seg.reduce((a, v) => a + v, 0) / seg.length;
      let num = 0;
      let ss = 0;
      for (let i = 0; i < seg.length; i++) {
        const b = seg[i] - ms;
        num += ref[i] * b;
        ss += b * b;
      }
      cs.push(ss > 0 ? num / (nr * Math.sqrt(ss)) : null);
    }
    let bi = -1;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i] !== null && (bi === -1 || cs[i] > cs[bi])) bi = i;
    }
    if (bi === -1) return null;
    let shift = (bi - K) * step;
    if (bi > 0 && bi < cs.length - 1 && cs[bi - 1] !== null && cs[bi + 1] !== null) {
      const y0 = cs[bi - 1];
      const y1 = cs[bi];
      const y2 = cs[bi + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) shift += 0.5 * (y0 - y2) / den * step;
    }
    return { shift, ncc: cs[bi] };
  }

  /**
   * 무표정/원상태 곡선 한 쌍을 대역별로 비교한다.
   * 반환: [{ band, neutral, expressive, status: 'ok'|'mismatch'|'missing', shapeChanged,
   *          shiftMin, shiftShape, ncc, depthDiff, promDiff }]
   *   status     = 'mismatch' 이면 두 이동량이 서로 달라 이동량을 믿기 어려움 (⚠)
   *   shapeChanged = 상관계수가 낮아 dip 모양이 달라짐 (◐, 정보용)
   *   shiftMin   = f원 − f무 (포물선 보간 최저점, Hz, +면 고주파 쪽)
   *   shiftShape = 모양 정렬 이동량 (Hz)
   *   depthDiff  = dB원 − dB무 (−면 더 깊어짐)
   *   promDiff   = 돌출도원 − 돌출도무 (+면 더 뚜렷해짐)
   */
  function compareBands(neutral, expressive, settings) {
    const s = withDefaults(settings);
    const dipsN = findDips(neutral, s.minProminence);
    const dipsE = findDips(expressive, s.minProminence);
    return bandRanges(s.bounds).map((band) => {
      const pn = bandPeak(neutral, dipsN, band);
      const pe = bandPeak(expressive, dipsE, band);
      const row = { band: band.name, neutral: pn, expressive: pe, status: 'missing', shapeChanged: false,
        shiftMin: null, shiftShape: null, ncc: null, depthDiff: null, promDiff: null };
      if (!pn || !pe) return row;
      row.shiftMin = pe.hz - pn.hz;
      row.depthDiff = pe.db - pn.db;
      row.promDiff = pe.prominence - pn.prominence;
      const sh = shapeShift(neutral, pn, expressive, band, s);
      if (sh) { row.shiftShape = sh.shift; row.ncc = sh.ncc; }
      const tol = Math.max(s.mismatchShift, s.mismatchFrac * Math.abs(row.shiftMin));
      row.status = (!sh || Math.abs(row.shiftMin - sh.shift) > tol) ? 'mismatch' : 'ok';
      row.shapeChanged = !sh || sh.ncc < s.shapeNcc;
      return row;
    });
  }

  function describe(values) {
    if (!values.length) return { n: 0, mean: null, sd: null };
    return { n: values.length, mean: mean(values), sd: stdev(values) };
  }

  /**
   * 대역 × 표정·부위 통계. results: [{ expr, part, bands: compareBands 결과 }]
   * 'missing' 은 제외, 'mismatch' 는 전체 통계에 포함하고 *Clean 통계에서만 뺀다.
   */
  function bandStats(results, settings) {
    const s = withDefaults(settings);
    const out = [];
    bandRanges(s.bounds).forEach((band, bi) => {
      for (const expr of EXPRESSIONS) {
        for (const part of PARTS) {
          const all = results.filter((r) => r.expr === expr && r.part === part);
          if (!all.length) continue;
          const rows = all.map((r) => r.bands[bi]).filter((b) => b.status !== 'missing');
          const clean = rows.filter((b) => b.status === 'ok');
          const pick = (arr, k) => arr.map((b) => b[k]).filter((v) => v !== null);
          out.push({
            band: band.name, expr, part,
            pairs: all.length, missing: all.length - rows.length,
            mismatch: rows.length - clean.length,
            shapeChanged: rows.filter((b) => b.shapeChanged).length,
            shiftMin: describe(pick(rows, 'shiftMin')),
            absShiftMin: describe(pick(rows, 'shiftMin').map(Math.abs)),
            shiftShape: describe(pick(rows, 'shiftShape')),
            depthDiff: describe(pick(rows, 'depthDiff')),
            promDiff: describe(pick(rows, 'promDiff')),
            shiftMinClean: describe(pick(clean, 'shiftMin')),
            shiftShapeClean: describe(pick(clean, 'shiftShape')),
          });
        }
      }
    });
    return out;
  }

  // ---------- CSV 행 (python/auto_ver4.py 의 *_rows 함수와 같은 형식) ----------
  const STATUS_LABELS = { ok: '정상', mismatch: '이동량 불일치' };

  function statusLabel(b) {
    if (b.status !== 'missing') return STATUS_LABELS[b.status];
    if (!b.neutral && !b.expressive) return '피크 없음(둘 다)';
    return !b.neutral ? '피크 없음(무)' : '피크 없음(원)';
  }

  const num = (v, digits) => (v === null || v === undefined ? '' : +v.toFixed(digits));
  const g = (v) => String(Math.round(v * 1e6) / 1e6); // Python 의 :g 와 같은 짧은 표기

  function settingsRows(settings) {
    const s = withDefaults(settings);
    return [[
      '분석 설정', `대역 경계(MHz)=${s.bounds.map((b) => g(b / 1e6)).join('/')}`, `최소 돌출도(dB)=${g(s.minProminence)}`,
      `이동량 불일치=|Δf최저점-Δf모양|>max(${g(s.mismatchShift / 1e6)}MHz, ${g(s.mismatchFrac * 100)}%×|Δf|)`,
      `모양 변화=상관<${g(s.shapeNcc)}`,
    ], []];
  }

  /** results: [{ expr, part, attempt, neutral: 파일명, expressive: 파일명, bands }] */
  function bandPairRows(results, settings) {
    const rows = settingsRows(settings).concat([[
      '표정', '부위', 'attempt', '대역', '상태', '모양 변화', '무표정 파일', '원상태 파일',
      '무 f(Hz)', '원 f(Hz)', 'Δf 최저점(Hz)', '|Δf| 최저점(Hz)', 'Δf 모양정렬(Hz)', '상관계수',
      '무 dB', '원 dB', '깊이 차(dB)', '무 돌출도(dB)', '원 돌출도(dB)', '돌출도 차(dB)',
      '무 반치폭(Hz)', '원 반치폭(Hz)']]);
    for (const r of results) {
      for (const b of r.bands) {
        const pn = b.neutral || {};
        const pe = b.expressive || {};
        rows.push([
          r.expr, r.part, r.attempt, b.band, statusLabel(b), b.shapeChanged ? '예' : '', r.neutral, r.expressive,
          num(pn.hz, 3), num(pe.hz, 3), num(b.shiftMin, 3), num(b.shiftMin === null ? null : Math.abs(b.shiftMin), 3),
          num(b.shiftShape, 3), num(b.ncc, 6),
          num(pn.db, 6), num(pe.db, 6), num(b.depthDiff, 6),
          num(pn.prominence, 6), num(pe.prominence, 6), num(b.promDiff, 6),
          num(pn.width, 3), num(pe.width, 3)]);
      }
    }
    return rows;
  }

  const STAT_KEYS = [['shiftMin', 'Δf 최저점', 'Hz'], ['absShiftMin', '|Δf| 최저점', 'Hz'],
    ['shiftShape', 'Δf 모양정렬', 'Hz'], ['depthDiff', '깊이 차', 'dB'], ['promDiff', '돌출도 차', 'dB'],
    ['shiftMinClean', 'Δf 최저점(불일치 제외)', 'Hz'], ['shiftShapeClean', 'Δf 모양정렬(불일치 제외)', 'Hz']];

  function bandStatRows(stats, settings) {
    const header = ['대역', '표정', '부위', '쌍 수', '피크 없음', '이동량 불일치', '모양 변화'];
    for (const [, lab, unit] of STAT_KEYS) header.push(`${lab} 평균(${unit})`, `${lab} SD(${unit})`);
    const rows = settingsRows(settings).concat([header]);
    for (const st of stats) {
      const line = [st.band, st.expr, st.part, st.pairs, st.missing, st.mismatch, st.shapeChanged];
      for (const [key, , unit] of STAT_KEYS) {
        const digits = unit === 'Hz' ? 3 : 6;
        line.push(num(st[key].mean, digits), num(st[key].sd, digits));
      }
      rows.push(line);
    }
    return rows;
  }

  const MATRIX_ITEMS = [['Δf 최저점(Hz)', 'shiftMin', 3], ['Δf 모양정렬(Hz)', 'shiftShape', 3],
    ['깊이 차(dB)', 'depthDiff', 6], ['돌출도 차(dB)', 'promDiff', 6], ['상태', 'status', null], ['모양 변화', 'shapeChanged', null]];

  /** matrix: attemptMatrix(results, unpaired) 결과 */
  function bandMatrixRows(matrix, settings) {
    const s = withDefaults(settings);
    const rows = settingsRows(s).concat([['대역', '표정', '부위', '항목', ...matrix.attempts.map(String)]]);
    bandRanges(s.bounds).forEach((band, bi) => {
      for (const grp of matrix.groups) {
        const cells = new Map(grp.rows.map((row) => [row.attempt, row]));
        for (const [lab, key, digits] of MATRIX_ITEMS) {
          const line = [band.name, grp.expr, grp.part, lab];
          for (const a of matrix.attempts) {
            const row = cells.get(a);
            if (!row) { line.push(''); continue; }
            if (!row.result) { line.push('짝 없음'); continue; }
            const b = row.result.bands[bi];
            if (key === 'status') line.push(statusLabel(b));
            else if (key === 'shapeChanged') line.push(b.shapeChanged ? '예' : '');
            else if (b.status === 'missing') line.push('피크 없음');
            else line.push(num(b[key], digits));
          }
          rows.push(line);
        }
      }
    });
    return rows;
  }

  return {
    statusLabel, settingsRows, bandPairRows, bandStatRows, bandMatrixRows,
    EXPRESSIONS, PARTS, EXPRESSION_NAMES, PART_NAMES, DEFAULT_SETTINGS,
    parseCsv, parseFileName, label, checkPair, comparePeaks, buildPairs, groupStats, attemptMatrix, mean, stdev,
    withDefaults, bandRanges, findDips, parabolicMin, halfWidth, bandPeak, interpAt, shapeShift, compareBands, describe, bandStats,
  };
});
