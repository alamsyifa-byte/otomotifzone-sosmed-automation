# OtomotifZone Social Media Automation

Repository privat untuk kode sumber dan dokumentasi sistem otomasi media sosial OtomotifZone.

## Komponen

- `approval-service/` — antrean artikel, approval, audit, outbox, dan pemulihan.
- `renderer/` — pembuatan desain master serta ekspor Instagram.
- `linkbio-service/` — link-in-bio, analytics privat, dan dashboard operasi.
- `workflows/` — workflow n8n, kandidat perubahan, dan ekspor produksi terbaru.
- `ops/` — monitoring, backup, dan pengujian restore.
- `design-assets/` — aset desain, kategori, penulis, logo, dan font.
- `docs/` — dokumentasi arsitektur, pengujian, serta catatan operasional.
- `compose.yaml` dan `Caddyfile` — konfigurasi deployment utama.

## Snapshot produksi

`workflows/production/all-workflows-current.json` adalah ekspor seluruh workflow n8n dari VPS pada 1 Oktober 2026. Ekspor berisi referensi ID credential, tetapi tidak berisi nilai token atau password credential.

## Data yang sengaja tidak disimpan di GitHub

Repository ini tidak menyimpan `.env`, password database, encryption key n8n, token Telegram/Meta/OpenAI, credential n8n, dump database, log operasi, arsip media, atau backup VPS. Data tersebut harus tetap dicadangkan melalui mekanisme backup terenkripsi terpisah.

## Aturan deployment

1. Periksa perubahan dan rahasia sebelum commit.
2. Buat backup produksi sebelum deployment.
3. Tarik perubahan dengan `git pull --ff-only`.
4. Bangun ulang hanya layanan yang berubah.
5. Jalankan health check dan smoke test setelah deployment.

