# Acuan layout feed OtomotifZone

Sumber: 20 PNG 1080×1440 dalam `/Users/jafaralamsyifa/Downloads/REFF Feed OZ `, nomor 409–435. File tersebut adalah contoh visual pengguna; isi beritanya bukan sumber fakta untuk artikel baru.

Pola yang terlihat:

- Headline putih Montserrat Black, umumnya dua baris dan **rata kanan**. Tepi kanan teks sekitar 48 px dari tepi kanvas. Ukuran huruf mengecil secara bertahap untuk headline yang lebih panjang.
- Subheadline putih Montserrat Medium, umumnya dua baris dan rata kanan pada tepi yang sama. Posisi vertikal relatif stabil di sekitar y=1220–1290.
- Bidang merah `#d80101` dimulai sekitar y=1040 pada banyak contoh. Ia bertambah tinggi ke atas untuk headline besar; contoh beragam berkisar y=952–1067.
- Logo atas dimulai sekitar x=50, y=72; badge kategori berada di kanan atas sekitar y=61. Logo bawah di x=50 dengan dasar sekitar y=1400; badge author di kanan bawah dengan dasar sekitar y=1380. Ketika author tidak dikenal, bidang author tetap polos.
- Panjang beberapa headline contoh melampaui aturan lama 8 kata. Aturan produksi sekarang maksimal 12 kata/80 karakter, tetapi batas visual akhir tetap dua baris setelah diukur dengan font asli. Teks yang tidak muat menghasilkan error, tanpa elipsis.

Implementasi produksi berada di `renderer/server.mjs`. Tiga pratinjau dengan headline pendek, sedang, dan panjang ada di `renderer/previews/oz-reference-layout-3-cases.jpg`. Foto dalam pratinjau adalah foto contoh prototipe; artikel nyata selalu menggunakan foto dari alur WordPress.
