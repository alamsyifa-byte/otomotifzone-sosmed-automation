# Rancangan link-in-bio OtomotifZone

## Perilaku publik

Halaman publik menampilkan identitas OtomotifZone, tombol Website, YouTube/Live Streaming, Donate/Saweria, lalu grid tiga kolom dengan urutan terbaru ke terlama. Setiap kartu adalah tautan langsung menuju URL artikel `otomotifzone.com`. Halaman tidak mempunyai login, editor, atau endpoint tulis.

Menu donasi membuka dua pilihan resmi: `https://bagibagi.co/OtomotifZone` dan `https://saweria.co/OtomotifZone`.

Prototipe memakai subdomain sementara `link.139-190-98-210.sslip.io`. Domain final dapat diganti menjadi `link.otomotifzone.com` setelah pemilik DNS membuat record **A** bernama `link` ke `139.190.98.210`. Domain utama dan hosting WordPress tidak perlu dipindahkan. Caddy akan menerbitkan dan memperbarui sertifikat HTTPS otomatis setelah DNS aktif.

Metadata Open Graph memakai gambar default `https://otomotifzone.com/wp-content/uploads/2025/03/logo-otomotifzone.png` berukuran 622×678 agar pratinjau tautan menampilkan logo. Metadata judul, deskripsi, canonical URL, dan Twitter card juga tersedia.

## Hubungan data

Satu item ditentukan oleh pasangan unik `(wp_post_id, design_version)`. `instagram_media_id` juga unik. Kolom minimum yang disimpan:

| Kelompok | Kolom |
| --- | --- |
| Artikel | `wp_post_id`, `article_title`, `article_url`, `category`, `author` |
| Desain | `design_version`, `image_url`, `thumbnail_url`, `alt_text` |
| Copy | `caption` |
| Approval | `approval_status`, `approved_by_user_id`, `approved_by_name`, `approved_at` |
| Instagram | `instagram_status`, `instagram_container_id`, `instagram_media_id`, `instagram_permalink`, `instagram_published_at` |
| Galeri | `gallery_status`, `visible_at` |
| Pemulihan | `last_error`, `retry_count`, `next_retry_at`, `created_at`, `updated_at` |

Database menolak `gallery_status='visible'` kecuali approval sudah `approved`, Instagram sudah `published`, media ID tersedia, serta waktu publikasi dan waktu tampil tersedia. URL artikel dibatasi ke HTTPS pada domain `otomotifzone.com`.

## Urutan eksekusi final

1. Keputusan Approve dikunci oleh layanan approval yang sudah ada.
2. Outbox unik mereservasi pekerjaan untuk pasangan artikel dan versi desain.
3. Instagram membuat container, memeriksa status, lalu memublikasikan media.
4. Setelah Meta mengembalikan media ID dan permalink, n8n melakukan **upsert** item link-in-bio dengan kunci `(wp_post_id, design_version)`.
5. Transaksi mengubah item menjadi `visible` hanya jika data Instagram lengkap.
6. Telegram channel menerima hasil final.

Callback atau retry yang sama mengembalikan item yang sudah ada. Versi desain baru memakai `design_version` baru; versi lama tetap tersembunyi. Jika publikasi Instagram gagal atau hasilnya tidak pasti, item tetap `pending`/`failed` dan tidak muncul di halaman. Retry menggunakan baris yang sama dan tidak membuat kartu baru.

## Tahapan penerapan

1. **Prototipe terpisah — selesai:** halaman dan tabel baru dengan satu artikel uji Instagram.
2. **Integrasi internal — selesai:** operasi upsert dipanggil dua kali untuk artikel 222860 dan tetap menghasilkan satu kartu.
3. **Produksi — aktif:** workflow callback menjalankan Instagram → upsert link-in-bio → channel Telegram. Domain final masih menunggu record DNS.

Gambar grid memakai `loading="lazy"`, ukuran intrinsik 540×675, teks alternatif, dan judul fallback. Tahap integrasi akan menambahkan thumbnail ringan 540×675 agar grid banyak item tetap cepat tanpa mengubah desain Instagram 1080×1350 atau desain master 1080×1440.

## Tracking privat

Halaman mencatat `page_view` dan `link_click` untuk Website, YouTube, Instagram, Bagibagi, Saweria, dan setiap artikel. Tautan tetap menuju alamat aslinya; browser mengirim event melalui `sendBeacon` ketika tautan ditekan. Data yang disimpan hanya jenis perangkat, host referrer, parameter UTM, waktu, ID artikel/versi, dan hash pengunjung harian yang tidak menyimpan alamat IP mentah. Bot pratinjau media sosial tidak dihitung. Role web hanya mendapat `SELECT` pada item serta `INSERT` pada tabel event; ia tidak dapat mengubah konten galeri.

View internal `analytics_daily`, `analytics_links`, `analytics_articles`, dan `analytics_sources` menyiapkan angka untuk dashboard privat atau laporan Telegram: kunjungan, perkiraan pengunjung unik harian, total klik, rasio klik, tombol yang diklik, artikel terpopuler, dan sumber kampanye.
