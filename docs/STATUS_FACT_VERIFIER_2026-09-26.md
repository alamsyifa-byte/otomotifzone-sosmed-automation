# Status Fact Verifier OtomotifZone — 26 September 2026

Fact Verifier aktif sebelum Telegram approval pada workflow `OZApprovalStageV1`. Urutannya sekarang: AI menulis copy, sistem menyiapkan teks sumber artikel, Fact Verifier memeriksa klaim sensitif, sistem memvalidasi kutipan bukti secara deterministik, lalu desain dan pesan approval dibuat.

Pemeriksaan mencakup nama, tim/merek, angka, tahun/tanggal/waktu, lokasi, kelas lomba, posisi/hasil, jabatan, dan hubungan sebab-akibat. Status yang dikirim ke grup adalah `PASS`, `WARNING`, atau `FAIL`. Pesan Telegram menampilkan ringkasan dan maksimal enam bukti kutipan. Angka pada copy juga dibandingkan langsung dengan teks sumber; angka yang tidak ditemukan membuat status `FAIL`.

Verifier hanya menilai konsistensi copy terhadap artikel WordPress OtomotifZone. Ia tidak menyatakan bahwa isi artikel telah dibuktikan oleh sumber eksternal.

Hasil verifikasi, ringkasan, pemeriksaan per klaim, kutipan, dan penanda kecocokan kutipan disimpan di `content_json` bersama `design_version`. Jalur Revisi dan Render Ulang mengambil artikel WordPress lagi dan menjalankan verifikasi baru sebelum membuat pesan approval versi berikutnya.

Uji terisolasi memakai artikel WordPress 222852 dan berhenti sebelum Telegram. Hasilnya `PASS` dengan tujuh pemeriksaan; seluruh kutipan terverifikasi sebagai substring persis dari artikel. Uji penyimpanan layanan approval juga lulus dan data sintetis telah dihapus. Workflow uji `OZFactVerifierTestV1` dinonaktifkan setelah pengujian.

Versi produksi aktif setelah pemasangan:

- `OZApprovalStageV1`: `2c047bbe-6b3e-4337-b92d-a75fe0dc4552`
- `OZCallbackStageV1`: `6b26dd48-8ca0-42af-b009-5fbb932b307b`

Cadangan sebelum perubahan berada di `/home/JEF4090/n8n/backups/fact-verifier-20260926-040534`. `.env`, encryption key, database utama, dan volume lama tidak ditimpa.
