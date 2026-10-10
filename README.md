# Teman Rencana

Chatbot wisata harian untuk kota di Indonesia. Pengguna menyebut kota, budget, dan suasana yang diinginkan. Bot membalas dalam bahasa Indonesia dan menyusun rencana satu hari: pagi, siang, dan sore.

Targetnya wisatawan atau warga yang ingin jalan-jalan satu hari dengan budget terbatas, tanpa menyusun itinerary sendiri.

## Fitur

- Chat bahasa alami lewat Gemini.
- Gaya bahasa **santai** atau **formal**, diatur dengan ikon di kanan atas.
- Tema **terang** atau **gelap**.
- Nama pengguna untuk sapaan, misalnya "Halo, Raka."
- Rekomendasi satu hari tampil di dalam balasan chat: cuaca, perkiraan biaya, dan tiga slot waktu.
- Cuaca kota diambil dari Open-Meteo sebelum Gemini menjawab.
- Memori di browser (`localStorage`): nama, kota, budget, selera, riwayat chat, dan rencana terakhir.
- Permintaan yang sama dengan gaya bahasa yang sama tidak dikirim ulang.
- Tempat dan aktivitas yang sama tidak diulang di slot rencana.
- Parameter dan memori ada di modal pengaturan (ikon gear, kiri atas).

## Tech stack

| Bagian | Pilihan |
|---|---|
| Frontend | HTML, satu file CSS, satu file Vanilla JavaScript |
| Server | Node.js 18+ dan Express |
| Model | Gemini Flash lewat `@google/genai` |
| Konfigurasi model | `systemInstruction`, `temperature`, `topP`, `topK` |
| Cuaca | Open-Meteo (tanpa API key) |
| Penyimpanan | `localStorage` di browser. Server tidak menyimpan data pengguna |
| Rahasia | `GEMINI_API_KEY` di file `.env` |

Materi sesi memakai `gemini-2.5-flash`. Akun API baru tidak bisa memakai model itu, jadi default project ini `gemini-3.5-flash`. Jika model sedang penuh, server mencoba `gemini-flash-latest`, lalu `gemini-3.6-flash`.

Parameter mengikuti gaya bahasa:

| Gaya | temperature | topP | topK |
|---|---|---|---|
| Santai | 0.9 | 0.95 | 40 |
| Formal | 0.3 | 0.8 | 20 |

## Struktur

```text
index.js                 server Express dan pemanggilan Gemini
package.json
.env                     API key, tidak ikut ke Git
.env.example
public/index.html
public/css/style.css
public/js/script.js
```

## Cara menjalankan

1. Pasang Node.js 18 atau lebih baru.
2. Buat API key Gemini di [Google AI Studio](https://aistudio.google.com/apikey).
3. Salin `.env.example` menjadi `.env`, lalu isi `GEMINI_API_KEY`.
4. Pasang dependency dan jalankan server:

```bash
npm install
npm start
```

5. Buka [http://localhost:3000](http://localhost:3000).

## Cara pakai

1. Isi nama lewat ikon gear kalau ingin disapa.
2. Pilih gaya bahasa dan tema dari ikon di kanan atas.
3. Ketik kota, budget, dan suasana. Contoh: `Aku di Bandung, budget 200 ribu, mau santai dan ada kopi.`
4. Baca balasan dan kartu rencana di dalam chat.
5. Lanjutkan percakapan tanpa mengulang data, misalnya `Ubah ke yang lebih hemat.`
6. Ganti gaya bahasa kalau ingin jawaban berikutnya lebih formal atau lebih santai.
7. Hapus percakapan dari modal pengaturan. Nama dan tema tidak ikut terhapus.

Contoh cepat juga tersedia di layar awal: Bandung, Yogyakarta, dan Jakarta.
