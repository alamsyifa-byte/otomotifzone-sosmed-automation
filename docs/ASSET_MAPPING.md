# Pemetaan aset desain OtomotifZone

Aset sumber disalin ke `design-assets/` agar template dan workflow dapat memakai berkas yang sama. Manifest mesin: [`design-assets/asset-map.json`](../design-assets/asset-map.json).

Renderer memilih file badge berdasarkan nama kategori/author, bukan menulis ulang label di atas gambar. Untuk merapikan kategori atau author, ganti PNG pada folder terkait dengan nama file yang sama; renderer tetap dapat memakai pemetaan yang sama. Simpan metadata sebagai teks pada data artikel untuk caption dan pencarian.

## Cakupan kategori

25 nama/ejaan final dicatat di manifest. Aset tepat tersedia untuk 14 kategori. Sebelas kategori lain otomatis memakai badge `News.png` sesuai arahan pengguna; jangan gunakan badge kategori lain yang dapat menyesatkan. Nilai `rendered_category` menyimpan label yang tampil di desain, sedangkan kategori sumber tetap disimpan sebagai `source_category` untuk audit. `Category/Drag Race.png` tidak digunakan karena tidak termasuk daftar final; `Category/International.png` memakai ejaan Inggris sehingga kategori `Internasional` memakai fallback News.

## Cakupan author

Sebelas PNG author yang tersedia tercantum di manifest, termasuk badge Milla Moskova yang baru diterima. Pencocokan memakai nama setelah spasi dirapikan dan huruf dinormalisasi; jangan mencocokkan nama yang mirip secara kabur. Jika author kosong atau tidak memiliki PNG yang cocok, biarkan kotak author polos. Jangan membuat PNG Tim Redaksi atau menampilkan badge author lain sebagai fallback.

## Cara pakai saat renderer dibuat

1. Baca `category` dan `author` dari item artikel yang sudah divalidasi.
2. Cari kategori di `category_assets`; gunakan badge tepat jika tersedia, atau badge News sesuai manifest. Simpan kategori sumber dan kategori yang ditampilkan sebagai field berbeda.
3. Cari badge author secara persis setelah menormalkan kapitalisasi/spasi; bila tidak ditemukan, kosongkan elemen author.
4. Gabungkan aset terpilih dengan foto, headline, dan subheadline. Hanya dua teks headline yang berasal dari alur penulisan ulang.
5. Arsipkan versi render dan data artikel bersama `post_id`.

Prototipe sumber memakai kanvas 1080×1440, Montserrat Black/Medium, box merah, PNG badge dan logo. Prototipe masih memotong teks kepanjangan dengan elipsis; renderer n8n harus berhenti dan meminta penulisan ulang/tinjauan jika teks tidak muat agar fakta tidak hilang.
