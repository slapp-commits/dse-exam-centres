# DSE 考試地點助手 — M2 PWA (uat6)

靜態 PWA：接 M1 2026 資料 + 地政總署／map.gov.hk 底圖（Leaflet XYZ）。檔案喺 repository root，GitHub Pages 由 `/` 發佈。

**Pages:** https://slapp-commits.github.io/dse-exam-centres/

## 開啟

```bash
python3 -m http.server 8080
# 開 http://localhost:8080/
```

PWA／Add to Home Screen 需要 https 或 localhost。

## DoD 對照

1. 讀入 `centres_geocoded`／subjects／timetable（打包喺 `data/sample.js`）
2. 新增試場：科目 autocomplete → 時間表預填 → 試場編號／名帶出地址＋lat／lng
3. 地圖只顯示用戶 markers；marker ↔ list info card；可刪
4. 篩選：科目／考試日期／倒數
5. localStorage `dse_exams_v3`
6. Navigate：系統地圖 deep link（有定位會帶 origin）
7. manifest + service worker
8. Mobile-first

## 底圖

- Basemap: `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png`
- Labels: `.../xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png`
- © 地政總署 LandsD
