"""
auto_ver4.py - 무표정 vs 원상태 공진 피크 일괄 비교

auto_ver3.py 의 피크 추출 로직(B열 Return Loss 최저값 + 해당 행 A열 주파수)을 그대로 쓰고,
파일명 규칙으로 '무표정'과 '원상태' 파일을 자동으로 짝지어 비교한다.

파일명 규칙:  ..._<표정> <부위> <attempt>[ 무].csv
    표정: 놀 / 화 / 웃      부위: 눈 / 입 / 볼
    예) 260819_홍원기_놀 눈 1 무.csv  <->  260819_홍원기_놀 눈 1.csv

비교값: |Δf| = |f_원 - f_무| ,  |ΔdB| = |dB_원 - dB_무|  (절대값)

사용법:
    python auto_ver4.py                    # 폴더 선택 창
    python auto_ver4.py <폴더> [-o <출력폴더>]

표준 라이브러리만 사용한다. 웹앱(assets/analysis.js)과 결과가 같아야 한다.
"""
import argparse
import csv
import glob
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


# ==========================================
# 피크 추출 (auto_ver3 와 동일한 기준)
# ==========================================
def find_min_b_value_info(file_path):
    """CSV 파일에서 B열의 최저값과 해당 행의 A열 주파수 값을 추출하는 함수.
    최저값이 여러 개면 가장 먼저 나온 행을 쓴다."""
    min_b = float('inf')
    best_row = None

    with open(file_path, 'r', encoding='utf-8-sig') as file:
        reader = csv.reader(file)

        for row in reader:
            if len(row) < 2:
                continue

            try:
                freq_hz = float(row[0])   # A열: 주파수
                b_value = float(row[1])   # B열: Return Loss (dB)
            except ValueError:
                # 헤더나 숫자가 아닌 행은 건너뜀
                continue

            if b_value < min_b:
                min_b = b_value
                best_row = (freq_hz, b_value)

    return best_row


# ==========================================
# 파일명 해석
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


def compare_pair(pair):
    n = find_min_b_value_info(pair['neutral'][1])
    e = find_min_b_value_info(pair['expressive'][1])
    if n is None or e is None:
        return None
    return {
        **pair,
        'neutral_hz': n[0], 'neutral_db': n[1],
        'expressive_hz': e[0], 'expressive_db': e[1],
        'abs_delta_hz': abs(e[0] - n[0]),
        'abs_delta_db': abs(e[1] - n[1]),
    }


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


# ==========================================
# 출력
# ==========================================
def fmt_mhz(hz):
    return f"{hz / 1e6:.3f}"


def fmt_opt(value, spec):
    return '비교 불가(1회)' if value is None else format(value, spec)


def print_report(results, stats, unrecognized, unpaired, duplicates, failed):
    print("====== 📊 쌍별 비교 결과 (|Δ| = |원상태 - 무표정|) ======")
    print(f"{'표정':<4} {'부위':<4} {'attempt':>7} | {'무 f(MHz)':>10} {'무 dB':>9} | "
          f"{'원 f(MHz)':>10} {'원 dB':>9} | {'|Δf|(MHz)':>10} {'|ΔdB|':>8}")
    print("-" * 92)
    for r in results:
        print(f"{r['expr']:<4} {r['part']:<4} {r['attempt']:>7} | "
              f"{fmt_mhz(r['neutral_hz']):>10} {r['neutral_db']:>9.4f} | "
              f"{fmt_mhz(r['expressive_hz']):>10} {r['expressive_db']:>9.4f} | "
              f"{fmt_mhz(r['abs_delta_hz']):>10} {r['abs_delta_db']:>8.4f}")

    print("\n====== 📈 표정·부위별 통계 (평균 / 표본표준편차) ======")
    print(f"{'표정':<4} {'부위':<4} {'쌍 수':>5} | {'|Δf| 평균(MHz)':>14} {'|Δf| SD(MHz)':>14} | "
          f"{'|ΔdB| 평균':>10} {'|ΔdB| SD':>10}")
    print("-" * 80)
    for s in stats:
        hz_sd = '비교 불가(1회)' if s['hz_sd'] is None else fmt_mhz(s['hz_sd'])
        print(f"{s['expr']:<4} {s['part']:<4} {s['count']:>5} | "
              f"{fmt_mhz(s['hz_mean']):>14} {hz_sd:>14} | "
              f"{s['db_mean']:>10.4f} {fmt_opt(s['db_sd'], '.4f'):>10}")

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


def save_csv(results, stats, excluded, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    pairs_path = os.path.join(out_dir, f'비교결과_쌍별_{stamp}.csv')
    with open(pairs_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['표정', '부위', 'attempt', '무표정 파일', '원상태 파일',
                    '무표정 주파수(Hz)', '무표정 피크(dB)', '원상태 주파수(Hz)', '원상태 피크(dB)',
                    '|Δf|(Hz)', '|ΔdB|'])
        for r in results:
            w.writerow([r['expr'], r['part'], r['attempt'], r['neutral'][0], r['expressive'][0],
                        r['neutral_hz'], r['neutral_db'], r['expressive_hz'], r['expressive_db'],
                        r['abs_delta_hz'], round(r['abs_delta_db'], 6)])

    stats_path = os.path.join(out_dir, f'비교결과_통계_{stamp}.csv')
    with open(stats_path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['표정', '부위', '쌍 수', '|Δf| 평균(Hz)', '|Δf| 표준편차(Hz)',
                    '|ΔdB| 평균', '|ΔdB| 표준편차'])
        for s in stats:
            w.writerow([s['expr'], s['part'], s['count'], s['hz_mean'],
                        '' if s['hz_sd'] is None else s['hz_sd'],
                        s['db_mean'], '' if s['db_sd'] is None else s['db_sd']])

    excluded_path = None
    if excluded:
        excluded_path = os.path.join(out_dir, f'비교결과_제외파일_{stamp}.csv')
        with open(excluded_path, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['사유', '파일명'])
            w.writerows(excluded)

    return pairs_path, stats_path, excluded_path


def choose_folder():
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    print("폴더 선택 창을 띄웁니다. 화면 뒤에 숨어있을 수 있으니 작업 표시줄을 확인해주세요!")
    return filedialog.askdirectory(title="분석할 CSV 데이터 폴더를 선택하세요")


def main(argv=None):
    parser = argparse.ArgumentParser(description='무표정 vs 원상태 공진 피크 일괄 비교')
    parser.add_argument('folder', nargs='?', help='CSV 가 들어 있는 폴더 (하위 폴더 포함)')
    parser.add_argument('-o', '--out', help='결과 CSV 저장 폴더 (기본: 현재 폴더/auto_ver4_results)')
    args = parser.parse_args(argv)

    target_folder = args.folder or choose_folder()
    if not target_folder:
        print("❌ 폴더 선택이 취소되었습니다. 프로그램을 종료합니다.")
        return 1
    if not os.path.isdir(target_folder):
        print(f"❌ 폴더를 찾을 수 없습니다: {target_folder}")
        return 1

    out_dir = args.out or os.path.join(os.getcwd(), 'auto_ver4_results')
    print(f"\n선택된 폴더: [{target_folder}]")
    print("데이터를 분석 중입니다...\n")

    files, duplicates = collect_files(target_folder, exclude_folder=out_dir)
    if not files:
        print("❌ 선택한 폴더 및 하위 폴더에 .csv 파일이 존재하지 않습니다.")
        return 1

    pairs, unrecognized, unpaired = build_pairs(files)
    results, failed = [], []
    for pair in pairs:
        r = compare_pair(pair)
        if r is None:
            failed.extend([pair['neutral'][0], pair['expressive'][0]])
        else:
            results.append(r)

    if not results:
        print("❌ 비교 가능한 무표정/원상태 쌍이 없습니다.")
        print_report([], [], unrecognized, unpaired, duplicates, failed)
        return 1

    stats = group_stats(results)
    print_report(results, stats, unrecognized, unpaired, duplicates, failed)

    excluded = ([('짝 없음', n) for n in unpaired]
                + [('파일명 규칙 불일치', n) for n in unrecognized]
                + [('데이터 추출 실패', n) for n in failed])
    paths = save_csv(results, stats, excluded, out_dir)
    print("\n💾 결과 저장:")
    for p in paths:
        if p:
            print(f"   {p}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
