"""weple에서 내보낸 CSV를 가계부앱 가져오기용 CSV로 변환한다. (지출·저축만 가져옴)

사용법: python3 tools/migrate.py data/weple_2026-09-27.csv data/이전내역_변환.csv
"""
import csv
import sys
from collections import Counter

SRC, DST = sys.argv[1], sys.argv[2]

EXPENSE_RENAME = {
    '문화생활': '취미/문화생활',
    '교육': '자기개발',
    '선물': '경조사/선물',
    '식비/약속': '식비',
    '식비/회사': '식비',
    '건강한 간식': '간식',
}
FIXED = {  # 고정지출 → 상세내역 기준으로 나눔
    '통신비': '통신비',
    '월세': '월세', '월세-설거지-방': '월세', '관리비': '월세',
    'yes24 북클럽': '취미/문화생활', '티빙': '취미/문화생활', '멜론': '취미/문화생활', '넷플릭스': '취미/문화생활',
    '신용카드 연회비': '기타', '생활비': '기타',
}
DATE = {  # 데이트 → 상세내역 기준으로 나눔
    '밥': '식비', '한강라면': '식비', '닭꼬치': '식비',
    '카페': '간식', '영집이 빵': '간식', '팝콘': '간식', '간식': '간식', '빵': '간식', '버터떡': '간식', '빵/영화관': '간식',
    '카공': '카공', '스터디룸': '카공', '택시': '교통비', '하늘공원 열차': '취미/문화생활', '영화': '취미/문화생활',
}
EXPENSE_CATS = {'식비', '간식', '카공', '생필품', '취미/문화생활', '자기개발', '의료/건강', '의류', '미용',
                '여행', '경조사/선물', '가전', '교통비', '통신비', '월세', '기타'}


def convert(r):
    """(구분, 카테고리)를 돌려준다. 가져오지 않을 내역(수입·투자)은 None."""
    cat, desc = r['Category'], r['Description'].strip()
    if r['Income/Expense'] == 'Income' or desc == '삼전':
        return None
    if cat == '저축':
        if desc == '청약':
            return '저축', '청약'
        if desc in ('월세_저축', '여행자금', '비상금'):
            return '저축', '비상금'
        return '저축', '적금'
    if cat == '고정지출':
        return '지출', FIXED[desc]
    if cat == '데이트':
        return '지출', DATE[desc]
    if cat == '식비/약속' and desc == '카페':
        return '지출', '간식'
    if cat == '간식' and '카공' in desc:
        return '지출', '카공'
    cat = EXPENSE_RENAME.get(cat, cat)
    assert cat in EXPENSE_CATS, cat
    return '지출', cat


rows = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
rows.sort(key=lambda r: r['Date'])  # 오래된 것부터 시트에 쌓이도록
out, cnt = [], Counter()
for r in rows:
    tc = convert(r)
    if not tc:
        continue
    cnt[tc] += 1
    out.append({'ID': f'w{len(out):05d}', '날짜': r['Date'], '구분': tc[0], '카테고리': tc[1],
                '상세내역': r['Description'].strip(), '금액': int(r['Amount'].replace(',', '')), '메모': r['Memo']})

with open(DST, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)

for k, v in sorted(cnt.items()):
    print(k, v)
print('total', len(out))
