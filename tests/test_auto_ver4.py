"""python/auto_ver4.py 단위 테스트.  실행: python -m unittest discover tests"""
import json
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

    def test_rows(self):
        results = [{'expr': '놀', 'part': '눈', 'attempt': 1, 'abs_delta_hz': 3e6, 'abs_delta_db': 1.5}]
        rows = a.attempt_matrix_rows(*a.attempt_matrix(results, ['x_놀 눈 2 무.csv']))
        self.assertEqual(rows, [['표정', '부위', '항목', '1', '2'],
                                ['놀', '눈', '|Δf|(Hz)', 3e6, '짝 없음'],
                                ['놀', '눈', '|ΔdB|', 1.5, '짝 없음']])


class StatsTest(unittest.TestCase):
    def test_describe(self):
        c = CASES['stats']
        mean, sd = a.describe(c['values'])
        self.assertAlmostEqual(mean, c['mean'])
        self.assertAlmostEqual(sd, c['stdev'])
        self.assertIsNone(a.describe([5])[1])


if __name__ == '__main__':
    unittest.main()
