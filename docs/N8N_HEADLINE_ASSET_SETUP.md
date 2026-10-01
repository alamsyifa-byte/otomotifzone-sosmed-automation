# Memasang pemetaan aset dan headline di n8n

Panduan ini menyiapkan susunan node untuk workflow yang ada. Saat menambahkannya lewat editor n8n, biarkan workflow tetap nonaktif sampai aset yang diperlukan tersedia dan jalur review dipasang.

## Alur headline

1. Biarkan `Basic LLM Chain → Parse LLM JSON` seperti sekarang.
2. Tambah panggilan model **Headline Refiner** setelah parser. Beri headline/subheadline draft dan judul/isi WordPress dari node `Limit` untuk artikel yang sama. Gunakan prompt generator/perbaikan dari `HEADLINE_FLOW.md`. Ini menambah satu panggilan AI per artikel. Ekspresi `$('Limit').item...` harus tetap terhubung ke artikel yang benar saat node dipasang; verifikasi pasangan item pada satu eksekusi sebelum workflow diaktifkan.
3. Parse keluaran refiner pada jalur terpisah. Gabungkan hanya `headline` dan `subheadline` ke item lama dari `Parse LLM JSON`. Field caption, kategori, author, foto, source URL, dan `post_id` harus berasal dari item lama.
4. Setelah merge, tambah **Code** bernama `Headline Validator`; gunakan kode di `HEADLINE_FLOW.md`.
5. Tambah **IF** berdasarkan `headline_valid`.
6. Cabang benar lanjut ke penyiapan desain.
7. Cabang salah masuk ke satu kali penulisan ulang saja. Sertakan daftar pelanggaran tanpa mengganti judul/isi sumber. Jalankan validator lagi.
8. Jika masih salah, beri status `needs_review` dan tahan agar tidak terkirim sebagai desain final.

Mulai `headline_retry_count` dari 0; naikkan ke 1 sebelum panggilan ulang, lalu hentikan percobaan setelah itu.

Renderer produksi n8n menerima headline sampai 12 kata/80 karakter dan tetap menolak teks yang tidak muat dalam dua baris. Headline boleh memakai nama pendek yang didukung artikel; subheadline harus mempertahankan nama lengkap. Subheadline memakai font lebih kecil (24–28 px) agar headline tetap menjadi fokus. Prototipe HTML lokal masih terpisah; jangan anggap batas prototipe sebagai batas renderer di VPS.

## Pemetaan gambar kategori/author

Gunakan [`../design-assets/asset-map.json`](../design-assets/asset-map.json) sebagai daftar nama, alias, dan path PNG. Di renderer, pilih path berdasarkan `category` dan `author` pada item yang sama. Jangan meminta AI menulis label yang sudah tercetak di PNG. Tetap bawa field kategori/author sebagai teks untuk caption dan arsip.

Untuk penggantian badge selanjutnya, tim dapat mengganti PNG dengan nama file yang sama. Untuk menambah kategori atau author baru, perbarui manifest dan tambahkan PNG di folder terkait. Kategori tanpa PNG memakai badge News sesuai arahan; author tanpa PNG dibiarkan kosong.

## Siap sebelum gambar Telegram

Milla Moskova sudah memiliki badge PNG. Sebelas kategori tanpa badge tepat memakai fallback News; `International.png` tidak dipakai untuk `Internasional` karena labelnya berbeda. Author kosong/tidak cocok ditampilkan dengan kotak polos.

Renderer belum berada di server. File ini dan prompt/kode adalah rancangan siap pasang, bukan klaim node n8n sudah dibuat. Tetap gunakan ukuran desain 1080×1440; verifikasi format/rasio Meta saat integrasi Instagram dikerjakan.
