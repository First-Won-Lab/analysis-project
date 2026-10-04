"""python/auto_ver4.py 단위 테스트.  실행: python -m unittest discover tests"""
import json
import math
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'python'))
import auto_ver4 as a  # noqa: E402

with open(os.path.join(HERE, 'cases.json'), encoding='utf-8') as f:
    CASES = json.load(f)


class FileNameTest(unittest.TestCase):
    def test_parse(self):
        for case in CASES['file_names']:
            with self.subTest(name=case['name']):
                self.assertEqual(a.parse_file_name(case['name']), case['expect'])


class PairCheckTest(unittest.TestCase):
    """웹앱 2개 비교 차단 규칙과 같은 조건: 둘 다 규칙에 맞고, 무 1 + 원 1, 표정·부위·attempt 일치"""

    def check(self, x, y):
        px, py = a.parse_file_name(x), a.parse_file_name(y)
        if not px or not py or px['neutral'] == py['neutral']:
            return None
        if (px['expr'], px['part'], px['attempt']) != (py['expr'], py['part'], py['attempt']):
            return None
        return 0 if px['neutral'] else 1

    def test_pairs(self):
        for case in CASES['pair_checks']:
            with self.subTest(a=case['a'], b=case['b']):
                got = self.check(case['a'], case['b'])
                if case['ok']:
                    self.assertEqual(got, case['neutral'])
                else:
                    self.assertIsNone(got)


class PeakTest(unittest.TestCase):
    def test_peaks(self):
        for i, case in enumerate(CASES['csv_peaks']):
            with self.subTest(i=i):
                with tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False, encoding='utf-8', newline='') as f:
                    f.write(case['text'])
                try:
                    got = a.find_min_b_value_info(f.name)
                finally:
                    os.unlink(f.name)
                exp = case['expect']
                self.assertEqual(got, None if exp is None else (exp['hz'], exp['db']))


class PairingTest(unittest.TestCase):
    def test_build_pairs(self):
        c = CASES['pairing']
        pairs, unrecognized, unpaired = a.build_pairs({n: n for n in c['names']})
        self.assertEqual([[p['expr'], p['part'], p['attempt']] for p in pairs], c['expect_pairs'])
        self.assertEqual(sorted(unpaired), sorted(c['expect_unpaired']))
        self.assertEqual(unrecognized, c['expect_unrecognized'])


class AttemptMatrixTest(unittest.TestCase):
    def test_matrix(self):
        c = CASES['attempt_matrix']
        attempts, groups = a.attempt_matrix(c['results'], c['unpaired'])
        self.assertEqual(attempts, c['expect_attempts'])
        got = [[g['expr'], g['part'], [[r['attempt'], 'pair' if r['result'] else 'unpaired'] for r in g['rows']]]
               for g in groups]
        self.assertEqual(got, c['expect_groups'])

def synth(spec, dips):
    freq = [spec['start'] + i * spec['step'] for i in range(spec['n'])]
    db = [spec['base'] - sum(d['depth'] * math.exp(-((f - d['center']) / d['width']) ** 2) for d in dips) for f in freq]
    return {'freq': freq, 'db': db}


class V2Test(unittest.TestCase):
    def test_find_dips(self):
        c = CASES['v2_find_dips']
        for case in c['cases']:
            got = [[d['index'], d['prominence']] for d in a.find_dips({'db': c['db']}, case['min_prominence'])]
            self.assertEqual(got, case['expect'])

    def test_parabolic(self):
        c = CASES['v2_parabolic']
        hz, db = a.parabolic_min({'freq': c['freq'], 'db': c['db']}, c['index'])
        self.assertAlmostEqual(hz, c['expect']['hz'])
        self.assertAlmostEqual(db, c['expect']['db'])

    def test_synthetic_shift(self):
        c = CASES['v2_synthetic']
        rows = a.compare_bands(synth(c, c['neutral']), synth(c, c['expressive']), a.DEFAULT_SETTINGS)
        for row, exp in zip(rows, c['expect']):
            with self.subTest(band=exp['band']):
                self.assertEqual(row['band'], exp['band'])
                self.assertEqual(row['status'], exp['status'])
                if exp['status'] == 'missing':
                    continue
                self.assertAlmostEqual(row['shift_min'], exp['shift_min'], delta=c['tol_hz'])
                self.assertAlmostEqual(row['shift_shape'], exp['shift_shape'], delta=c['tol_hz'])
                self.assertAlmostEqual(row['depth_diff'], exp['depth_diff'], delta=c['tol_db'])
                self.assertFalse(row['shape_changed'])


class StatsTest(unittest.TestCase):
    def test_describe(self):
        c = CASES['stats']
        mean, sd = a.describe(c['values'])
        self.assertAlmostEqual(mean, c['mean'])
        self.assertAlmostEqual(sd, c['stdev'])
        self.assertIsNone(a.describe([5])[1])


if __name__ == '__main__':
    unittest.main()
