# FLIPBOOK STUDIO

Aplikasi flipbook 2D lokal untuk mengubah PDF atau kumpulan gambar menjadi buku digital dengan animasi membalik halaman.

## Menjalankan

1. Buka folder proyek dengan Laragon atau server web lain.
2. Pastikan folder `assets/vendor` berisi:
   - `pdf.min.js`
   - `pdf.worker.min.js`
   - `page-flip.browser.js`
   - `qrcode.min.js`
3. Jalankan melalui alamat lokal seperti `http://localhost/aku`.
4. Jangan membuka hanya melalui `file:///` agar PDF.js, QR Code, dan IndexedDB berjalan konsisten.

## Fitur

- Unggah PDF atau beberapa JPG/JPEG/PNG/WEBP.
- Render PDF menjadi halaman gambar di browser.
- Atur urutan halaman dan pilih cover.
- Simpan koleksi secara lokal menggunakan IndexedDB.
- Membaca dengan PageFlip.js dalam mode satu atau dua halaman.
- Zoom, fullscreen, thumbnail, daftar isi PDF, bookmark, suara sintetis, keyboard, dan swipe.
- Cari dan urutkan koleksi buku.
- Bagikan link lokal, QR Code, download PDF asli, dan cetak halaman.
- Contoh flipbook bawaan dapat dibuat dari Dashboard.

## Penyimpanan

Buku, halaman raster, dan PDF asli disimpan di IndexedDB browser. Draf form disimpan sementara di LocalStorage. Data tetap berada di browser/perangkat dan tidak dikirim ke server.

## Rekomendasi

Gunakan PDF berukuran sedang untuk performa terbaik. Browser modern seperti Chrome, Edge, atau Firefox disarankan untuk PDF.js, IndexedDB, dan Fullscreen API.
