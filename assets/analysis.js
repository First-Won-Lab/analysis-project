/*
 * analysis.js - 피크 추출 / 파일명 해석 / 쌍 비교 로직 (DOM 없음)
 *
 * python/auto_ver4.py 와 같은 결과를 내야 한다. 한쪽을 고치면 다른 쪽도 같이 고친다.
 *  - 피크: B열(Return Loss) 최저값과 그 행의 A열 주파수. 동률이면 먼저 나온 행.
 *  - 비교: |Δf| = |f_원 - f_무| , |ΔdB| = |dB_원 - dB_무|
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

  return {
    EXPRESSIONS, PARTS, EXPRESSION_NAMES, PART_NAMES,
    parseCsv, parseFileName, label, checkPair, comparePeaks, buildPairs, groupStats, mean, stdev,
  };
});
