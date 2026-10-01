# Kesiapan operasi 24 jam — 26 September 2026

Workflow produksi `OZApprovalStageV1` dan `OZCallbackStageV1` berstatus aktif/Published. Workflow uji tetap nonaktif. Setelah uji lengkap dua artikel, jadwal otomatis juga memproses artikel baru `222884` sampai pesan approval Telegram `2016` dan status `waiting_approval` tanpa pemicu manual.

Container PostgreSQL, n8n, renderer, layanan approval, link-in-bio, dan Caddy berjalan dengan kebijakan restart `unless-stopped`; container yang memiliki health check dilaporkan sehat. Halaman n8n dan link-in-bio merespons HTTP 200. Disk VPS terpakai 19%.

Cron aktif: `ops/monitor.sh` tiap lima menit dan `ops/backup.sh` setiap hari pukul 02.30 WIB. Monitor terakhir mencatat n8n=200, linkbio=200, semua container berjalan, serta tidak ada status keputusan/outbox yang memerlukan perhatian. Cadangan penuh setelah perubahan dibuat di VPS pada `/home/JEF4090/n8n/backups/automatic-20260926-114040`; checksum dump database, konfigurasi, dan arsip renderer semuanya valid. Uji restore terisolasi atas cadangan sebelumnya sudah lulus sebagaimana dicatat pada `STATUS_RESILIENCE_DASHBOARD_2026-09-26.md`.

Operasi tetap bergantung pada masa berlaku token Instagram. Token produksi yang diperpanjang pengguna tersimpan sebagai credential n8n dan perlu diperbarui sebelum kedaluwarsa. Domain final `link.otomotifzone.com` menunggu pengaturan DNS administrator; URL sementara masih aktif. Monitor saat ini menulis riwayat di VPS dan dashboard, belum mengirim peringatan proaktif ke pengelola.
