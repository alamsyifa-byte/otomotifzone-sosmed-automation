# Pilihan revisi Telegram (27 September 2026)

Workflow produksi: `OZCallbackStageV1` (OtomotifZone - 02 Decisions & Publish - PRODUCTION). Layanan: `approval-service/server.mjs`. Cadangan sebelum perubahan: `/home/JEF4090/n8n/backups/revision-guidance-pre-20260927/`.

1. Klik **Revisi** pada satu versi desain mengunci keputusan pertama secara atomik menjadi `revision_requested`. Nama, ID Telegram, waktu, artikel, dan versi tetap diaudit. Tombol keputusan pada pesan asli dinonaktifkan.
2. Bot mengirim pilihan **Revisi otomatis** atau **Tulis arahan**. Hanya pengguna yang menekan Revisi boleh memilih. Pilihan disimpan sekali per versi; klik ulang tidak membuat pekerjaan baru.
3. Revisi otomatis mengantre satu pekerjaan `revise`. Untuk arahan, bot mengirim pesan Force Reply. Sistem menerima 5–1000 karakter hanya dari pengguna tersebut, di grup approval yang benar, sebagai balasan ke pesan bot yang tercatat. Balasan lain diabaikan. Satu arahan yang valid mengantre satu pekerjaan `revise`.
4. AI menyesuaikan headline, subheadline, dan caption sesuai arahan jika fakta didukung artikel WordPress. Revisi otomatis mempertahankan caption lama. Fact verifier memeriksa hasil. Jika arahan meminta foto/desain atau fakta tak terbukti, versi berikutnya menampilkan peringatan pemeriksaan manual. Versi baru kembali ke grup approval; tidak otomatis dipublikasikan.
5. Status menunggu pilihan/teks disimpan di `content_json.revision_mode`, bersama ID pesan dan arahan. Antrean outbox tetap unik menurut artikel, versi, dan tindakan.

Uji layanan dengan dua artikel simulasi, tanpa Telegram/Instagram: keputusan pertama, pengguna lain ditolak, balasan yang salah ditolak, arahan ganda ditolak, dan 12 pilihan serentak menghasilkan tepat satu pemenang. Data simulasi dihapus. Pengujian klik melalui Telegram pada artikel nyata masih perlu dilakukan oleh anggota grup.
