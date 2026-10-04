# CLAUDE.md

표정(놀람/화남/웃음) × 부위(눈꼬리/입/볼) 센서 측정 CSV(Return Loss 스윕)에서 **무표정 vs 원상태**의 공진 dip을 대역(R1~R4)별로 찾아 주파수 이동(부호 있음) · 깊이 차를 비교하는 도구. GitHub Pages 정적 웹앱 + 로컬 Python 스크립트. 이전 방식(전체 최저점)은 참고용으로만 남아 있다.

## 반드시 지킬 것

- 계산 로직은 `assets/analysis.js`와 `python/auto_ver4.py` **두 곳**에 있다. 한쪽을 바꾸면 다른 쪽도 같이 바꾸고, 공통 케이스 `tests/cases.json`으로 둘 다 검증한다.
- 분석 정의(대역 경계, 최소 돌출도, 모양정렬 창, 불일치 · 모양 변화 기준, 부호 방향, 차단 규칙 등)는 사용자와 합의한 사항이다. **임의로 바꾸지 말고 먼저 묻는다.** 현재 정의와 결정 배경은 `docs/MAINTENANCE.md` §2.
- 계산을 바꾸면 실제 데이터로 웹 CSV와 Python CSV를 칸 단위로 비교해 일치를 확인한다(§5).
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
