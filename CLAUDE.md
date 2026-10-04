# CLAUDE.md

표정(놀람/화남/웃음) × 부위(눈꼬리/입/볼) 센서 측정 CSV에서 **무표정 vs 원상태**의 공진 피크(Return Loss 최저점)와 주파수 차이를 비교하는 도구. GitHub Pages 정적 웹앱 + 로컬 Python 스크립트.

## 반드시 지킬 것

- 계산 로직은 `assets/analysis.js`와 `python/auto_ver4.py` **두 곳**에 있다. 한쪽을 바꾸면 다른 쪽도 같이 바꾸고, 공통 케이스 `tests/cases.json`으로 둘 다 검증한다.
- 분석 정의(피크 기준, 비교값 부호, 차단 규칙 등)는 사용자와 합의한 사항이다. **임의로 바꾸지 말고 먼저 묻는다.** 현재 정의는 `docs/MAINTENANCE.md` §2.
- 측정 원본 CSV는 커밋하지 않는다 (`.gitignore`의 `*.csv`).
- 빌드 도구 · 프레임워크를 추가하지 않는다. 순수 HTML/CSS/JS, 외부 라이브러리는 cdnjs의 Plotly만.
- 화면 문구는 한국어.

## 명령

```bash
python -m unittest discover tests            # Python 테스트
python -m http.server 8000                   # 웹앱: http://localhost:8000/
                                             # JS 테스트: http://localhost:8000/tests/analysis.test.html (제목 PASS/FAIL)
python python/auto_ver4.py "<데이터 폴더>"    # 로컬 일괄 분석
```

## 참고

- 유지보수 절차와 검증 체크리스트: `docs/MAINTENANCE.md`
- 사용 설명: `README.md`
