<div align="center">

# 📡 표정 공진주파수 비교

**무표정 vs 원상태** 센서 측정 CSV에서 공진 피크와 주파수를 뽑아 차이를 한눈에 비교하는 웹 도구

[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-2a78d6?style=for-the-badge&logo=github)](https://first-won-lab.github.io/analysis-project/)
![HTML](https://img.shields.io/badge/HTML%20%2B%20JS-no%20build-eb6834?style=for-the-badge&logo=javascript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.8%2B-1baf7a?style=for-the-badge&logo=python&logoColor=white)

### 👉 [웹에서 바로 쓰기](https://first-won-lab.github.io/analysis-project/)

</div>

---

## ✨ 무엇을 하나요?

얼굴의 **놀람 · 화남 · 웃음** 표정에서 **눈꼬리 · 입 · 볼** 부위를 센서로 측정한 Return Loss 스윕(CSV)을,
같은 표정 · 부위 · attempt의 **무표정** 측정값과 짝지어 비교합니다.

곡선마다 공진 dip이 여러 개(R1~R4 대역) 있기 때문에, **대역별로 공진 dip을 찾아** 무표정 → 원상태에서
주파수가 **좌우로 얼마나 이동했는지**, **깊이가 어떻게 바뀌었는지**, 그 이동을 **믿을 수 있는지**를 함께 보여 줍니다.

| | |
|---|---|
| 🎯 **피크 정의** | 대역(R1 ~450 · R2 450–1100 · R3 1100–2000 · R4 2000~ MHz)마다 돌출도(주변 대비 깊이) ≥ 3 dB인 dip 중 가장 뚜렷한 것. 포물선 보간으로 측정 간격(≈3 MHz)보다 정밀하게 |
| ↔️ **주파수 이동** | `Δf = f원 − f무` (**+ 오른쪽** / **− 왼쪽**). 최저점 위치 차와 곡선 모양 정렬(정규화 상관) 두 방식으로 계산 |
| 🕳️ **깊이 차** | 절대 dB 차(−면 더 깊어짐)와 돌출도 차(+면 더 뚜렷해짐) |
| 🔍 **이동 판단 기준** | 두 방식이 다르면 **⚠ 이동량 불일치**, dip 모양이 바뀌면 **◐ 모양 변화**로 표시 |
| ⚙️ **설정 가능** | 대역 경계와 최소 돌출도를 화면(또는 CLI 옵션)에서 바꾸면 즉시 다시 계산 |
| 🔒 **개인정보** | 파일은 브라우저 안에서만 처리되고 어디에도 업로드되지 않음 |
| 🚫 **잘못된 짝 차단** | 표정 · 부위 · attempt가 다르거나 둘 다 무표정(또는 둘 다 원상태)이면 비교하지 않고 원인 파일명을 알려 줌 |

정의의 세부 내용과 결정 배경은 [docs/MAINTENANCE.md §2](docs/MAINTENANCE.md#2-현재-분석-정의)에 있습니다.

## 🖼️ 화면

<table>
<tr>
<td width="50%"><b>2개 파일 비교</b><br><img src="docs/images/pair.png" alt="2개 파일 비교 화면"></td>
<td width="50%"><b>일괄 비교</b><br><img src="docs/images/batch.png" alt="일괄 비교 화면"></td>
</tr>
</table>

## 🚀 사용법

### 1) 2개 파일 비교
1. **2개 파일 비교** 탭에서 CSV 2개를 끌어다 놓거나 클릭해서 고릅니다. 어느 쪽이 무표정인지는 파일명의 `무`로 자동 판별합니다.
2. 대역별 카드(이동 방향 화살표 · Δf · 깊이 차 · 상태)와 표가 나옵니다.
3. 곡선 그래프에는 대역 띠, 대역별 피크, **무표정 → 원상태 이동 화살표**가 표시됩니다.

### 2) 일괄 비교
1. **일괄 비교** 탭에서 CSV 여러 개 또는 **폴더 통째로** 올립니다. 파일명으로 쌍을 맞추고, 같은 이름은 한 번만 계산합니다.
2. **대역 탭(R1~R4)**을 고르면 그 대역의
   - 표정 · 부위별 평균 Δf · 깊이 차 그래프(± SD)와 통계 표 (불일치 제외 값 포함)
   - **비교군별 attempt 차이** 표 (attempt마다 Δf 두 방식 · 상관 · 깊이 차 · 돌출도 차 · 상태)
   - 쌍별 결과 표 (표정 · 부위 · 상태 필터, 정렬, 행 클릭 시 곡선)
3. **쌍별 · 통계 · attempt별 CSV**를 내려받을 수 있습니다 (엑셀용 UTF-8 BOM, 첫 줄에 분석 설정 기록).
4. 이전 방식(전체 최저점) 결과는 맨 아래 접힌 섹션에서 참고용으로 볼 수 있습니다.

### 3) 로컬 Python 스크립트
```bash
python python/auto_ver4.py                                   # 폴더 선택 창
python python/auto_ver4.py "<데이터 폴더>" -o 결과폴더
python python/auto_ver4.py "<데이터 폴더>" --bounds 450,1100,2000 --min-prom 3
```
표준 라이브러리만 씁니다. 콘솔에 대역별 통계 · 이전 방식 통계 · 제외 파일을 출력하고, `결과폴더/<시각>/`에 CSV를 저장합니다. 형식은 웹에서 받는 파일과 같습니다.

| 저장 파일 | 내용 |
|---|---|
| `대역별_쌍별.csv` | 쌍 × 대역마다 상태, 무 · 원 피크(주파수 · dB · 돌출도 · 반치폭), Δf 두 방식, 상관계수, 깊이 차, 돌출도 차 |
| `대역별_통계.csv` | 대역 × 표정 · 부위별 쌍 수 · 피크 없음 · 불일치 · 모양 변화 개수와 각 값의 평균 · SD |
| `대역별_attempt별.csv` | 행 = 대역 × 비교군 × 항목, 열 = attempt |
| `이전방식_쌍별.csv`, `이전방식_통계.csv` | 전체 최저점 기준 \|Δf\| · \|ΔdB\| (참고용) |
| `제외파일.csv` | 비교에서 빠진 파일과 사유 (있을 때만) |

## 📁 파일명 규칙

```
<날짜>_<이름>_<표정> <부위> <attempt>[ 무].csv
260819_홍원기_놀 눈 1 무.csv   ← 무표정
260819_홍원기_놀 눈 1.csv      ← 원상태  (위 파일과 비교 대상)
```

| 표정 | 부위 | 무표정 표시 |
|---|---|---|
| `놀` 놀람 · `화` 화남 · `웃` 웃음 | `눈` 눈꼬리 · `입` 입 · `볼` 볼 | 끝에 ` 무` |

CSV는 A열 주파수(Hz), B열 Return Loss(dB)를 읽고, 헤더처럼 숫자가 아닌 행은 건너뜁니다.

## 🗂️ 구조

```
├── index.html              # 웹앱 (GitHub Pages 진입점)
├── assets/
│   ├── analysis.js         # 계산 · CSV 행 (DOM 없음) ──┐ 결과가 같아야 함
│   ├── app.js              # 화면 동작                  │
│   └── style.css           #                            │
├── python/auto_ver4.py     # 로컬 일괄 분석 ────────────┘
├── tests/
│   ├── cases.json          # JS · Python 공통 테스트 케이스
│   ├── test_auto_ver4.py   # python -m unittest discover tests
│   └── analysis.test.html  # 브라우저에서 여는 JS 테스트
├── docs/MAINTENANCE.md     # 유지보수 지침
└── CLAUDE.md               # AI 작업 지침
```

## 🛠️ 개발 · 유지보수

빌드 과정이 없습니다. 로컬 서버로 열어서 확인합니다.

```bash
python -m http.server 8000
# http://localhost:8000/                       → 웹앱
# http://localhost:8000/tests/analysis.test.html → JS 테스트
python -m unittest discover tests              # Python 테스트
```

수정 절차, 검증 체크리스트, 배포 방법은 **[docs/MAINTENANCE.md](docs/MAINTENANCE.md)** 에 있습니다.

## 🌐 배포

`main` 브랜치 루트를 GitHub Pages로 서비스합니다.
**Settings → Pages → Build and deployment → Source: _Deploy from a branch_, Branch: `main` / `(root)`**

---

<div align="center"><sub>First-Won-Lab · 측정 원본 데이터는 이 저장소에 포함하지 않습니다.</sub></div>
