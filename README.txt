# Balık Tutma Şansı – PWA (v0.2)

- **Yenilik:** Günlük kartlarda **"en iyi avlanma saatleri (ilk 3)"** bilgisi.
- Otomatik güncelleme: Konum/Gün değişir değişmez veriler çekilir (buton yok).
- Kaynaklar: Nominatim (geocoding) + Open-Meteo (hava + ay evresi).

## Çalıştırma (yerel)
1) `python -m http.server 5173` veya `npx http-server -p 5173`
2) `http://localhost:5173`

## GitHub Pages'e kurulum (statik hosting)
### A) Basit yöntem (branch'tan yayın)
1. GitHub'da yeni bir repo oluştur (örn. `balik-sansi`).
2. Bu klasörün içeriğini **root'a** koy ve push et.
3. Repo > Settings > **Pages** bölümünde:
   - **Source:** "Deploy from a branch"
   - **Branch:** `main` / `/root`
4. Verilen URL'yi aç (HTTPS). iPhone'da **Ana Ekrana Ekle**.

### B) GitHub Actions (opsiyonel, gelişmiş)
`.github/workflows/pages.yml` hazır. `main`'e push edince otomatik yayınlar.

## Notlar
- Üretimde Nominatim'e yoğun istek göndermemek için bir **backend proxy** veya ücretli jeokod servisi önerilir.
- Open-Meteo ücretsizdir; yoğun kullanımda kendi cache/proxy'n iyi olur.
- iOS’ta PWA sınırlamaları vardır; HTTPS (GitHub Pages) üzerinde Ana Ekrana Ekle ile en iyi deneyimi alırsın.
- Servis işçisi (`sw.js`) versiyon değiştirildiğinde (balik-sansi-v2) eski cache temizlenir.

— Oluşturuldu: 2025-11-11T15:42:01
