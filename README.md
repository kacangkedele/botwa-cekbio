```markdown
# 🤖 Bot WhatsApp Cek Bio - Pairing Code (Termux Ready)

Bot WhatsApp canggih berbasis **Baileys API** yang digunakan untuk mendeteksi Bio WhatsApp, memantau OTP Cooldown, dan melakukan Mass Check. Dilengkapi dengan sistem Database SQLite, Rate Limiting, Sistem Premium (Tier), dan metode login **Pairing Code** (Tanpa Scan QR).

<p align="center">
  <a href="https://wa.me/6281234567890"><img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp"/></a>
  <a href="https://t.me/anggaofficial"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/></a>
  <a href="https://youtube.com/@anggaofficial"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/Termux-120D4D?style=flat-square&logo=termux&logoColor=white" alt="Termux"/>
  <img src="https://img.shields.io/badge/Status-Active-success?style=flat-square" alt="Status"/>
</p>

---

## ✨ Fitur Utama

- 🔐 **Login Pairing Code:** Tidak perlu scan QR, cukup masukkan kode di HP.
- 🔍 **Cek Bio WhatsApp:** Lihat bio/status WA seseorang (Public/Private).
- ⏳ **OTP Cooldown Monitor:** Pantau status nomor untuk penerimaan OTP.
- 📁 **Mass Check Bio (Admin):** Upload file `.txt` untuk cek ribuan nomor sekaligus (Auto-generate laporan CSV).
- 💎 **Sistem Premium & Tier:** Limit harian (Free, VIP, XVIP, VVIP) dengan sistem pembayaran otomatis (QRIS).
- 📊 **Database SQLite:** Menyimpan data user, statistik, dan log aktivitas secara permanen.
- 🛡️ **Anti-Spam (Rate Limit):** Mencegah user men-spam command bot.
- 🛠️ **Admin Tools:** Broadcast, Reset Limit, Upgrade User, Lihat List User.

---

## 📋 Daftar Perintah (Commands)

### 👤 User Commands
| Perintah | Fungsi |
|----------|--------|
| `.menu` | Menampilkan menu utama & info akun. |
| `.detek <nomor>` | Cek bio 1 nomor WA. *(Contoh: .detek +628123456789)* |
| `.cooldown <nomor>` | Cek status OTP Cooldown nomor. |
| `.cooldownlist` | Melihat 20 list cooldown terakhir. |
| `.akun` | Melihat info akun & sisa limit harian. |
| `.premium` | Melihat daftar harga paket premium. |
| `.beli <tier>` | Memulai transaksi pembayaran. *(Contoh: .beli VIP)* |
| `.batal` | Membatalkan transaksi pembelian. |
| `.help` | Menampilkan bantuan lengkap. |

### 🛡️ Admin Commands
| Perintah | Fungsi |
|----------|--------|
| `.upgrade <nomor> <tier> <hari>` | Meng-upgrade user ke tier premium. |
| `.resetlimit <nomor / all>` | Mereset limit harian user. |
| `.broadcast <pesan>` | Mengirim broadcast ke seluruh user. |
| `.listuser` | Melihat 50 user terbaru. |
| `.stats` | Melihat statistik bot. |
| *(Kirim File .txt)* | Melakukan Mass Check Bio otomatis. |

---

## 🚀 Cara Install & Menjalankan di Termux

Bot ini dirancang khusus untuk berjalan ringan di aplikasi **Termux** (Android).

### 1. Persiapan Termux
Buka Termux dan masukkan perintah berikut untuk menginstall environment Node.js dan tools pendukung:
```bash
pkg update && pkg upgrade -y
pkg install nodejs-lts git python make clang -y
```

### 2. Buat Folder Project
```bash
mkdir bot-wa && cd bot-wa
```

### 3. Buat File Project
Buat 3 file sesuai dengan source code yang diberikan:
- `package.json`
- `config.js` *(Jangan lupa edit nomor admin, link channel, dan link QRIS di dalamnya)*
- `index.js`

*(Anda bisa menggunakan aplikasi editor seperti QuickEdit atau VS Code di Android untuk membuat file ini).*

### 4. Install Dependencies
Jalankan perintah ini di dalam folder `bot-wa`:
```bash
npm install
```

### 5. Jalankan Bot
```bash
node index.js
```
Bot akan meminta Anda memasukkan nomor WhatsApp. Masukkan format internasional tanpa `+` (Contoh: `6281234567890`).
Setelah itu, akan muncul **Pairing Code**. Buka WhatsApp di HP ➔ Settings ➔ Linked Devices ➔ Link a Device ➔ Pilih "Link with phone number" ➔ Masukkan kode tersebut.

---

## ⚙️ Konfigurasi (`config.js`)

Sebelum menjalankan bot, pastikan Anda telah mengubah data ini di file `config.js`:

```javascript
ownerNumber: '6281234567890',        // Ganti dengan nomor WA Anda
adminNumbers: ['6281234567890'],      // Ganti dengan nomor admin
channelUrl: 'https://whatsapp.com/...',  // Ganti dengan link Channel WA Anda
qrisImageUrl: 'https://i.ibb.co/...',     // Ganti dengan link gambar QRIS Anda
```

---

## 🛠️ Troubleshooting (Penanganan Masalah)

**1. Error saat install `better-sqlite3` di Termux?**
Jalankan perintah ini secara terpisah:
```bash
pkg install python make clang -y
npm install better-sqlite3 --build-from-source
```

**2. Bot logout / Ingin pindah nomor WA?**
Hapus folder auth, lalu jalankan ulang bot:
```bash
rm -rf auth_info_baileys
node index.js
```

**3. Bot sering disconnect?**
Pastikan koneksi internet stabil. Bot akan otomatis mencoba reconnect jika koneksi terputus.

---

## 📞 Kontak & Support

Jika menemukan bug atau ingin bertanya seputar script ini, silakan hubungi melalui platform di bawah ini:

<p align="center">
  <a href="https://wa.me/6281234567890"><img src="https://img.shields.io/badge/WhatsApp-Chat_Me-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/></a>
  <a href="https://t.me/anggaofficial"><img src="https://img.shields.io/badge/Telegram-Join_Channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white"/></a>
  <a href="https://youtube.com/@anggaofficial"><img src="https://img.shields.io/badge/YouTube-Subscribe-FF0000?style=for-the-badge&logo=youtube&logoColor=white"/></a>
</p>

---

> ⚠️ **Disclaimer:** Script ini dibuat untuk tujuan edukasi dan otomatisasi. Penyalahgunaan bot untuk tindakan spamming ilegal di luar tanggung jawab developer. Gunakan dengan bijak.
```

---

### 💡 Tips Tambahan untuk Anda:
1. **Ganti Link Sosial Media:** Di dalam file `README.md` di atas, cari link seperti `https://wa.me/6281234567890`, `https://t.me/anggaofficial`, dan `https://youtube.com/@anggaofficial` lalu ganti dengan link asli milik Anda.
2. Jika Anda meng-upload project ini ke **GitHub**, file `README.md` ini akan otomatis ditampilkan di halaman utama repository Anda dengan tampilan yang sangat keren dan profesional!
