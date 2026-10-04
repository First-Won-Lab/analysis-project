"""
auto_ver4.py - 무표정 vs 원상태 공진 피크 일괄 비교

파일명 규칙으로 '무표정'과 '원상태' 파일을 자동으로 짝지어 비교한다.

파일명 규칙:  ..._<표정> <부위> <attempt>[ 무].csv
    표정: 놀 / 화 / 웃      부위: 눈 / 입 / 볼
    예) 260819_홍원기_놀 눈 1 무.csv  <->  260819_홍원기_놀 눈 1.csv

[분석 정의 v2 - 기본] 대역별 공진 dip
    - dip: 돌출도(주변 대비 깊이)가 최소 돌출도 이상인 국소 최저점
    - 대역(R1~R4)마다 돌출도가 가장 큰 dip 을 그 대역의 피크로 쓴다 (포물선 보간)
    - Δf 최저점   = f원 - f무 (+ 면 고주파 쪽 이동)
    - Δf 모양정렬 = 무표정 dip 주변 곡선을 원상태 위에서 밀어 정규화 상관이 최대인 이동량
    - 깊이 차     = dB원 - dB무 (- 면 더 깊어짐),  돌출도 차 = 돌출도원 - 돌출도무
    - 이동량 불일치 = |Δf 최저점 - Δf 모양정렬| > max(10 MHz, |Δf 최저점| × 15%)  (불일치 제외 통계에서 뺌)
    - 모양 변화     = 모양 정렬 상관계수 < 0.9  (정보용 표시)
[이전 방식 - 참고용] 전체 최저점 (auto_ver3 기준): |Δf|, |ΔdB| 절대값

저장 CSV (출력폴더/<시각>/):
    대역별_쌍별 / 대역별_통계 / 대역별_attempt별 / 이전방식_쌍별 / 이전방식_통계 / 제외파일

사용법:
    python auto_ver4.py                                  # 폴더 선택 창
    python auto_ver4.py <폴더> [-o <출력폴더>] [--bounds 450,1100,2000] [--min-prom 3]

표준 라이브러리만 사용한다. 웹앱(assets/analysis.js)과 결과가 같아야 한다.
"""
import argparse
import csv
import glob
import math
import os
import re
import statistics
import sys
import unicodedata
from datetime import datetime

EXPRESSIONS = ['놀', '화', '웃']
PARTS = ['눈', '입', '볼']
EXPRESSION_NAMES = {'놀': '놀람', '화': '화남', '웃': '웃음'}
PART_NAMES = {'눈': '눈꼬리', '입': '입', '볼': '볼'}

NAME_PATTERN = re.compile(r'(놀|화|웃)\s*(눈|입|볼)\s*(\d+)(\s*무)?\s*\.csv$', re.IGNORECASE)

DEFAULT_SETTINGS = {
    'bounds': [450e6, 1100e6, 2000e6],  # 대역 경계 (R1 | R2 | R3 | R4), Hz
    'min_prominence': 3.0,              # dip 으로 인정할 최소 돌출도 (dB)
    'shape_min_window': 30e6,           # 모양 정렬 비교 창 반폭 최소값 (Hz)
    'shape_width_factor': 1.5,          # 비교 창 반폭 = max(최소값, 반치폭 × 이 값)
    'shape_search': 300e6,              # 모양 정렬 이동 탐색 범위 ± (Hz)
    'mismatch_shift': 10e6,             # 이동량 불일치: 두 이동량 차이 > max(이 값,
    'mismatch_frac': 0.15,              #                 |Δf 최저점| × 이 비율)
    'shape_ncc': 0.9,                   # 모양 변화: 상관계수 < 이 값
}

STATUS_LABELS = {'ok': '정상', 'mismatch': '이동량 불일치'}


# ==========================================
# CSV 읽기 / 이전 방식 피크 (auto_ver3 와 동일한 기준)
# ==========================================
def read_curve(file_path):
    """A열 주파수(Hz), B열 Return Loss(dB)를 읽는다. 숫자가 아닌 행은 건너뛴다.
    반환: {'freq': [...], 'db': [...], 'peak': (hz, db) | None}  (peak = 전체 최저점, 동률이면 먼저 나온 행)"""
    freq, db = [], []
    peak = None
    with open(file_path, 'r', encoding='utf-8-sig') as file:
        for row in csv.reader(file):
            if len(row) < 2:
                continue
            try:
                hz = float(row[0])
                b = float(row[1])
            except ValueError:
                continue
            freq.append(hz)
            db.append(b)
            if peak is None or b < peak[1]:
                peak = (hz, b)
    return {'freq': freq, 'db': db, 'peak': peak}


def find_min_b_value_info(file_path):
    """CSV 파일에서 B열의 최저값과 해당 행의 A열 주파수 값을 추출하는 함수 (auto_ver3 호환)."""
    return read_curve(file_path)['peak']


# ==========================================
# 분석 정의 v2: 대역별 공진 dip  (assets/analysis.js 와 같은 알고리즘)
# ==========================================
def band_ranges(bounds):
    edges = [float('-inf')] + list(bounds) + [float('inf')]
    return [{'name': f'R{i + 1}', 'lo': edges[i], 'hi': edges[i + 1]} for i in range(len(edges) - 1)]


def find_dips(curve, min_prominence):
    """국소 최저점과 돌출도. 반환: [{'index', 'prominence'}] (min_prominence 이상만)"""
    d = curve['db']
    n = len(d)
    out = []
    for i in range(1, n - 1):
        if not (d[i] < d[i - 1] and d[i] <= d[i + 1]):
            continue
        j, lm = i, d[i]
        while j > 0 and d[j - 1] >= d[i]:
            j -= 1
            if d[j] > lm:
                lm = d[j]
        k, rm = i, d[i]
        while k < n - 1 and d[k + 1] >= d[i]:
            k += 1
            if d[k] > rm:
                rm = d[k]
        prominence = min(lm, rm) - d[i]
        if prominence >= min_prominence:
            out.append({'index': i, 'prominence': prominence})
    return out


def parabolic_min(curve, i):
    f, d = curve['freq'], curve['db']
    if i <= 0 or i >= len(d) - 1:
        return f[i], d[i]
    y0, y1, y2 = d[i - 1], d[i], d[i + 1]
    den = y0 - 2 * y1 + y2
    if den <= 0:
        return f[i], d[i]
    o = 0.5 * (y0 - y2) / den
    return f[i] + o * (f[i + 1] - f[i]), y1 - 0.25 * (y0 - y2) * o


def half_width(curve, i, prominence):
    f, d = curve['freq'], curve['db']
    level = d[i] + prominence / 2
    j = i
    while j > 0 and d[j] < level:
        j -= 1
    k = i
    while k < len(d) - 1 and d[k] < level:
        k += 1
    return f[k] - f[j]


def band_peak(curve, dips, band):
    best = None
    for dip in dips:
        hz = curve['freq'][dip['index']]
        if hz < band['lo'] or hz >= band['hi']:
            continue
        if best is None or dip['prominence'] > best['prominence']:
            best = dip
    if best is None:
        return None
    hz, db = parabolic_min(curve, best['index'])
    return {'index': best['index'], 'hz': hz, 'db': db, 'prominence': best['prominence'],
            'width': half_width(curve, best['index'], best['prominence'])}


def interp_at(curve, x):
    f = curve['freq']
    n = len(f)
    if x < f[0] or x > f[n - 1]:
        return None
    if x == f[n - 1]:
        return curve['db'][n - 1]
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if f[mid] <= x:
            lo = mid
        else:
            hi = mid
    a = (x - f[lo]) / (f[lo + 1] - f[lo])
    return curve['db'][lo] * (1 - a) + curve['db'][lo + 1] * a


def shape_shift(neutral, peak_n, expressive, band, s):
    """모양 정렬 이동량. 반환: (shift, ncc) | None"""
    f = neutral['freq']
    w = max(s['shape_min_window'], s['shape_width_factor'] * peak_n['width'])
    xs, ref = [], []
    for i in range(len(f)):
        if peak_n['hz'] - w <= f[i] <= peak_n['hz'] + w:
            xs.append(f[i])
            ref.append(neutral['db'][i])
    if len(xs) < 3:
        return None
    mr = sum(ref) / len(ref)
    ref = [v - mr for v in ref]
    nr = math.sqrt(sum(v * v for v in ref))
    if nr == 0:
        return None

    step = (f[-1] - f[0]) / (len(f) - 1)
    big_k = math.floor(s['shape_search'] / step)
    cs = []
    for k in range(-big_k, big_k + 1):
        sh = k * step
        c = peak_n['hz'] + sh
        if c < band['lo'] or c >= band['hi']:
            cs.append(None)
            continue
        seg = []
        for x in xs:
            v = interp_at(expressive, x + sh)
            if v is None:
                seg = None
                break
            seg.append(v)
        if seg is None:
            cs.append(None)
            continue
        ms = sum(seg) / len(seg)
        num = 0.0
        ss = 0.0
        for i in range(len(seg)):
            b = seg[i] - ms
            num += ref[i] * b
            ss += b * b
        cs.append(num / (nr * math.sqrt(ss)) if ss > 0 else None)
    bi = -1
    for i, c in enumerate(cs):
        if c is not None and (bi == -1 or c > cs[bi]):
            bi = i
    if bi == -1:
        return None
    shift = (bi - big_k) * step
    if 0 < bi < len(cs) - 1 and cs[bi - 1] is not None and cs[bi + 1] is not None:
        y0, y1, y2 = cs[bi - 1], cs[bi], cs[bi + 1]
        den = y0 - 2 * y1 + y2
        if den < 0:
            shift += 0.5 * (y0 - y2) / den * step
    return shift, cs[bi]


def compare_bands(neutral, expressive, s):
    dips_n = find_dips(neutral, s['min_prominence'])
    dips_e = find_dips(expressive, s['min_prominence'])
    rows = []
    for band in band_ranges(s['bounds']):
        pn = band_peak(neutral, dips_n, band)
        pe = band_peak(expressive, dips_e, band)
        row = {'band': band['name'], 'neutral': pn, 'expressive': pe, 'status': 'missing', 'shape_changed': False,
               'shift_min': None, 'shift_shape': None, 'ncc': None, 'depth_diff': None, 'prom_diff': None}
        if pn and pe:
            row['shift_min'] = pe['hz'] - pn['hz']
            row['depth_diff'] = pe['db'] - pn['db']
            row['prom_diff'] = pe['prominence'] - pn['prominence']
            sh = shape_shift(neutral, pn, expressive, band, s)
            if sh:
                row['shift_shape'], row['ncc'] = sh
            tol = max(s['mismatch_shift'], s['mismatch_frac'] * abs(row['shift_min']))
            row['status'] = 'mismatch' if (sh is None or abs(row['shift_min'] - sh[0]) > tol) else 'ok'
            row['shape_changed'] = sh is None or sh[1] < s['shape_ncc']
        rows.append(row)
    return rows


def status_label(row):
    if row['status'] != 'missing':
        return STATUS_LABELS[row['status']]
    if not row['neutral'] and not row['expressive']:
        return '피크 없음(둘 다)'
    return '피크 없음(무)' if not row['neutral'] else '피크 없음(원)'


def summarize(values):
    """{'n', 'mean', 'sd'} - 값이 없으면 mean/sd 는 None, 1개면 sd 는 None"""
    if not values:
        return {'n': 0, 'mean': None, 'sd': None}
    return {'n': len(values), 'mean': statistics.mean(values),
            'sd': statistics.stdev(values) if len(values) > 1 else None}


def band_stats(results, s):
    out = []
    for bi, band in enumerate(band_ranges(s['bounds'])):
        for expr in EXPRESSIONS:
            for part in PARTS:
                all_rows = [r for r in results if r['expr'] == expr and r['part'] == part]
                if not all_rows:
                    continue
                rows = [r['bands'][bi] for r in all_rows if r['bands'][bi]['status'] != 'missing']
                clean = [b for b in rows if b['status'] == 'ok']

                def pick(arr, key):
                    return [b[key] for b in arr if b[key] is not None]

                out.append({
                    'band': band['name'], 'expr': expr, 'part': part,
                    'pairs': len(all_rows), 'missing': len(all_rows) - len(rows), 'mismatch': len(rows) - len(clean),
                    'shape_changed': sum(1 for b in rows if b['shape_changed']),
                    'shift_min': summarize(pick(rows, 'shift_min')),
                    'abs_shift_min': summarize([abs(v) for v in pick(rows, 'shift_min')]),
                    'shift_shape': summarize(pick(rows, 'shift_shape')),
                    'depth_diff': summarize(pick(rows, 'depth_diff')),
                    'prom_diff': summarize(pick(rows, 'prom_diff')),
                    'shift_min_clean': summarize(pick(clean, 'shift_min')),
                    'shift_shape_clean': summarize(pick(clean, 'shift_shape')),
                })
    return out


# ==========================================
# 파일명 해석 / 쌍 구성
# ==========================================
def parse_file_name(file_name):
    """파일명에서 (표정, 부위, attempt, 무표정 여부)를 꺼낸다. 규칙에 안 맞으면 None."""
    name = unicodedata.normalize('NFC', file_name)
    m = NAME_PATTERN.search(name)
    if not m:
        return None
    return {
        'expr': m.group(1),
        'part': m.group(2),
        'attempt': int(m.group(3)),
        'neutral': m.group(4) is not None,
    }


def collect_files(target_folder, exclude_folder=None):
    """폴더를 재귀 탐색해 CSV 목록을 모은다. 같은 파일명은 한 번만 쓴다
    (통합 폴더와 종합 폴더를 같이 골랐을 때의 중복 방지)."""
    paths = sorted(glob.glob(os.path.join(target_folder, '**', '*.csv'), recursive=True))
    files = {}
    duplicates = []
    for path in paths:
        if exclude_folder and os.path.abspath(path).startswith(os.path.abspath(exclude_folder) + os.sep):
            continue
        name = unicodedata.normalize('NFC', os.path.basename(path))
        if name in files:
            duplicates.append(path)
            continue
        files[name] = path
    return files, duplicates


def build_pairs(files):
    """파일명을 기준으로 무표정/원상태 쌍을 만든다.
    반환: (pairs, unrecognized, unpaired)"""
    slots = {}
    unrecognized = []
    for name in sorted(files):
        path = files[name]
        info = parse_file_name(name)
        if info is None:
            unrecognized.append(name)
            continue
        key = (info['expr'], info['part'], info['attempt'])
        role = 'neutral' if info['neutral'] else 'expressive'
        slot = slots.setdefault(key, {})
        if role in slot:
            # 같은 표정·부위·attempt·역할의 파일이 이름만 다르게 두 개 이상
            unrecognized.append(name)
            continue
        slot[role] = (name, path)

    pairs = []
    unpaired = []
    for key in sorted(slots, key=lambda k: (EXPRESSIONS.index(k[0]), PARTS.index(k[1]), k[2])):
        slot = slots[key]
        if 'neutral' in slot and 'expressive' in slot:
            pairs.append({'expr': key[0], 'part': key[1], 'attempt': key[2],
                          'neutral': slot['neutral'], 'expressive': slot['expressive']})
        else:
            for name, _ in slot.values():
                unpaired.append(name)
    return pairs, sorted(unrecognized), unpaired


def compare_pair(pair, settings=None):
    """한 쌍을 비교한다. 이전 방식 값(neutral_hz 등)과 대역별 결과('bands')를 함께 담는다."""
    s = dict(DEFAULT_SETTINGS, **(settings or {}))
    cn = read_curve(pair['neutral'][1])
    ce = read_curve(pair['expressive'][1])
    if cn['peak'] is None or ce['peak'] is None:
        return None
    n, e = cn['peak'], ce['peak']
    return {
        **pair,
        'neutral_hz': n[0], 'neutral_db': n[1],
        'expressive_hz': e[0], 'expressive_db': e[1],
        'abs_delta_hz': abs(e[0] - n[0]),
        'abs_delta_db': abs(e[1] - n[1]),
        'bands': compare_bands(cn, ce, s),
    }


# ==========================================
# 이전 방식 통계 / attempt 표
# ==========================================
def describe(values):
    mean = statistics.mean(values)
    stdev = statistics.stdev(values) if len(values) > 1 else None
    return mean, stdev


def group_stats(results):
    groups = {}
    for r in results:
        groups.setdefault((r['expr'], r['part']), []).append(r)
    stats = []
    for expr in EXPRESSIONS:
        for part in PARTS:
            rows = groups.get((expr, part))
            if not rows:
                continue
            hz_mean, hz_sd = describe([r['abs_delta_hz'] for r in rows])
            db_mean, db_sd = describe([r['abs_delta_db'] for r in rows])
            stats.append({'expr': expr, 'part': part, 'count': len(rows),
                          'hz_mean': hz_mean, 'hz_sd': hz_sd,
                          'db_mean': db_mean, 'db_sd': db_sd})
    return stats


def attempt_matrix(results, unpaired):
    """비교군(표정·부위) × attempt 표. assets/analysis.js 의 attemptMatrix 와 같은 구조.
    반환: (attempts, groups)
        attempts: 전체 비교군의 attempt 합집합 (정렬)
        groups: [{'expr', 'part', 'rows': [{'attempt', 'result' | None, 'unpaired' | None}]}]"""
    all_attempts = set()
    groups = []
    for expr in EXPRESSIONS:
        for part in PARTS:
            by_attempt = {}
            for r in results:
                if r['expr'] == expr and r['part'] == part:
                    by_attempt[r['attempt']] = {'attempt': r['attempt'], 'result': r, 'unpaired': None}
            for name in unpaired:
                info = parse_file_name(name)
                if info and info['expr'] == expr and info['part'] == part and info['attempt'] not in by_attempt:
                    by_attempt[info['attempt']] = {'attempt': info['attempt'], 'result': None, 'unpaired': name}
            if not by_attempt:
                continue
            rows = [by_attempt[k] for k in sorted(by_attempt)]
            all_attempts.update(by_attempt)
            groups.append({'expr': expr, 'part': part, 'rows': rows})
    return sorted(all_attempts), groups


# ==========================================
# CSV 행 (웹앱 다운로드와 같은 형식)
# ==========================================
def num(v, digits):
    return '' if v is None else round(v, digits)


def settings_rows(s):
    bounds = '/'.join(f"{b / 1e6:g}" for b in s['bounds'])
    return [['분석 설정', f"대역 경계(MHz)={bounds}", f"최소 돌출도(dB)={s['min_prominence']:g}",
             f"이동량 불일치=|Δf최저점-Δf모양|>max({s['mismatch_shift'] / 1e6:g}MHz, {s['mismatch_frac'] * 100:g}%×|Δf|)",
             f"모양 변화=상관<{s['shape_ncc']:g}"], []]


def band_pair_rows(results, s):
    rows = settings_rows(s) + [[
        '표정', '부위', 'attempt', '대역', '상태', '모양 변화', '무표정 파일', '원상태 파일',
        '무 f(Hz)', '원 f(Hz)', 'Δf 최저점(Hz)', '|Δf| 최저점(Hz)', 'Δf 모양정렬(Hz)', '상관계수',
        '무 dB', '원 dB', '깊이 차(dB)', '무 돌출도(dB)', '원 돌출도(dB)', '돌출도 차(dB)',
        '무 반치폭(Hz)', '원 반치폭(Hz)']]
    for r in results:
        for b in r['bands']:
            pn, pe = b['neutral'] or {}, b['expressive'] or {}
            rows.append([
                r['expr'], r['part'], r['attempt'], b['band'], status_label(b), '예' if b['shape_changed'] else '',
                r['neutral'][0], r['expressive'][0],
                num(pn.get('hz'), 3), num(pe.get('hz'), 3), num(b['shift_min'], 3),
                num(None if b['shift_min'] is None else abs(b['shift_min']), 3),
                num(b['shift_shape'], 3), num(b['ncc'], 6),
                num(pn.get('db'), 6), num(pe.get('db'), 6), num(b['depth_diff'], 6),
                num(pn.get('prominence'), 6), num(pe.get('prominence'), 6), num(b['prom_diff'], 6),
                num(pn.get('width'), 3), num(pe.get('width'), 3)])
    return rows


STAT_KEYS = [('shift_min', 'Δf 최저점', 'Hz'), ('abs_shift_min', '|Δf| 최저점', 'Hz'),
             ('shift_shape', 'Δf 모양정렬', 'Hz'), ('depth_diff', '깊이 차', 'dB'), ('prom_diff', '돌출도 차', 'dB'),
             ('shift_min_clean', 'Δf 최저점(불일치 제외)', 'Hz'), ('shift_shape_clean', 'Δf 모양정렬(불일치 제외)', 'Hz')]


def band_stat_rows(stats, s):
    header = ['대역', '표정', '부위', '쌍 수', '피크 없음', '이동량 불일치', '모양 변화']
    for _, label, unit in STAT_KEYS:
        header += [f'{label} 평균({unit})', f'{label} SD({unit})']
    rows = settings_rows(s) + [header]
    for st in stats:
        line = [st['band'], st['expr'], st['part'], st['pairs'], st['missing'], st['mismatch'], st['shape_changed']]
        for key, _, unit in STAT_KEYS:
            digits = 3 if unit == 'Hz' else 6
            line += [num(st[key]['mean'], digits), num(st[key]['sd'], digits)]
        rows.append(line)
    return rows


MATRIX_ITEMS = [('Δf 최저점(Hz)', 'shift_min', 3), ('Δf 모양정렬(Hz)', 'shift_shape', 3),
                ('깊이 차(dB)', 'depth_diff', 6), ('돌출도 차(dB)', 'prom_diff', 6), ('상태', 'status', None),
                ('모양 변화', 'shape_changed', None)]


def band_matrix_rows(attempts, groups, s):
    rows = settings_rows(s) + [['대역', '표정', '부위', '항목'] + [str(a) for a in attempts]]
    for bi, band in enumerate(band_ranges(s['bounds'])):
        for g in groups:
            cells = {row['attempt']: row for row in g['rows']}
            for label, key, digits in MATRIX_ITEMS:
                line = [band['name'], g['expr'], g['part'], label]
                for a in attempts:
                    row = cells.get(a)
                    if row is None:
                        line.append('')
                    elif row['result'] is None:
                        line.append('짝 없음')
                    else:
                        b = row['result']['bands'][bi]
                        if key == 'status':
                            line.append(status_label(b))
                        elif key == 'shape_changed':
                            line.append('예' if b['shape_changed'] else '')
                        elif b['status'] == 'missing':
                            line.append('피크 없음')
                        else:
                            line.append(num(b[key], digits))
                rows.append(line)
    return rows


def legacy_pair_rows(results):
    rows = [['표정', '부위', 'attempt', '무표정 파일', '원상태 파일',
             '무표정 주파수(Hz)', '무표정 피크(dB)', '원상태 주파수(Hz)', '원상태 피크(dB)', '|Δf|(Hz)', '|ΔdB|']]
    for r in results:
        rows.append([r['expr'], r['part'], r['attempt'], r['neutral'][0], r['expressive'][0],
                     r['neutral_hz'], r['neutral_db'], r['expressive_hz'], r['expressive_db'],
                     r['abs_delta_hz'], round(r['abs_delta_db'], 6)])
    return rows


def legacy_stat_rows(stats):
    rows = [['표정', '부위', '쌍 수', '|Δf| 평균(Hz)', '|Δf| 표준편차(Hz)', '|ΔdB| 평균', '|ΔdB| 표준편차']]
    for st in stats:
        rows.append([st['expr'], st['part'], st['count'], st['hz_mean'],
                     '' if st['hz_sd'] is None else st['hz_sd'],
                     st['db_mean'], '' if st['db_sd'] is None else st['db_sd']])
    return rows


# ==========================================
# 출력
# ==========================================
def fmt_mhz(hz, signed=False):
    if hz is None:
        return '-'
    return f"{hz / 1e6:+.2f}" if signed else f"{hz / 1e6:.2f}"


def fmt_ms(summary, scale=1e6, signed=True):
    if summary['mean'] is None:
        return '-'
    m = summary['mean'] / scale
    sd = '' if summary['sd'] is None else f"±{summary['sd'] / scale:.2f}"
    return (f"{m:+.2f}" if signed else f"{m:.2f}") + sd


def print_report(stats, legacy_stats, unrecognized, unpaired, duplicates, failed, s):
    bounds = ' / '.join(f"{b / 1e6:g}" for b in s['bounds'])
    print(f"====== 📊 대역별 공진 비교 (원상태 − 무표정) · 대역 경계 {bounds} MHz · 최소 돌출도 {s['min_prominence']:g} dB ======")
    print(f"{'대역':<3} {'표정':<3} {'부위':<3} {'쌍':>3} {'없음':>3} {'불일치':>3} {'모양':>3} | "
          f"{'Δf 최저점(MHz)':>16} {'Δf 모양(MHz)':>16} | {'깊이 차(dB)':>14} {'돌출도 차(dB)':>14}")
    print("-" * 104)
    for st in stats:
        print(f"{st['band']:<4} {st['expr']:<3} {st['part']:<3} {st['pairs']:>4} {st['missing']:>4} {st['mismatch']:>5} {st['shape_changed']:>4} | "
              f"{fmt_ms(st['shift_min']):>16} {fmt_ms(st['shift_shape']):>16} | "
              f"{fmt_ms(st['depth_diff'], 1):>14} {fmt_ms(st['prom_diff'], 1):>14}")

    print("\n====== 📎 이전 방식 (전체 최저점, 절대값) ======")
    print(f"{'표정':<4} {'부위':<4} {'쌍 수':>5} | {'|Δf| 평균(MHz)':>14} {'|Δf| SD(MHz)':>14} | "
          f"{'|ΔdB| 평균':>10} {'|ΔdB| SD':>10}")
    print("-" * 80)
    for st in legacy_stats:
        hz_sd = '-' if st['hz_sd'] is None else fmt_mhz(st['hz_sd'])
        db_sd = '-' if st['db_sd'] is None else f"{st['db_sd']:.4f}"
        print(f"{st['expr']:<4} {st['part']:<4} {st['count']:>5} | "
              f"{fmt_mhz(st['hz_mean']):>14} {hz_sd:>14} | {st['db_mean']:>10.4f} {db_sd:>10}")

    if unpaired or unrecognized or duplicates or failed:
        print("\n====== ⚠️ 비교에서 제외된 파일 ======")
        for name in unpaired:
            print(f"[짝 없음]      {name}")
        for name in unrecognized:
            print(f"[파일명 규칙 X] {name}")
        for name in failed:
            print(f"[데이터 추출 실패] {name}")
        if duplicates:
            print(f"[중복 파일명]  {len(duplicates)}개는 같은 이름의 파일이 이미 있어 건너뜀")


def write_csv(path, rows):
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        csv.writer(f).writerows(rows)
    return path


def choose_folder():
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    print("폴더 선택 창을 띄웁니다. 화면 뒤에 숨어있을 수 있으니 작업 표시줄을 확인해주세요!")
    return filedialog.askdirectory(title="분석할 CSV 데이터 폴더를 선택하세요")


def parse_bounds(text):
    values = [float(v) * 1e6 for v in text.split(',')]
    if len(values) != 3 or any(b <= a for a, b in zip(values, values[1:])):
        raise argparse.ArgumentTypeError('대역 경계는 오름차순 MHz 값 3개여야 합니다. 예) 450,1100,2000')
    return values


def main(argv=None):
    parser = argparse.ArgumentParser(description='무표정 vs 원상태 공진 피크 일괄 비교')
    parser.add_argument('folder', nargs='?', help='CSV 가 들어 있는 폴더 (하위 폴더 포함)')
    parser.add_argument('-o', '--out', help='결과 CSV 저장 폴더 (기본: 현재 폴더/auto_ver4_results)')
    parser.add_argument('--bounds', type=parse_bounds, default=DEFAULT_SETTINGS['bounds'],
                        help='대역 경계 MHz 3개 (기본: 450,1100,2000)')
    parser.add_argument('--min-prom', type=float, default=DEFAULT_SETTINGS['min_prominence'],
                        help='dip 최소 돌출도 dB (기본: 3)')
    args = parser.parse_args(argv)
    s = dict(DEFAULT_SETTINGS, bounds=args.bounds, min_prominence=args.min_prom)

    target_folder = args.folder or choose_folder()
    if not target_folder:
        print("❌ 폴더 선택이 취소되었습니다. 프로그램을 종료합니다.")
        return 1
    if not os.path.isdir(target_folder):
        print(f"❌ 폴더를 찾을 수 없습니다: {target_folder}")
        return 1

    out_root = args.out or os.path.join(os.getcwd(), 'auto_ver4_results')
    print(f"\n선택된 폴더: [{target_folder}]")
    print("데이터를 분석 중입니다...\n")

    files, duplicates = collect_files(target_folder, exclude_folder=out_root)
    if not files:
        print("❌ 선택한 폴더 및 하위 폴더에 .csv 파일이 존재하지 않습니다.")
        return 1

    pairs, unrecognized, unpaired = build_pairs(files)
    results, failed = [], []
    for pair in pairs:
        r = compare_pair(pair, s)
        if r is None:
            failed.extend([pair['neutral'][0], pair['expressive'][0]])
        else:
            results.append(r)

    if not results:
        print("❌ 비교 가능한 무표정/원상태 쌍이 없습니다.")
        print_report([], [], unrecognized, unpaired, duplicates, failed, s)
        return 1

    stats = band_stats(results, s)
    legacy = group_stats(results)
    print_report(stats, legacy, unrecognized, unpaired, duplicates, failed, s)

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_dir = os.path.join(out_root, stamp)
    os.makedirs(out_dir, exist_ok=True)
    attempts, groups = attempt_matrix(results, unpaired)
    paths = [
        write_csv(os.path.join(out_dir, '대역별_쌍별.csv'), band_pair_rows(results, s)),
        write_csv(os.path.join(out_dir, '대역별_통계.csv'), band_stat_rows(stats, s)),
        write_csv(os.path.join(out_dir, '대역별_attempt별.csv'), band_matrix_rows(attempts, groups, s)),
        write_csv(os.path.join(out_dir, '이전방식_쌍별.csv'), legacy_pair_rows(results)),
        write_csv(os.path.join(out_dir, '이전방식_통계.csv'), legacy_stat_rows(legacy)),
    ]
    excluded = ([('짝 없음', n) for n in unpaired]
                + [('파일명 규칙 불일치', n) for n in unrecognized]
                + [('데이터 추출 실패', n) for n in failed])
    if excluded:
        paths.append(write_csv(os.path.join(out_dir, '제외파일.csv'), [['사유', '파일명']] + excluded))
    print(f"\n💾 결과 저장: {out_dir}")
    for p in paths:
        print(f"   {os.path.basename(p)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
