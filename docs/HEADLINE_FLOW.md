# Alur headline OtomotifZone

Revisi berdasarkan 20 gambar dalam folder `REFF Feed OZ `: headline ALL CAPS, maksimal 12 kata DAN 80 karakter; subheadline sentence case, maksimal 20 kata. Keduanya harus muat maksimal dua baris pada template 1080×1440. Prioritaskan headline yang menjelaskan inti berita secara utuh; jangan memanjangkan dengan kata pengisi.

## Tujuan

AI hanya menyusun ulang `headline` dan `subheadline`. Pertahankan `post_id`, sumber, kategori, author, caption, foto, dan field lain dari item masuk. Headline harus menarik dan lugas tetapi setiap nama, angka, hasil, waktu, lokasi, dan klaim tetap didukung artikel. Jangan menambah fakta.

Tidak ada target minimum jumlah karakter. Jangan menambah kata pengisi, tetapi jangan memangkas fakta penting yang membuat inti berita jelas.

## Rangkaian node n8n

`Basic LLM Chain → Parse LLM JSON → Headline Refiner → Parse Refined JSON/Merge → Headline Validator → IF valid?`

- Biarkan model dan parser saat ini membuat semua copy. Refiner menjadi panggilan AI tambahan setelah parser. Ia mempertahankan headline/subheadline bila sudah kuat dan sesuai aturan, atau memperbaiki keduanya jika terlalu panjang, terlalu pendek/generik, atau kurang jelas.
- Gabungkan hanya headline/subheadline hasil refiner kembali ke item lama yang sudah diparse. Jangan minta model menulis ulang category, author, caption, foto, atau data artikel.
- Cabang benar: lanjutkan ke formatter Telegram / renderer.
- Cabang salah pada percobaan pertama: panggil refiner satu kali lagi dengan daftar pelanggaran dari validator; minta hanya headline dan subheadline baru.
- Cabang salah pada percobaan kedua: set `status: needs_review`, simpan pesan pelanggaran, tahan pengiriman desain agar manusia dapat mengedit teks.

Panggilan refiner menambah biaya AI satu kali per artikel, lalu paling banyak sekali lagi untuk retry. Batasi percobaan ulang satu kali supaya AI tidak berputar dan teks sumber tidak berganti tanpa batas. Renderer juga wajib mengukur lebar teks dengan Montserrat yang sesungguhnya. Maksimal dua baris dan batas kata/karakter belum menjamin teks secara visual pasti muat. Bila tidak muat pada ukuran minimum, jangan memotong dengan elipsis; coba satu kali penulisan ulang, lalu tahan untuk tinjauan.

## Prompt generator

Masukkan prompt berikut ke node AI setelah mengisi variabel dari artikel WordPress dan hasil copy awal:

```text
Anda editor headline berita OtomotifZone. Gunakan hanya judul dan isi artikel sumber di bawah ini. Jangan memakai pengetahuan luar atau menambah klaim.

Tugas: tulis ulang HANYA headline dan subheadline. Pertahankan field kategori, author, caption, sumber, dan foto dari data sebelumnya tanpa perubahan.

Headline wajib ALL CAPS, maksimal 12 kata dan maksimal 80 karakter termasuk spasi. Utamakan frasa yang natural, menarik, dan menjelaskan inti berita secara utuh. Jangan menambah kata pengisi atau mengubah fakta. Jika nama lengkap terlalu panjang untuk headline, gunakan nama pendek yang memang dipakai dalam artikel dan jelas merujuk ke orang yang sama.
Subheadline sentence case, satu kalimat, maksimal 20 kata, memberi fakta pendukung yang tidak tertampung di headline. Tulis nama orang secara lengkap sesuai artikel; jangan singkat atau potong nama di subheadline.
Kedua teks harus cocok untuk dua baris atau kurang pada kanvas 1080×1440. Jangan menambahkan tanda elipsis. Jangan memotong fakta.

Sebelum menjawab, hitung kata dan karakter headline sendiri, lalu periksa fakta setiap klaim terhadap artikel. Jika teks sumber tidak cukup mendukung headline yang layak, kembalikan needs_review=true.

Konteks headline/subheadline sebelumnya:
{{ $json.headline }}
{{ $json.subheadline }}

Judul artikel WordPress untuk post yang sama:
{{ $('Limit').item.json.title.rendered }}

Isi artikel:
{{ $('Limit').item.json.content.rendered }}

Jawab HANYA JSON valid tanpa code fence dengan skema:
{"headline":"...","subheadline":"...","needs_review":false,"review_reason":"","fact_basis":"kutipan pendek atau detail sumber yang menopang headline"}
```

Prompt perbaikan satu kali harus memuat nilai `headline`, `subheadline`, `source_title`, `source_content` yang sama dan daftar error validator. Tegaskan agar hanya dua teks itu yang diganti. Jangan mengubah fakta sumber atau metadata artikel.

## Code node `Headline Validator`

Mode: **Run Once for Each Item**. Letakkan setelah parser JSON. Kode ini memeriksa aturan yang bisa dihitung; pemeriksaan lebar font dilakukan di renderer.

```javascript
const inputItem = $input.item;
const item = inputItem.json;
const headline = String(item.headline ?? '').trim().replace(/\s+/g, ' ');
const subheadline = String(item.subheadline ?? '').trim().replace(/\s+/g, ' ');
const errors = [];
const words = headline ? headline.split(' ') : [];
const characters = [...headline].length; // hitung karakter Unicode, termasuk spasi

if (!headline) errors.push('Headline kosong.');
if (headline !== headline.toLocaleUpperCase('id-ID')) errors.push('Headline harus ALL CAPS.');
if (words.length > 12) errors.push(`Headline ${words.length} kata; maksimum 12.`);
if (characters > 80) errors.push(`Headline ${characters} karakter; maksimum 80.`);
if (!subheadline) errors.push('Subheadline kosong.');
if (subheadline.split(' ').filter(Boolean).length > 20) errors.push('Subheadline melebihi 20 kata.');
if (item.needs_review === true) errors.push(item.review_reason || 'AI meminta tinjauan redaksi.');

return {
  ...inputItem, // ikutkan binary dan metadata n8n bila sudah ada
  json: {
    ...item, // kategori, author, caption, foto, sumber, dan post_id tetap utuh
    headline,
    subheadline,
    headline_word_count: words.length,
    headline_character_count: characters,
    headline_errors: errors,
    headline_valid: errors.length === 0,
    status: errors.length === 0 ? 'headline_ready' : 'needs_review',
  },
};
```

Tambahkan IF dengan kondisi `{{$json.headline_valid}} is true`. Jika false, retry hanya bila `headline_retry_count < 1`; selain itu tahan pada `needs_review`. Naikkan counter saat masuk cabang retry. Pastikan cabang yang lolos menggabungkan kembali item WordPress asli tanpa mengganti nilai foto atau identitas artikel.

## Pengamanan makna

Pemeriksaan kata/karakter tidak membuktikan fakta. Generator masih perlu dibatasi ke artikel sumber; nanti tambahkan verifier yang membandingkan nama/angka/klaim dengan bukti sumber sebelum approval. `Confidence` dari model tidak dihitung sebagai bukti. Jangan aktifkan auto-publikasi Instagram pada tahap ini.
