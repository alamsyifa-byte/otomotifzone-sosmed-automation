# Status Instagram Collaborator produksi — 26 September 2026

Fitur collaborator sudah dipasang pada workflow utama `OZApprovalStageV1` dan `OZCallbackStageV1`, keduanya aktif. Layanan `n8n-approval-1` memakai pemetaan pada `approval-service/instagram-collaborators.json`; `.env`, credential n8n, encryption key, database, dan volume tidak ditimpa. Cadangan ekspor kedua workflow, file layanan lama, dan dump PostgreSQL 107 MB berada di VPS pada `/home/JEF4090/n8n/backups/collaborator-pre-20260926/`.

Hasil verifikasi:

- Uji Meta melalui workflow tidak aktif `OZIGContainerCheckV1` berhasil membuat container dengan dua default (`dewantara_ar`, `ediimola`) dan dengan tiga akun (`dewantara_ar`, `ediimola`, `liealpacino`). Workflow uji tidak mempunyai node `media_publish`, lalu dikembalikan ke pengaturan semula.
- Ekspor workflow produksi setelah publikasi menunjukkan `source_author` dari metadata WordPress pada persiapan approval; daftar collaborator tampil pada pesan approval dan rework.
- Node `Create Instagram Container` mengirim `image_url`, `caption`, dan `collaborators`; node `Publish Instagram Post` hanya mengirim `creation_id`. Jalur error container menuju `Record Collaboration Error`, bukan ke publikasi.
- Setelah deploy, kedua workflow berstatus aktif, layanan approval dan halaman n8n merespons HTTP 200, serta eksekusi terjadwal masing-masing workflow berstatus sukses.
- Tidak ada artikel baru yang sedang `waiting_approval` atau antrean publikasi saat verifikasi. Belum ada publikasi artikel baru dengan undangan collaborator sesudah deployment; keberhasilan undangan final perlu diamati pada artikel berikutnya yang mendapat approval.

Pemilihan akun: Dewantara dan Edi selalu default; penulis yang cocok mendapat akun ketiga, maksimum tiga. Untuk penulis tanpa akun dalam daftar, hanya dua default. Akun yang diundang harus menerima undangan secara manual. Status `PENDING` setelah posting berarti undangan dikirim tetapi belum dibuktikan diterima.
