# Calon fitur Instagram Collaborator — tinjauan sebelum produksi

Status: **tersimpan lokal, belum diimpor/diaktifkan di n8n VPS, tidak ada posting produksi dalam pengujian ini**.

Sumber pemetaan: `approval-service/instagram-collaborators.json`. Usernames diambil dari daftar yang diberikan pengguna pada 26 September 2026; parameter `stkn` pada tautan tidak disimpan. Dua akun default selalu `dewantara_ar`, `ediimola`. Author di luar daftar tidak memperoleh collaborator ketiga. Pencocokan nama tepat sesudah merapikan spasi/kapitalisasi; alias eksplisit `Edi Imola` dan variasi apostrof Ja’far didukung. Data author berasal dari metadata WordPress yang tertanam (`_embedded.author[0].name`) dan disimpan bersama versi desain.

| Skenario | Hasil kering |
| --- | --- |
| Dewantara Ramadhan | `dewantara_ar`, `ediimola` |
| Edi Imola | `dewantara_ar`, `ediimola` |
| Alpacino | `dewantara_ar`, `ediimola`, `liealpacino` |
| Ahmad Fathoni | `dewantara_ar`, `ediimola`, `abibejho` |
| Penulis tak dikenal | `dewantara_ar`, `ediimola` |
| Username kosong | `dewantara_ar`, `ediimola` |
| Akun penulis sama dengan default | tidak duplikat |
| Username diawali `@` | `@` dibuang |
| Carousel | collaborator pada parent saja (uji aturan payload; belum ada workflow carousel produksi) |
| Story | tanpa collaborator (uji aturan payload; belum ada workflow Story produksi) |
| Lebih dari tiga kandidat | konfigurasi tidak sah ditolak; hasil sah maksimal tiga |
| Meta menolak pembuatan container | jalur error berakhir pada catatan manual; tidak menuju `media_publish` |

Payload contoh yang aman ditinjau, tanpa token:

```json
{
  "endpoint": "POST graph.facebook.com/v26.0/{IG_USER_ID}/media",
  "image_url": "https://{HOST}/oz-media/{DESIGN_VERSION}.jpg",
  "caption": "{CAPTION_FINAL}",
  "collaborators": "[\"dewantara_ar\",\"ediimola\",\"liealpacino\"]"
}
```

`collaborators` dikirim sebagai parameter query berisi array JSON melalui HTTP Request n8n; parameter tersebut tidak ada di `media_publish`. Credential tetap memakai n8n Credential yang sudah ada. Saat container dibuat, status tersimpan `NOT_SENT`; setelah posting terbit menjadi `PENDING` karena penerimaan undangan oleh author tidak otomatis. Kegagalan create-container disimpan sebagai `FAILED` tanpa token atau respons rahasia.

Pengujian lokal: `node --test approval-service/collaborators.test.mjs` menghasilkan 14/14 lulus. Pemeriksaan sintaks layanan dan grafik JSON kandidat juga lulus. Ini **belum membuktikan Meta menerima undangan nyata**. Sebelum aktivasi, bandingkan ekspor workflow VPS terbaru dengan calon JSON, lakukan uji container tanpa `media_publish` pada akun uji, lalu satu artikel dengan persetujuan eksplisit. Karena ada aturan pengguna agar melihat dry-run terlebih dahulu, dua workflow produksi tetap berjalan tanpa fitur baru.

Untuk menambah penulis, edit satu entri `authors` pada `approval-service/instagram-collaborators.json`; tambahkan nama utama, alias yang benar-benar pasti, username tanpa `@`, dan `collab_enabled`. Setelah perubahan ditinjau dan layanan di-deploy ulang, versi approval baru memakai pemetaan baru. Versi desain lama tetap menyimpan daftar yang dahulu disetujui.
