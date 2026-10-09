// ============================================================
//  BOT WHATSAPP CEK BIO - By Angga Official
//  Pairing Code Method | Termux Ready
//  Features: Cek Bio, Cooldown Monitor, Mass Check, Premium,
//            Payment, Admin Tools, Rate Limit, SQLite DB
// ============================================================

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const readline = require('readline');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { config } = require('./config');

// ============ DATABASE SETUP ============
const db = new Database(config.dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        tier TEXT DEFAULT 'Free',
        usage INTEGER DEFAULT 0,
        last_reset TEXT,
        expire_date TEXT,
        referred_by TEXT,
        join_date TEXT
    );
    CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY,
        total_detections INTEGER DEFAULT 0,
        total_mass_checks INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO stats (id, total_detections, total_mass_checks) VALUES (1, 0, 0);
    CREATE TABLE IF NOT EXISTS pending (
        user_id TEXT PRIMARY KEY,
        tier TEXT,
        timestamp TEXT
    );
    CREATE TABLE IF NOT EXISTS cooldowns (
        phone TEXT PRIMARY KEY,
        status TEXT,
        last_check TEXT,
        cooldown_until TEXT
    );
    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT,
        detail TEXT,
        timestamp TEXT
    );
`);

// ============ HELPER: DATABASE ============
function logActivity(userId, action, detail = '') {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO activity_log (user_id, action, detail, timestamp) VALUES (?, ?, ?, ?)')
      .run(userId, action, detail, now);
}

function getUser(userId, username = 'TidakAda', referredBy = null) {
    const today = new Date().toISOString().split('T')[0];
    let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);

    if (!user) {
        db.prepare(`INSERT INTO users (user_id, username, tier, usage, last_reset, expire_date, referred_by, join_date)
                    VALUES (?, ?, 'Free', 0, ?, NULL, ?, ?)`)
          .run(userId, username, today, referredBy, today);
        user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    }

    // Reset limit harian
    if (user.last_reset !== today) {
        db.prepare('UPDATE users SET usage = 0, last_reset = ? WHERE user_id = ?').run(today, userId);
        user.usage = 0;
    }

    // Cek expire premium
    if (user.tier !== 'Free' && user.expire_date) {
        const expire = new Date(user.expire_date);
        if (new Date() > expire) {
            db.prepare("UPDATE users SET tier = 'Free', expire_date = NULL WHERE user_id = ?").run(userId);
            user.tier = 'Free';
            user.expire_date = null;
        }
    }

    return user;
}

function updateStats(field) {
    db.prepare(`UPDATE stats SET ${field} = ${field} + 1 WHERE id = 1`).run();
}

function getStats() {
    return db.prepare('SELECT * FROM stats WHERE id = 1').get();
}

// ============ HELPER: RATE LIMIT ============
const rateLimitMap = new Map();

function isRateLimited(userId) {
    const now = Date.now();
    if (!rateLimitMap.has(userId)) {
        rateLimitMap.set(userId, { first: now, count: 1 });
        return false;
    }
    const entry = rateLimitMap.get(userId);
    if (now - entry.first > config.rateLimitWindow * 1000) {
        rateLimitMap.set(userId, { first: now, count: 1 });
        return false;
    }
    entry.count++;
    return entry.count > config.rateLimitMax;
}

// ============ HELPER: VALIDASI NOMOR ============
function validatePhone(nomor) {
    if (!nomor.startsWith('+')) return false;
    const phone = nomor.slice(1);
    return /^\d{8,15}$/.test(phone);
}

function formatJid(nomor) {
    return nomor.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

function getUserId(sender) {
    return sender.split('@')[0];
}

function isAdmin(userId) {
    return config.adminNumbers.includes(userId);
}

// ============ CEK BIO WHATSAPP ============
async function cekBioWA(sock, nomor) {
    const jid = formatJid(nomor);
    try {
        // Cek apakah nomor terdaftar di WhatsApp
        const exists = await sock.onWhatsApp(jid);
        if (!exists || exists.length === 0 || !exists[0].exists) {
            return { success: false, bio: '❌ Nomor tidak terdaftar di WhatsApp', registered: false };
        }

        // Fetch bio/status
        try {
            const status = await sock.fetchStatus(jid);
            const bio = status?.status || 'Tidak ada bio';
            const setAt = status?.setAt ? new Date(status.setAt).toLocaleString('id-ID') : '-';
            return { success: true, bio, setAt, registered: true };
        } catch (err) {
            // Jika fetchStatus gagal, kemungkinan privacy setting
            return { success: true, bio: '🔒 Bio disembunyikan (private)', setAt: '-', registered: true };
        }
    } catch (err) {
        return { success: false, bio: `⚠️ Error: ${err.message}`, registered: false };
    }
}

// ============ CEK COOLDOWN OTP ============
async function cekCooldownOTP(sock, nomor) {
    const jid = formatJid(nomor);
    const now = new Date();
    const phone = nomor.replace(/[^0-9]/g, '');

    try {
        const exists = await sock.onWhatsApp(jid);
        const registered = exists && exists.length > 0 && exists[0].exists;

        // Cek database untuk cooldown sebelumnya
        const existing = db.prepare('SELECT * FROM cooldowns WHERE phone = ?').get(phone);
        let status = 'ready';
        let bio = '';

        if (registered) {
            try {
                const statusData = await sock.fetchStatus(jid);
                bio = statusData?.status || 'Tidak ada bio';
            } catch { bio = '🔒 Private'; }
        }

        if (existing && existing.cooldown_until) {
            const cooldownUntil = new Date(existing.cooldown_until);
            if (now < cooldownUntil) {
                status = 'cooldown';
            }
        }

        const cooldownUntil = new Date(now.getTime() + config.cooldownDuration * 1000).toISOString();

        db.prepare(`INSERT OR REPLACE INTO cooldowns (phone, status, last_check, cooldown_until)
                    VALUES (?, ?, ?, ?)`)
          .run(phone, status, now.toISOString(), cooldownUntil);

        return {
            phone,
            status,
            bio,
            registered,
            time: now.toLocaleString('id-ID'),
            cooldownUntil: status === 'cooldown' ? existing?.cooldown_until : cooldownUntil
        };
    } catch (err) {
        return null;
    }
}

// ============ MASS CHECK ============
async function massCekWA(sock, numbers) {
    const results = {
        total: numbers.length,
        registered: 0,
        notRegistered: 0,
        hasBio: 0,
        noBio: 0,
        details: []
    };

    for (const num of numbers) {
        const jid = formatJid('+' + num);
        try {
            const exists = await sock.onWhatsApp(jid);
            if (exists && exists.length > 0 && exists[0].exists) {
                results.registered++;
                let bio = '';
                try {
                    const status = await sock.fetchStatus(jid);
                    bio = status?.status || '';
                } catch { /* private */ }
                if (bio) results.hasBio++;
                else results.noBio++;
                results.details.push({ number: num, registered: true, bio });
            } else {
                results.notRegistered++;
                results.details.push({ number: num, registered: false, bio: '' });
            }
        } catch {
            results.notRegistered++;
            results.details.push({ number: num, registered: false, bio: 'Error' });
        }
        await new Promise(r => setTimeout(r, 800)); // delay anti-ban
    }
    return results;
}

// ============ FORMATTER PESAN ============
function fmtMenu(userId, user) {
    const now = new Date().toLocaleString('id-ID');
    const limit = config.tierLimits[user.tier] || 5;
    const sisa = limit - user.usage;
    const stats = getStats();
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    return (
        `🤖 *${config.botName}* 🤖\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📅 Waktu: ${now}\n\n` +
        `👤 *INFO PENGGUNA*\n` +
        `├─ ID: ${userId}\n` +
        `├─ Tier: ${user.tier}\n` +
        `└─ Sisa Deteksi: ${sisa} nomor\n\n` +
        `📊 *STATISTIK BOT*\n` +
        `├─ Total Users: ${totalUsers}\n` +
        `├─ Total Deteksi: ${stats.total_detections}x\n` +
        `└─ Total Mass Check: ${stats.total_mass_checks}x\n\n` +
        `📌 *DAFTAR PERINTAH*\n` +
        `├─ .menu - Menu utama\n` +
        `├─ .detek <nomor> - Cek 1 Bio WA\n` +
        `├─ .cooldown <nomor> - Cek OTP Cooldown\n` +
        `├─ .cooldownlist - List cooldown\n` +
        `├─ .akun - Info akun saya\n` +
        `├─ .premium - Lihat paket premium\n` +
        `└─ .help - Bantuan lengkap\n\n` +
        `📝 *CARA PENGGUNAAN*\n` +
        `Contoh: *.detek +628123456789*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `_Bot by ${config.ownerName}_`
    );
}

function fmtPremium(user) {
    return (
        `💎 *PAKET PREMIUM* 💎\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Status kamu: *${user.tier}* (maks ${config.tierLimits[user.tier]} nomor/sesi)\n\n` +
        `◇ *VIP* ⭐\n├ /detek → maks 25 nomor\n└ Rp 3.000/hari\n\n` +
        `◇ *XVIP* 🌟\n├ /detek → maks 50 nomor\n└ Rp 7.000/hari\n\n` +
        `◇ *VVIP* 💎\n├ /detek → maks 100 nomor\n└ Rp 10.000/hari\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Ketik *.beli VIP* / *.beli XVIP* / *.beli VVIP*\n` +
        `untuk memulai pembayaran.`
    );
}

function fmtAkun(userId, user) {
    const limit = config.tierLimits[user.tier] || 5;
    const sisa = limit - user.usage;
    let text =
        `🆔 *INFO AKUN SAYA*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🆔 ID: ${userId}\n` +
        `💎 Tier: *${user.tier}*\n` +
        `📊 Limit: ${user.usage}/${limit} (sisa *${sisa}*)\n` +
        `📅 Join: ${user.join_date}\n`;
    if (user.expire_date) text += `⏳ Expire: ${user.expire_date}\n`;
    else text += `⏳ Expire: - (Free)\n`;
    if (user.referred_by) text += `👥 Referred by: ${user.referred_by}\n`;
    text += `\n━━━━━━━━━━━━━━━━\n`;
    text += `💡 Link referral:\nhttps://wa.me/${config.ownerNumber}?text=.start ref_${userId}`;
    return text;
}

function fmtHelp() {
    return (
        `❓ *BANTUAN*\n` +
        `━━━━━━━━━━━━━━━━\n\n` +
        `📋 *PERINTAH USER:*\n` +
        `• .menu - Menu utama\n` +
        `• .detek <nomor> - Cek Bio WA\n` +
        `   Contoh: .detek +628123456789\n` +
        `• .cooldown <nomor> - Cek OTP Cooldown\n` +
        `• .cooldownlist - List semua cooldown\n` +
        `• .akun - Detail akun & sisa limit\n` +
        `• .premium - Lihat paket premium\n` +
        `• .beli <tier> - Beli paket (VIP/XVIP/VVIP)\n` +
        `• .help - Tampilkan pesan ini\n\n` +
        `📤 *CEK MASSAL (Admin):*\n` +
        `Kirim file .txt berisi daftar nomor\n\n` +
        `💎 *TIER & LIMIT:*\n` +
        `• Free: ${config.tierLimits.Free} nomor/hari\n` +
        `• VIP: ${config.tierLimits.VIP} nomor/hari (Rp 3K/hari)\n` +
        `• XVIP: ${config.tierLimits.XVIP} nomor/hari (Rp 7K/hari)\n` +
        `• VVIP: ${config.tierLimits.VVIP} nomor/hari (Rp 10K/hari)\n\n` +
        `⚠️ *CATATAN:*\n` +
        `• Nomor format internasional (+62xxx)\n` +
        `• Limit reset setiap hari 00:00\n` +
        `• Premium auto-expired sesuai durasi\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📢 Channel: ${config.channelUrl}`
    );
}

// ============ COMMAND HANDLERS ============
async function handleCommand(sock, msg, userId, text, sender, isGroup) {
    const args = text.split(' ').filter(a => a.trim());
    const cmd = args[0].toLowerCase();
    const user = getUser(userId, msg.pushName || 'TidakAda');

    // ========== .menu / .start ==========
    if (cmd === '.menu' || cmd === '.start') {
        let referredBy = null;
        if (args[1] && args[1].startsWith('ref_')) {
            referredBy = args[1].slice(4);
        }
        const userData = getUser(userId, msg.pushName || 'TidakAda', referredBy);
        await sock.sendMessage(sender, { text: fmtMenu(userId, userData) });
        logActivity(userId, 'menu');
    }

    // ========== .detek ==========
    else if (cmd === '.detek') {
        if (isRateLimited(userId)) {
            await sock.sendMessage(sender, { text: '⚠️ Terlalu banyak command. Tunggu sebentar.' });
            return;
        }
        const limit = config.tierLimits[user.tier] || 5;
        if (user.usage >= limit) {
            await sock.sendMessage(sender, { text: '🚫 *LIMIT HARIAN HABIS!*\n\nKetik .premium untuk upgrade.' });
            return;
        }
        if (!args[1]) {
            await sock.sendMessage(sender, { text: '❌ Format salah!\nGunakan: *.detek +628123456789*' });
            return;
        }
        const nomor = args[1];
        if (!validatePhone(nomor)) {
            await sock.sendMessage(sender, {
                text: '❌ Nomor harus format internasional!\nContoh: +628123456789\n• Diawali +\n• Panjang 8-15 digit\n• Hanya angka'
            });
            return;
        }

        db.prepare('UPDATE users SET usage = usage + 1 WHERE user_id = ?').run(userId);
        updateStats('total_detections');
        const sisa = limit - (user.usage + 1);

        await sock.sendMessage(sender, { text: `🔍 Mengecek Bio untuk: ${nomor}\n⏳ Mohon tunggu...` });

        const result = await cekBioWA(sock, nomor);

        let finalText =
            `✅ *HASIL DETEKSI BIO*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `📞 Nomor: ${nomor}\n`;
        if (result.registered) {
            finalText += `📝 Bio: ${result.bio}\n`;
            if (result.setAt && result.setAt !== '-') finalText += `🕐 Diubah: ${result.setAt}\n`;
        } else {
            finalText += `${result.bio}\n`;
        }
        finalText +=
            `━━━━━━━━━━━━━━━━\n` +
            `✅ Sisa deteksi: *${sisa}* nomor\n` +
            `🕒 ${new Date().toLocaleString('id-ID')}`;

        await sock.sendMessage(sender, { text: finalText });
        logActivity(userId, 'detek', `Nomor: ${nomor}`);
    }

    // ========== .cooldown ==========
    else if (cmd === '.cooldown') {
        if (isRateLimited(userId)) {
            await sock.sendMessage(sender, { text: '⚠️ Terlalu banyak command. Tunggu sebentar.' });
            return;
        }
        const limit = config.tierLimits[user.tier] || 5;
        if (user.usage >= limit) {
            await sock.sendMessage(sender, { text: '🚫 Limit harian habis! Ketik .premium' });
            return;
        }
        if (!args[1]) {
            await sock.sendMessage(sender, { text: '❌ Format salah!\nGunakan: *.cooldown +628123456789*' });
            return;
        }
        const nomor = args[1];
        if (!validatePhone(nomor)) {
            await sock.sendMessage(sender, { text: '❌ Nomor harus format internasional!\nContoh: +628123456789' });
            return;
        }

        db.prepare('UPDATE users SET usage = usage + 1 WHERE user_id = ?').run(userId);
        updateStats('total_detections');

        await sock.sendMessage(sender, { text: `🔍 *OTP COOLDOWN MONITOR*\n📞 Nomor: ${nomor}\n⏳ Mengecek...` });

        const result = await cekCooldownOTP(sock, nomor);
        if (!result) {
            await sock.sendMessage(sender, { text: '❌ Gagal mengecek cooldown. Coba lagi.' });
            return;
        }

        const statusEmoji = result.status === 'ready' ? '✅' : '⏳';
        const statusText = result.status === 'ready' ? 'Nomor siap OTP' : 'Nomor sedang cooldown';

        const sisa = (limit - (user.usage + 1));
        let finalText =
            `🔍 *OTP COOLDOWN MONITOR*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `📞 Nomor: +${result.phone}\n` +
            `${statusEmoji} Status: *${statusText}*\n` +
            `📊 Terdaftar WA: ${result.registered ? 'Ya' : 'Tidak'}\n`;
        if (result.bio) finalText += `📝 Bio: ${result.bio}\n`;
        finalText +=
            `🕒 Waktu Cek: ${result.time}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `✅ Sisa deteksi: *${sisa}* nomor\n` +
            `💡 Ketik .cooldownlist untuk lihat semua`;

        await sock.sendMessage(sender, { text: finalText });
        logActivity(userId, 'cooldown', `Nomor: ${nomor}`);
    }

    // ========== .cooldownlist ==========
    else if (cmd === '.cooldownlist') {
        const rows = db.prepare('SELECT * FROM cooldowns ORDER BY last_check DESC LIMIT 20').all();
        if (rows.length === 0) {
            await sock.sendMessage(sender, { text: '📭 Belum ada nomor yang di-cek cooldown.' });
            return;
        }
        let text = '📋 *DAFTAR COOLDOWN* (20 terakhir)\n━━━━━━━━━━━━━━━━\n';
        for (const r of rows) {
            const emoji = r.status === 'ready' ? '✅' : '⏳';
            const time = new Date(r.last_check).toLocaleString('id-ID');
            text += `${emoji} +${r.phone} - ${time}\n`;
        }
        const ready = rows.filter(r => r.status === 'ready').length;
        const cooldown = rows.length - ready;
        text += `\n━━━━━━━━━━━━━━━━\n`;
        text += `📊 Total: ${rows.length} nomor\n`;
        text += `✅ Siap OTP: ${ready}\n`;
        text += `⏳ Cooldown: ${cooldown}\n\n`;
        if (ready === rows.length) text += '🎉 *Semua nomor siap OTP!*';
        else text += '⚠️ Masih ada nomor dalam cooldown.';
        await sock.sendMessage(sender, { text });
    }

    // ========== .premium ==========
    else if (cmd === '.premium') {
        await sock.sendMessage(sender, { text: fmtPremium(user) });
    }

    // ========== .beli ==========
    else if (cmd === '.beli') {
        const tier = (args[1] || '').toUpperCase();
        if (!['VIP', 'XVIP', 'VVIP'].includes(tier)) {
            await sock.sendMessage(sender, { text: '❌ Pilih: VIP, XVIP, atau VVIP\nContoh: .beli VIP' });
            return;
        }
        const price = config.tierPrices[tier];
        db.prepare('INSERT OR REPLACE INTO pending (user_id, tier, timestamp) VALUES (?, ?, ?)')
          .run(userId, tier, new Date().toISOString());

        let caption =
            `🛒 *PEMBAYARAN TIER ${tier}*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `Silakan scan QRIS & bayar:\n` +
            `💵 *Rp ${price.toLocaleString('id-ID')}*\n\n` +
            `📸 *Kirim foto bukti pembayaran KE CHAT INI.*\n\n` +
            `Ketik *.batal* untuk membatalkan.`;

        try {
            await sock.sendMessage(sender, {
                image: { url: config.qrisImageUrl },
                caption: caption
            });
        } catch {
            await sock.sendMessage(sender, { text: caption + `\n\n⚠️ QRIS image gagal dimuat. Hubungi admin.` });
        }
    }

    // ========== .batal ==========
    else if (cmd === '.batal') {
        db.prepare('DELETE FROM pending WHERE user_id = ?').run(userId);
        await sock.sendMessage(sender, { text: '✅ Transaksi dibatalkan.' });
    }

    // ========== .akun / .myaccount ==========
    else if (cmd === '.akun' || cmd === '.myaccount') {
        await sock.sendMessage(sender, { text: fmtAkun(userId, user) });
    }

    // ========== .help ==========
    else if (cmd === '.help') {
        await sock.sendMessage(sender, { text: fmtHelp() });
    }

    // ========== ADMIN COMMANDS ==========
    else if (cmd === '.upgrade') {
        if (!isAdmin(userId)) return;
        try {
            const targetId = args[1];
            const targetTier = (args[2] || '').toUpperCase();
            const days = parseInt(args[3]);
            if (!['VIP', 'XVIP', 'VVIP'].includes(targetTier) || !days) {
                await sock.sendMessage(sender, { text: '❌ Format: .upgrade <nomor> <tier> <hari>\nContoh: .upgrade 6281234567890 VIP 30' });
                return;
            }
            const target = getUser(targetId, 'Unknown');
            const baseDate = new Date();
            if (target.expire_date) {
                const expire = new Date(target.expire_date);
                if (expire > baseDate) baseDate.setTime(expire.getTime());
            }
            baseDate.setDate(baseDate.getDate() + days);
            const newExpire = baseDate.toISOString().split('T')[0];
            db.prepare('UPDATE users SET tier = ?, expire_date = ? WHERE user_id = ?')
              .run(targetTier, newExpire, targetId);
            await sock.sendMessage(sender, { text: `✅ User ${targetId} di-upgrade ke *${targetTier}* selama ${days} hari.\nExpire: ${newExpire}` });
            try {
                await sock.sendMessage(targetId + '@s.whatsapp.net', {
                    text: `🎉 *PEMBAYARAN DITERIMA* 🎉\n\nAkun Anda di-upgrade ke *${targetTier}*.\nDurasi: ${days} hari\nExpire: ${newExpire}`
                });
            } catch {}
            logActivity(userId, 'upgrade', `Target: ${targetId}, Tier: ${targetTier}, ${days} hari`);
        } catch (err) {
            await sock.sendMessage(sender, { text: '❌ Format: .upgrade <nomor> <tier> <hari>' });
        }
    }

    // ========== .resetlimit ==========
    else if (cmd === '.resetlimit') {
        if (!isAdmin(userId)) return;
        if (args[1] === 'all') {
            db.prepare("UPDATE users SET usage = 0, last_reset = ?").run(new Date().toISOString().split('T')[0]);
            await sock.sendMessage(sender, { text: '✅ Limit semua user di-reset!' });
            logActivity(userId, 'resetlimit_all');
        } else if (args[1]) {
            db.prepare('UPDATE users SET usage = 0 WHERE user_id = ?').run(args[1]);
            await sock.sendMessage(sender, { text: `✅ Limit user ${args[1]} di-reset!` });
            logActivity(userId, 'resetlimit', `Target: ${args[1]}`);
        } else {
            await sock.sendMessage(sender, { text: '❌ Format: .resetlimit <nomor> atau .resetlimit all' });
        }
    }

    // ========== .broadcast ==========
    else if (cmd === '.broadcast') {
        if (!isAdmin(userId)) return;
        const message = args.slice(1).join(' ');
        if (!message) {
            await sock.sendMessage(sender, { text: '❌ Format: .broadcast <pesan>' });
            return;
        }
        const users = db.prepare('SELECT user_id FROM users').all();
        let sent = 0, failed = 0;
        const progress = await sock.sendMessage(sender, { text: `📢 Mengirim broadcast ke ${users.length} user...` });
        for (const u of users) {
            try {
                await sock.sendMessage(u.user_id + '@s.whatsapp.net', { text: `📢 *PENGUMUMAN ADMIN*\n\n${message}` });
                sent++;
                await new Promise(r => setTimeout(r, 100));
            } catch { failed++; }
        }
        await sock.sendMessage(sender, { text: `✅ Broadcast selesai!\n📊 Terkirim: ${sent}\n❌ Gagal: ${failed}` });
        logActivity(userId, 'broadcast', `Sent: ${sent}, Failed: ${failed}`);
    }

    // ========== .listuser ==========
    else if (cmd === '.listuser') {
        if (!isAdmin(userId)) return;
        const users = db.prepare('SELECT * FROM users ORDER BY rowid DESC LIMIT 50').all();
        if (users.length === 0) {
            await sock.sendMessage(sender, { text: '📭 Belum ada user terdaftar.' });
            return;
        }
        let text = `📋 *DAFTAR USER* (${users.length} terbaru)\n━━━━━━━━━━━━━━━━\n\n`;
        for (const u of users) {
            text += `• ${u.user_id} | ${u.tier} (${u.usage}) | ${u.expire_date || '-'}\n`;
        }
        text += `\n━━━━━━━━━━━━━━━━\nTotal: ${users.length} user`;
        await sock.sendMessage(sender, { text });
    }

    // ========== .stats ==========
    else if (cmd === '.stats') {
        if (!isAdmin(userId)) return;
        const stats = getStats();
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const totalCooldowns = db.prepare('SELECT COUNT(*) as count FROM cooldowns').get().count;
        const text =
            `📊 *STATISTIK BOT*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `🔍 Total Deteksi: ${stats.total_detections}\n` +
            `📁 Total Mass Check: ${stats.total_mass_checks}\n` +
            `⏳ Total Cooldown Tracked: ${totalCooldowns}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `🕒 ${new Date().toLocaleString('id-ID')}`;
        await sock.sendMessage(sender, { text });
    }
}

// ============ HANDLE IMAGE (BUKTI BAYAR) ============
async function handleImage(sock, msg, userId, sender) {
    const pending = db.prepare('SELECT tier FROM pending WHERE user_id = ?').get(userId);
    if (!pending) return; // Bukan dalam mode pembayaran

    const tier = pending.tier;
    const price = config.tierPrices[tier];

    // Forward ke admin
    const caption =
        `🛒 *PEMBAYARAN BARU MASUK* 🛒\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `🆔 ID: ${userId}\n` +
        `👤 Nama: ${msg.pushName || '-'}\n` +
        `💎 Paket: ${tier}\n` +
        `💰 Jumlah: Rp ${price.toLocaleString('id-ID')}\n` +
        `🕒 ${new Date().toLocaleString('id-ID')}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Jika uang masuk, ketik:\n.upgrade ${userId} ${tier} 30`;

    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const messageType = Object.keys(msg.message)[0];
        const mimeType = msg.message[messageType]?.mimetype || 'image/jpeg';

        for (const adminNum of config.adminNumbers) {
            await sock.sendMessage(adminNum + '@s.whatsapp.net', {
                image: buffer,
                caption: caption,
                mimetype: mimeType
            });
        }
    } catch (err) {
        console.error('Error forwarding image:', err);
        // Fallback: kirim notifikasi text saja
        for (const adminNum of config.adminNumbers) {
            await sock.sendMessage(adminNum + '@s.whatsapp.net', { text: caption + '\n\n⚠️ Gagal meneruskan gambar.' });
        }
    }

    db.prepare('DELETE FROM pending WHERE user_id = ?').run(userId);
    await sock.sendMessage(sender, {
        text: '✅ *Bukti pembayaran terkirim ke Admin!*\nMohon tunggu verifikasi (max 1x24 jam).'
    });
    logActivity(userId, 'payment', `Tier: ${tier}, Rp ${price}`);
}

// ============ HANDLE DOCUMENT (MASS CHECK) ==========
async function handleDocument(sock, msg, userId, sender) {
    if (!isAdmin(userId)) {
        await sock.sendMessage(sender, { text: '❌ Fitur mass check hanya untuk Admin.' });
        return;
    }

    const docMsg = msg.message?.documentMessage;
    if (!docMsg) return;
    const fileName = docMsg.fileName || 'unknown.txt';
    if (!fileName.endsWith('.txt')) {
        await sock.sendMessage(sender, { text: '❌ File harus .txt berisi daftar nomor!' });
        return;
    }

    await sock.sendMessage(sender, { text: '📂 Membaca file...' });

    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const text = buffer.toString('utf-8');

        const numbers = [];
        for (const line of text.split('\n')) {
            const clean = line.trim().replace(/[^0-9]/g, '');
            if (clean.length >= 8 && clean.length <= 15) {
                numbers.push(clean);
            }
        }

        if (numbers.length === 0) {
            await sock.sendMessage(sender, { text: '❌ Tidak ada nomor valid di file!' });
            return;
        }

        await sock.sendMessage(sender, {
            text: `📊 Ditemukan *${numbers.length} nomor*.\n⏳ Mulai cek massal...\nEstimasi: ~${Math.ceil(numbers.length * 0.8)} detik`
        });

        const results = await massCekWA(sock, numbers);
        updateStats('total_mass_checks');

        const regPct = ((results.registered / results.total) * 100).toFixed(1);
        const notRegPct = ((results.notRegistered / results.total) * 100).toFixed(1);

        let resultText =
            `📊 *HASIL CEK MASSAL*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `📁 Total: ${results.total} nomor\n\n` +
            `📈 *STATISTIK:*\n` +
            `  ✅ Terdaftar WA: ${results.registered} (${regPct}%)\n` +
            `  🚫 Tidak Terdaftar: ${results.notRegistered} (${notRegPct}%)\n\n` +
            `  ── dari ${results.registered} terdaftar ──\n` +
            `  📝 Punya Bio: ${results.hasBio}\n` +
            `  🚫 Tanpa Bio: ${results.noBio}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `🕒 ${new Date().toLocaleString('id-ID')}`;

        // Buat file hasil detail
        const csvName = `result_masscheck_${Date.now()}.csv`;
        let csv = 'Nomor,Status,Bio\n';
        for (const d of results.details) {
            const bioClean = (d.bio || '').replace(/"/g, '""').replace(/\n/g, ' ');
            csv += `${d.number},${d.registered ? 'Terdaftar' : 'Tidak'},"${bioClean}"\n`;
        }
        fs.writeFileSync(csvName, csv);

        await sock.sendMessage(sender, {
            document: { url: csvName },
            fileName: csvName,
            mimetype: 'text/csv',
            caption: resultText
        });

        fs.unlinkSync(csvName);
        logActivity(userId, 'masscheck', `Total: ${numbers.length}`);
    } catch (err) {
        console.error('Mass check error:', err);
        await sock.sendMessage(sender, { text: `❌ Error: ${err.message}` });
    }
}

// ============ MAIN CONNECTION ============
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(config.authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Bot WA', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: 60000,
    });

    // ============ PAIRING CODE ============
    if (!state.creds.registered) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        console.log(chalk.cyan('\n╔══════════════════════════════╗'));
        console.log(chalk.cyan('║  PAIRING CODE - WhatsApp Bot  ║'));
        console.log(chalk.cyan('╚══════════════════════════════╝\n'));

        const phoneNumber = await question(chalk.yellow('📲 Masukkan nomor WhatsApp (format: 628xxx): '));
        rl.close();

        if (!phoneNumber || phoneNumber.length < 8) {
            console.log(chalk.red('❌ Nomor tidak valid!'));
            process.exit(1);
        }

        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(chalk.green('\n╔════════════════════════════════════╗'));
                console.log(chalk.green.bold(`║  🔑 PAIRING CODE: ${code}            ║`));
                console.log(chalk.green('╚════════════════════════════════════╝'));
                console.log(chalk.yellow('\n📱 Cara pakai:'));
                console.log(chalk.white('   1. Buka WhatsApp di HP'));
                console.log(chalk.white('   2. Settings > Linked Devices'));
                console.log(chalk.white('   3. Link a Device'));
                console.log(chalk.white('   4. Pilih "Link with phone number"'));
                console.log(chalk.white(`   5. Masukkan kode: ${code}\n`));
            } catch (err) {
                console.error(chalk.red('❌ Gagal mendapatkan pairing code:'), err);
            }
        }, 3000);
    }

    // ============ EVENT: CONNECTION UPDATE ============
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
                : true;

            console.log(chalk.red(`❌ Koneksi terputus. Alasan: ${lastDisconnect?.error?.message || 'unknown'}`));

            if (shouldReconnect) {
                console.log(chalk.yellow('🔄 Menghubungkan ulang...'));
                setTimeout(() => connectToWhatsApp(), 3000);
            } else {
                console.log(chalk.red('🚫 Sesi telah logout. Hapus folder auth_info_baileys dan jalankan ulang.'));
            }
        } else if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Menghubungkan ke WhatsApp...'));
        } else if (connection === 'open') {
            console.log(chalk.green('\n✅ Bot WhatsApp berhasil terhubung!'));
            console.log(chalk.green(`🤖 ${config.botName} sedang berjalan...\n`));
            console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            console.log(chalk.cyan('  Ketik .menu di WhatsApp untuk mulai'));
            console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
        }
    });

    // ============ EVENT: CREDENTIALS UPDATE ============
    sock.ev.on('creds.update', saveCreds);

    // ============ EVENT: MESSAGE ============
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                // Skip status broadcasts
                if (msg.key.remoteJid === 'status@broadcast') continue;
                // Skip self messages
                if (msg.key.fromMe) continue;

                const sender = msg.key.remoteJid;
                const isGroup = sender.endsWith('@g.us');
                const userId = getUserId(msg.key.participant || sender);

                // Handle different message types
                const messageObj = msg.message;
                if (!messageObj) continue;

                // Text message
                let text = '';
                if (messageObj.conversation) {
                    text = messageObj.conversation;
                } else if (messageObj.extendedTextMessage?.text) {
                    text = messageObj.extendedTextMessage.text;
                } else if (messageObj.imageMessage?.caption) {
                    text = messageObj.imageMessage.caption;
                    // Handle image with caption (bukti bayar)
                    if (!text.startsWith(config.prefix)) {
                        await handleImage(sock, msg, userId, sender);
                        continue;
                    }
                } else if (messageObj.imageMessage && !messageObj.imageMessage.caption) {
                    // Image without caption = bukti bayar
                    await handleImage(sock, msg, userId, sender);
                    continue;
                } else if (messageObj.documentMessage) {
                    // Handle document (mass check)
                    await handleDocument(sock, msg, userId, sender);
                    continue;
                } else if (messageObj.videoMessage?.caption) {
                    text = messageObj.videoMessage.caption;
                } else if (messageObj.buttonsResponseMessage?.selectedButtonId) {
                    text = messageObj.buttonsResponseMessage.selectedButtonId;
                } else if (messageObj.listResponseMessage?.singleSelectReply?.selectedRowId) {
                    text = messageObj.listResponseMessage.singleSelectReply.selectedRowId;
                }

                if (!text || !text.startsWith(config.prefix)) continue;

                // In group, only respond if bot is mentioned or message starts with prefix
                if (isGroup) {
                    // Uncomment below to restrict bot to only respond when mentioned in groups
                    // const mentionedJids = messageObj.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    // if (!mentionedJids.includes(sock.user.id)) continue;
                }

                await handleCommand(sock, msg, userId, text.trim(), sender, isGroup);

            } catch (err) {
                console.error(chalk.red('Message handler error:'), err);
            }
        }
    });

    return sock;
}

// ============ DAILY CLEANUP (setiap jam 00:30) ============
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 30) {
        const nowIso = now.toISOString();
        db.prepare('DELETE FROM cooldowns WHERE cooldown_until < ?').run(nowIso);
        db.prepare("UPDATE users SET tier='Free', expire_date=NULL WHERE tier!='Free' AND expire_date < ?")
          .run(now.toISOString().split('T')[0]);
        console.log(chalk.blue('🧹 Daily cleanup executed.'));
    }
}, 60000);

// ============ START ============
console.log(chalk.cyan(`
╔══════════════════════════════════════╗
║   ${config.botName.padEnd(34)}   ║
║   WhatsApp Bot - Pairing Code        ║
║   by ${config.ownerName.padEnd(28)}   ║
╚══════════════════════════════════════╝
`));

connectToWhatsApp().catch(err => {
    console.error(chalk.red('Fatal error:'), err);
    process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Bot dimatikan...'));
    db.close();
    process.exit(0);
});
