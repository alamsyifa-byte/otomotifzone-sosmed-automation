# Status antrean, arsip, pemulihan, monitoring, domain, dan dashboard — 26 September 2026

## Antrean artikel

Workflow `OZApprovalStageV1` tidak lagi bergantung pada jendela 20 artikel WordPress. Layanan approval menyimpan watermark WordPress dan mengumpulkan semua halaman baru sampai watermark lama ditemukan. Artikel disimpan di `oz_approval.ingestion_articles`, diproses dari yang paling lama, dan diklaim dengan lease 20 menit. Eksekusi yang berhenti sebelum selesai akan tersedia kembali setelah lease habis. Penyelesaian antrean baru dicatat setelah pesan approval siap.

Uji lonjakan memasukkan 20 artikel sintetis dan mengirim 20 klaim bersamaan. Hasil: 20 klaim, 20 ID unik, 20 selesai, tanpa klaim ganda. Data sintetis telah dihapus. Watermark awal produksi adalah post WordPress `222864`.

## Arsip foto

Renderer tidak lagi menghapus media setelah 30 hari. Setiap render menyimpan:

- foto sumber berdasarkan SHA-256 agar sumber yang sama tidak diduplikasi;
- desain master 1080×1440;
- desain Instagram 1080×1350;
- file media publik yang dipakai Meta.

Uji satu artikel nyata menghasilkan satu arsip sumber dan dua arsip desain.

## Pemulihan parsial dan monitoring

Node internal, AI, download, renderer, dan operasi idempoten memakai maksimum tiga percobaan. Node dengan efek eksternal ambigu, yaitu `media_publish` Instagram dan pengiriman channel Telegram, tetap tidak dicoba ulang otomatis agar tidak membuat posting ganda.

Outbox yang berhenti sebelum mempunyai ID container Instagram akan kembali ke antrean secara otomatis. Revisi/render ulang yang berhenti sebelum versi anak dibuat juga kembali ke antrean. Keadaan sesudah efek eksternal yang hasilnya tidak pasti diberi status `unknown` dan tampil pada dashboard untuk rekonsiliasi manusia.

`ops/monitor.sh` berjalan setiap lima menit dan mencatat kesehatan HTTP, container, jumlah antrean, status yang perlu perhatian, outbox bermasalah, dan penggunaan disk. `ops/backup.sh` berjalan setiap hari pukul 02.30 WIB dan mempertahankan backup otomatis selama 14 hari.

Backup penuh `/home/JEF4090/n8n/backups/automatic-20260926-044248` telah diuji dengan restore ke container PostgreSQL sementara. Hasil restore: 18 workflow, 11 keputusan approval, tabel ingestion terbaca, satu item link-in-bio, checksum valid, dan arsip renderer valid. Database produksi tidak diubah oleh uji restore.

## Dashboard privat

Dashboard tersedia sementara di `https://link.139-190-98-210.sslip.io/dashboard`. Tanpa Basic Auth server menjawab HTTP 401; dengan credential privat menjawab HTTP 200. Dashboard menampilkan views, pengunjung unik, klik, rasio klik, tren 30 hari, tautan dan artikel teratas, antrean artikel, approval tertunda, kartu galeri, serta kegagalan yang perlu perhatian.

## Domain final

Caddy sudah memiliki konfigurasi `link.otomotifzone.com`, termasuk route `/oz-media/*` ke renderer dan route halaman ke link-bio. DNS Cloudflare untuk hostname `link` belum tersedia pada saat pemeriksaan. Setelah record DNS dibuat, environment `OZ_LINKBIO_PUBLIC_URL` dan `OZ_PUBLIC_MEDIA_BASE` perlu dialihkan ke domain final lalu layanan link-bio dan renderer dibuat ulang. Caddy akan memperoleh sertifikat HTTPS otomatis.
