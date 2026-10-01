# Status Telegram approval OtomotifZone — 25 September 2026

| Tujuan | Chat ID | Fungsi |
| --- | --- | --- |
| OZ Instagram AI Approval | `-5193846414` | Preview, metadata, empat tombol kontrol |
| OtomotifZone | `-1004347719947` | Foto dan caption final setelah Approve |

Bot `@jafffr_ai_news_bot` terverifikasi sebagai administrator channel dengan izin mengirim pesan. Telegram webhook n8n memakai HTTPS dan hanya menerima `callback_query`.

Workflow lama `R9r2XqDrnFToJHV7` sudah dinonaktifkan pada 25 September 2026 pukul 03.37 WIB. Versi terbit lamanya sebelum perpindahan memiliki deduplikasi aktif; draf editor lama menandai deduplikasi nonaktif dan tidak dipakai untuk alur baru.

Workflow produksi di n8n:

- `OZApprovalStageV1` — tampil sebagai **OtomotifZone - 01 Preview & Approval - PRODUCTION**. WordPress → AI → renderer → preview foto dan pesan bertombol ke grup. Workflow membuat desain master 1080×1440 dan ekspor Instagram 1080×1350 secara terpisah. Node deduplikasi aktif. Setelah pesan approval siap, barulah ID artikel ditulis ke Data Table `processed_articles` yang sudah ada.
- `OZCallbackStageV1` — tampil sebagai **OtomotifZone - 02 Decisions & Publish - PRODUCTION**. Telegram Trigger untuk callback dari grup, pencatatan keputusan atomik, pembaruan pesan grup, penanganan Revisi/Render Ulang, publikasi Instagram, dan pengiriman channel setelah Approve. Bot Telegram dan token Instagram dipakai melalui credential n8n; token tidak tertulis dalam workflow.
- Workflow uji manual mengirim empat artikel tanpa menulis Data Table deduplikasi: 222814 (Approve, pesan kontrol 1987), 222852 (Revisi, 1989), 222808 (Render Ulang, 1991), dan 222790 (Lewati, 1993). Semua pesan diberi label UJI.

Layanan internal `oz-approval:3001` mengakses skema PostgreSQL baru `oz_approval` dengan role terbatas `oz_approval_app`. Ia hanya terhubung pada jaringan Docker internal dan tidak memiliki port publik. File [`../approval-service/schema.sql`](../approval-service/schema.sql) adalah skema aktual; `processed_articles`, volume, database n8n, encryption key, dan `.env` n8n yang lama tidak diubah. Password role baru berada dalam file konfigurasi baru yang hanya dapat dibaca pemilik di VPS.

## Aturan keputusan

Setiap pasangan `(post_id, design_version)` hanya mempunyai satu baris. Callback harus mengandung post ID, versi UUID, aksi yang dikenal, ID grup yang benar, ID pesan approval yang tersimpan, dan identitas pesan bot yang sesuai. Semua anggota grup dapat menekan tombol; tidak ada whitelist User ID. Nama, username, User ID, waktu, aksi, versi, dan ID pesan tercatat pada pemenang.

Layanan mengubah `waiting_approval` dengan satu `UPDATE ... WHERE status='waiting_approval' RETURNING ...` di dalam transaksi PostgreSQL. Callback yang kalah atau diulang tidak dapat membuat keputusan kedua. Aksi Approve, Revisi, dan Render Ulang masing-masing membuat tugas outbox unik dalam transaksi yang sama. Lewati tidak membuat tugas. Tugas berstatus `queued` dapat dipulihkan oleh pemicu jadwal callback; tugas `sending` tidak dikirim ulang otomatis ketika hasil API Telegram belum pasti. Setelah 10 menit hasilnya ditandai `publishing_unknown` atau `failed` untuk pemeriksaan manual. Ini mencegah pengiriman ganda pada kasus koneksi terputus tepat sesudah Telegram menerima pesan.

Approve terlebih dahulu mengunci tugas publikasi, membuat dan memeriksa container media Meta, memublikasikan gambar 1080×1350 ke Instagram, serta menyimpan container ID, media ID, permalink, dan waktu publikasi. Setelah Instagram berhasil, workflow mengirim gambar final, caption, dan link artikel ke channel Telegram lalu mengubah status menjadi `published`. Pesan approval diperbarui dengan link Instagram dan link artikel. Channel tidak menerima draft atau tombol.

Revisi meminta AI membuat headline/subheadline alternatif berdasar artikel asli; Render Ulang memakai teks yang sama dan merender ulang. Keduanya membuat `design_version` baru, dua ukuran desain baru, dan pesan approval baru. Lewati menutup versi tanpa publikasi Instagram maupun kiriman channel. Reservasi outbox tetap atomik; tugas yang sudah masuk keadaan `sending` tidak diulang otomatis bila hasil panggilan eksternal tidak pasti, sehingga retry tidak membuat unggahan ganda.

## Bukti uji dan gerbang produksi

- Satu artikel WordPress nyata (`222814`) berhasil diproses n8n sampai preview foto dan pesan bertombol di grup; status versi 1 menjadi `waiting_approval`.
- Uji database: 20 klaim paralel menghasilkan tepat satu pemenang; empat aksi, klik ulang, chat salah, bot salah, dan gerbang channel lolos.
- Uji webhook n8n: 12 callback paralel dan satu Approve terlambat menghasilkan satu `skipped`, tanpa tugas channel. Nama trigger diubah menjadi `ApprovalTrigger` setelah pengujian menemukan spasi pada path webhook tidak cocok di runtime.
- Revisi dan Render Ulang berhasil melewati AI/renderer, membuat versi 2, dan mencatat status `waiting_approval` dalam uji tanpa kiriman Telegram. Data sintetis ber-ID negatif sudah dibersihkan.
- Channel bot terverifikasi berstatus administrator dengan izin `can_post_messages=true`. Artikel uji 222852 menghasilkan headline yang memakai “Abud/Hafid” dan subheadline yang menulis lengkap “Akbar Abud Afdalah” serta “Hafid Pratama”.
- Eksekusi terjadwal workflow lama pada 25 September (contoh eksekusi 188) menunjukkan `If row does not exist` sukses dan mengeluarkan 0 item untuk artikel yang sudah tercatat. Percobaan CLI pada salinan staging tidak dapat menguji Data Table karena modulnya memang tidak dimuat pada mode CLI (`Attempted to use Data table node but the module is disabled`); itu bukan kegagalan runtime produksi.
- **Uji tombol Telegram nyata lulus:** artikel 222814 Approve → channel pesan 4; artikel 222852 Revisi → versi 2 → Approve → channel pesan 6; artikel 222808 Render Ulang → versi 2 → Approve → channel pesan 5; artikel 222790 Lewati tanpa kiriman channel. Seluruh keputusan menyimpan nama, username, User ID, waktu, chat ID, dan message ID penekan. Setiap outbox hanya memiliki satu percobaan pengiriman.
- Callback ulang dan tindakan berbeda setelah keputusan diuji pada pesan nyata 222814 melalui webhook staging: keputusan tetap milik Ja’far Alamsyifa, `channel_message_id` tetap 4, outbox tetap satu tugas terkirim. Uji file ID sengaja salah membuktikan worker tidak mengirim ulang setelah respons Telegram gagal; data uji negatif sudah dibersihkan.
- **Uji teknis klik serentak diterima pengguna sebagai cukup untuk aktivasi saat ini.** Dua percobaan pada pesan 1999 (artikel 222782) dan 2001 (artikel 222772) masing-masing hanya menghasilkan satu callback manusia dan satu kiriman channel (message ID 7 dan 8). Jadi keduanya belum membuktikan persaingan dua orang nyata. Uji teknis 12 callback `Approve` serentak dengan identitas berbeda melalui webhook n8n menghasilkan tepat satu pemenang dan satu tugas kirim; satu foto uji memakai file ID sengaja tidak valid sehingga tidak ada kiriman channel tambahan. Seluruh baris sintetis sudah dibersihkan. Pengguna akan mengatur uji dua anggota nyata nanti siang.

- **Uji dua anggota nyata lulus pada 25 September 2026 sekitar 12.46 WIB.** Pesan uji grup 2009 memakai ID uji 90925925 dan hanya tombol Lewati supaya channel tidak menerima posting percobaan. Callback dari Ja’far Alamsyifa dan Nazilatul Mubarokah masuk terpaut sekitar 0,3 detik dan eksekusinya bertumpang-tindih. Klaim Ja’far menang; callback Nazilatul kalah. Hanya satu keputusan tersimpan, status `skipped`, dan tidak ada baris outbox/kiriman channel.

- **Uji publikasi Instagram lulus pada 25 September 2026.** Credential n8n `Instagram OZ Test - alamsyifa_corp` berhasil membaca akun profesional `@alamsyifa_corp`, lalu workflow uji satu kali membuat container, menunggu status `FINISHED`, memublikasikan gambar, dan membaca permalink. Media ID hasil uji adalah `18176562682439962` dengan permalink <https://www.instagram.com/p/DdtcEwMGXaj/>. Workflow uji tetap nonaktif agar unggahan tidak terduplikasi.
- Endpoint renderer `/render-instagram` terverifikasi menghasilkan JPEG 1080×1350 dan URL HTTPS publik yang dapat dibaca Meta. Desain master 1080×1440 tetap dipertahankan untuk arsip dan preview Telegram.

Perpindahan produksi dicadangkan di VPS pada `/home/JEF4090/n8n/backups/approval-switch-20260925-033712`. Integrasi Instagram dicadangkan lagi pada `/home/JEF4090/n8n/backups/instagram-production-20260925-192000`; perubahan renderer/Caddy memiliki cadangan `/home/JEF4090/n8n/backups/instagram-renderer-20260925-191500`. Pemeriksaan terakhir: workflow lama nonaktif; dua workflow produksi aktif pada versi terbarunya; webhook callback POST terdaftar; halaman n8n dan `/healthz` menjawab HTTP 200; layanan approval dan renderer sehat; serta tidak ada keputusan berstatus `preparing`, `waiting_approval`, `approved`, atau `publishing` ketika versi baru diterapkan.

Cadangan database sebelum menambah skema ada di VPS: `/home/JEF4090/n8n/backups/oz-before-approval-20260925-024102.dump`. File workflow staging ada di direktori `workflows/` proyek ini.
