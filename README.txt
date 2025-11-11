# Balık Tutma Şansı – PWA (v0.4.2)

- **Sharper Gaussian**: sigma azaltıldı, ağırlıklar ayarlandı → daha dalgalı skorlar
- **Stronger twilight**: gün doğumu/batımı piki artırıldı
- **Lighter moon effect**: moonrise/moonset katkısı azaltıldı
- Astronomy isteği opsiyonel (fallback), sunrise/sunset forecast.daily'den
- Dinamik eşik (p70, 55..85), 0–24 eksen, modal grafik ve markerlar

## Yerel çalıştırma
1) `python -m http.server 5173` veya `npx http-server -p 5173`
2) `http://localhost:5173`

## Yayın (GitHub Pages)
- Repo köküne kopyala → Settings → Pages → `Deploy from a branch` → `main`/`root`
- iPhone’da Safari → siteyi aç → **Ana Ekrana Ekle**

— Oluşturuldu: 2025-11-11T18:34:58
