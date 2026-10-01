# OtomotifZone HTML Feed Prototype

Prototipe lokal template feed berita 1080 × 1440 px. Tidak memerlukan VPS, Node.js, atau koneksi internet.

## Cara menggunakan

1. Ekstrak ZIP.
2. Di Mac, klik dua kali `START TEMPLATE.command` agar template dibuka melalui server lokal. Tidak ada data yang dikirim ke internet.
3. Alternatif: buka `index.html` langsung memakai Chrome, Edge, atau Safari terbaru. Jika browser menolak ekspor karena aturan akses file lokal, gunakan cara pada langkah 2.
4. Isi headline dan sub-headline.
5. Unggah foto berita, PNG kategori, dan PNG author.
6. Atur fokus horizontal/vertikal foto sampai komposisinya tepat.
7. Klik **Ekspor PNG 1080 × 1440**.

Jika macOS pertama kali menolak file `.command`, klik kanan file tersebut, pilih **Open**, lalu konfirmasi. Skrip memerlukan Python 3 dan hanya menjalankan server pada komputer sendiri di `localhost:8765`.

## Prototipe lokal lama

Halaman HTML ini adalah prototipe eksplorasi. Layout produksi yang mengikuti 20 gambar `REFF Feed OZ ` berada di layanan n8n `renderer/server.mjs`; batas headline saat ini 12 kata/80 karakter. Aturan dan ekspor di bawah hanya berlaku untuk halaman prototipe ini.

- Canvas 1080 × 1440 px.
- Headline Montserrat Black, putih, 72–50 px, maksimal dua baris pada prototipe ini.
- Sub-headline Montserrat Medium, putih, 30–40 px, maksimal dua baris; target awal setengah ukuran headline.
- Box bawah `#d80101`, tinggi 340–480 px dan dihitung dari isi.
- Jarak atas headline 28 px pada prototipe ini.
- Jarak sub-headline ke area logo minimal 25 px.
- Logo atas dan bawah tetap pada posisinya.
- Kategori dan author memakai file PNG yang dapat diganti.
- Foto memakai perilaku `cover` dengan kontrol titik fokus X/Y.
- Jika teks tetap tidak muat pada ukuran minimum, prototipe memberi peringatan dan menambahkan elipsis.

## Catatan untuk tahap n8n

Input kontrol pada prototipe nantinya dapat diganti dengan data JSON dari RSS/AI. Rendering final di VPS dapat menggunakan Chromium/Playwright dengan logika layout yang sama.
