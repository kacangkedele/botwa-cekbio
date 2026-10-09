// ============================================================
//  BOT WHATSAPP CEK BIO - By Angga Official (JSON DB Version)
//  100% Termux Ready - Pairing Code Fixed
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
const fs = require('fs');
const chalk = require('chalk');
const { config } = require('./config');

// ============ JSON DATABASE SETUP ============
const dbPath = './database.json';
let db = {
    users: {},
    stats: { total_detections: 0, total_mass_checks: 0 },
    pending: {},
    cooldowns: {},
    activity_log: []
};

if (fs.existsSync(dbPath)) {
    try {
        const data = fs.readFileSync(dbPath, 'utf-8');
        db = JSON.parse(data);
        if(!db.stats) db.stats = { total_detections: 0, total_mass_checks: 0 };
        if(!db.users) db.users = {};
        if(!db.pending) db.pending = {};
        if(!db.cooldowns) db.cooldowns = {};
        if(!db.activity_log) db.activity_log = [];
    } catch (e) {
        console.error('Database JSON corrupt, membuat baru...', e);
    }
}

function saveDB() {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// ============ HELPER: DATABASE ============
function logActivity(userId, action, detail = '') {
    const now = new Date().toISOString();
    db.activity_log.push({ user_id: userId, action, detail, timestamp: now });
    if (db.activity_log.length > 1000) db.activity_log.shift();
    saveDB();
}

function getUser(userId, username = 'TidakAda', referredBy = null) {
    const today = new Date().toISOString().split('T')[0];
    if (!db.users[userId]) {
        db.users[userId] = {
            user_id: userId,
            username: username,
            tier: 'Free',
            usage: 0,
            last_reset: today,
            expire_date: null,
            referred_by: referredBy,
            join_date: today
        };
        saveDB();
    }
    
    let user = db.users[userId];
    
    if (user.username !== username && username !== 'TidakAda') {
        user.username = username;
    }

    if (user.last_reset !== today) {
        user.usage = 0;
        user.last_reset = today;
        saveDB();
    }

    if (user.tier !== 'Free' && user.expire_date) {
        const expire = new Date(user.expire_date);
        if (new Date() > expire) {
            user.tier = 'Free';
            user.expire_date = null;
            saveDB();
        }
    }

    return user;
}

function updateStats(field) {
    db.stats[field] = (db.stats[field] || 0) + 1;
    saveDB();
}

function getStats() {
    return db.stats;
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
        const exists = await sock.onWhatsApp(jid);
        if (!exists || exists.length === 0 || !exists[0].exists) {
            return { success: false, bio: '❌ Nomor tidak terdaftar di WhatsApp', registered: false };
        }

        try {
            const status = await sock.fetchStatus(jid);
            const bio = status?.status || 'Tidak ada bio';
            const setAt = status?.setAt ? new Date(status.setAt).toLocaleString('id-ID') : '-';
            return { success: true, bio, setAt, registered: true };
        } catch (err) {
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

        const existing = db.cooldowns[phone];
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

        db.cooldowns[phone] = {
            phone,
            status,
            last_check: now.toISOString(),
            cooldown_until: status === 'cooldown' ? existing?.cooldown_until : cooldownUntil
        };
        saveDB();

        return {
            phone,
            status,
            bio,
            registered,
            time: now.toLocaleString('id-ID'),
            cooldownUntil: db.cooldowns[phone].cooldown_until
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
                } catch { }
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
        await new Promise(r => setTimeout(r, 800));
    }
    return results;
}

// ============ FORMATTER PESAN ============
function fmtMenu(userId, user) {
    const now = new Date().toLocaleString('id-ID');
    const limit = config.tierLimits[user.tier] || 5;
    const sisa = limit - user.usage;
    const stats = getStats();
    const totalUsers = Object.keys(db.users).length;

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

    if (cmd === '.menu' || cmd === '.start') {
        let referredBy = null;
        if (args[1] && args[1].startsWith('ref_')) {
            referredBy = args[1].slice(4);
        }
        const userData = getUser(userId, msg.pushName || 'TidakAda', referredBy);
        await sock.sendMessage(sender, { text: fmtMenu(userId, userData) });
        logActivity(userId, 'menu');
    }

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

        user.usage += 1;
        saveDB();
        updateStats('total_detections');
        const sisa = limit - user.usage;

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

        user.usage += 1;
        saveDB();
        updateStats('total_detections');

        await sock.sendMessage(sender, { text: `🔍 *OTP COOLDOWN MONITOR*\n📞 Nomor: ${nomor}\n⏳ Mengecek...` });

        const result = await cekCooldownOTP(sock, nomor);
        if (!result) {
            await sock.sendMessage(sender, { text: '❌ Gagal mengecek cooldown. Coba lagi.' });
            return;
        }

        const statusEmoji = result.status === 'ready' ? '✅' : '⏳';
        const statusText = result.status === 'ready' ? 'Nomor siap OTP' : 'Nomor sedang cooldown';

        const sisa = limit - user.usage;
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

    else if (cmd === '.cooldownlist') {
        const rows = Object.values(db.cooldowns).sort((a, b) => new Date(b.last_check) - new Date(a.last_check)).slice(0, 20);
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

    else if (cmd === '.premium') {
        await sock.sendMessage(sender, { text: fmtPremium(user) });
    }

    else if (cmd === '.beli') {
        const tier = (args[1] || '').toUpperCase();
        if (!['VIP', 'XVIP', 'VVIP'].includes(tier)) {
            await sock.sendMessage(sender, { text: '❌ Pilih: VIP, XVIP, atau VVIP\nContoh: .beli VIP' });
            return;
        }
        const price = config.tierPrices[tier];
        db.pending[userId] = { tier, timestamp: new Date().toISOString() };
        saveDB();

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

    else if (cmd === '.batal') {
        delete db.pending[userId];
        saveDB();
        await sock.sendMessage(sender, { text: '✅ Transaksi dibatalkan.' });
    }

    else if (cmd === '.akun' || cmd === '.myaccount') {
        await sock.sendMessage(sender, { text: fmtAkun(userId, user) });
    }

    else if (cmd === '.help') {
        await sock.sendMessage(sender, { text: fmtHelp() });
    }

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
            
            target.tier = targetTier;
            target.expire_date = newExpire;
            saveDB();
            
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

    else if (cmd === '.resetlimit') {
        if (!isAdmin(userId)) return;
        if (args[1] === 'all') {
            const today = new Date().toISOString().split('T')[0];
            Object.values(db.users).forEach(u => {
                u.usage = 0;
                u.last_reset = today;
            });
            saveDB();
            await sock.sendMessage(sender, { text: '✅ Limit semua user di-reset!' });
            logActivity(userId, 'resetlimit_all');
        } else if (args[1]) {
            if (db.users[args[1]]) {
                db.users[args[1]].usage = 0;
                saveDB();
                await sock.sendMessage(sender, { text: `✅ Limit user ${args[1]} di-reset!` });
                logActivity(userId, 'resetlimit', `Target: ${args[1]}`);
            } else {
                await sock.sendMessage(sender, { text: '❌ User tidak ditemukan.' });
            }
        } else {
            await sock.sendMessage(sender, { text: '❌ Format: .resetlimit <nomor> atau .resetlimit all' });
        }
    }

    else if (cmd === '.broadcast') {
        if (!isAdmin(userId)) return;
        const message = args.slice(1).join(' ');
        if (!message) {
            await sock.sendMessage(sender, { text: '❌ Format: .broadcast <pesan>' });
            return;
        }
        const users = Object.keys(db.users);
        let sent = 0, failed = 0;
        await sock.sendMessage(sender, { text: `📢 Mengirim broadcast ke ${users.length} user...` });
        for (const uid of users) {
            try {
                await sock.sendMessage(uid + '@s.whatsapp.net', { text: `📢 *PENGUMUMAN ADMIN*\n\n${message}` });
                sent++;
                await new Promise(r => setTimeout(r, 100));
            } catch { failed++; }
        }
        await sock.sendMessage(sender, { text: `✅ Broadcast selesai!\n📊 Terkirim: ${sent}\n❌ Gagal: ${failed}` });
        logActivity(userId, 'broadcast', `Sent: ${sent}, Failed: ${failed}`);
    }

    else if (cmd === '.listuser') {
        if (!isAdmin(userId)) return;
        const users = Object.values(db.users).slice(-50).reverse();
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

    else if (cmd === '.stats') {
        if (!isAdmin(userId)) return;
        const stats = getStats();
        const totalUsers = Object.keys(db.users).length;
        const totalCooldowns = Object.keys(db.cooldowns).length;
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
    if (!db.pending[userId]) return;

    const tier = db.pending[userId].tier;
    const price = config.tierPrices[tier];

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
        for (const adminNum of config.adminNumbers) {
            await sock.sendMessage(adminNum + '@s.whatsapp.net', { text: caption + '\n\n⚠️ Gagal meneruskan gambar.' });
        }
    }

    delete db.pending[userId];
    saveDB();
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

    // ============ PAIRING CODE (FIXED) ============
    if (!state.creds.registered) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        console.log(chalk.cyan('\n╔══════════════════════════════╗'));
        console.log(chalk.cyan('║  PAIRING CODE - WhatsApp Bot  ║'));
        console.log(chalk.cyan('╚══════════════════════════════╝\n'));

        const phoneNumber = await question(chalk.yellow('📲 Masukkan nomor WhatsApp (format: 628xxx): '));
        rl.close();

        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (!cleanNumber || cleanNumber.length < 8) {
            console.log(chalk.red('❌ Nomor tidak valid! Bot dimatikan.'));
            process.exit(1);
        }

        // Tunggu 3 detik agar socket benar-benar siap menerima request pairing
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                const cleanCode = code.replace(/-/g, ''); // Hapus tanda hubung agar mudah dicopy
                
                console.log(chalk.green('\n╔════════════════════════════════════════╗'));
                console.log(chalk.green.bold(`║  🔑 PAIRING CODE: ${cleanCode}            ║`));
                console.log(chalk.green('╚════════════════════════════════════════╝'));
                console.log(chalk.yellow('\n📱 CARA PAKAI:'));
                console.log(chalk.white('   1. Buka WhatsApp di HP'));
                console.log(chalk.white('   2. Settings (Pengaturan) > Linked Devices (Perangkat tertaut)'));
                console.log(chalk.white('   3. Link a Device (Tautkan perangkat)'));
                console.log(chalk.white('   4. Klik "Link with phone number" (Tautkan dengan nomor telepon)'));
                console.log(chalk.white(`   5. Masukkan kode: ${cleanCode} (TANPA TANDA HUBUNG)\n`));
            } catch (err) {
                console.error(chalk.red('\n❌ Gagal mendapatkan Pairing Code!'));
                console.error(chalk.red('Detail Error:'), err.message || err);
                console.log(chalk.yellow('\n💡 TIPS MENGATASI ERROR:'));
                console.log(chalk.white('   1. Cek tanggal & waktu di HP Anda, pastikan SETEL OTOMATIS!'));
                console.log(chalk.white('   2. Format nomor harus 628xxx (tanpa tanda + dan tanpa 0 di depan).'));
                console.log(chalk.white('   3. Pastikan internet stabil.\n'));
                process.exit(1);
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

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                if (msg.key.remoteJid === 'status@broadcast') continue;
                if (msg.key.fromMe) continue;

                const sender = msg.key.remoteJid;
                const isGroup = sender.endsWith('@g.us');
                const userId = getUserId(msg.key.participant || sender);

                const messageObj = msg.message;
                if (!messageObj) continue;

                let text = '';
                if (messageObj.conversation) {
                    text = messageObj.conversation;
                } else if (messageObj.extendedTextMessage?.text) {
                    text = messageObj.extendedTextMessage.text;
                } else if (messageObj.imageMessage?.caption) {
                    text = messageObj.imageMessage.caption;
                    if (!text.startsWith(config.prefix)) {
                        await handleImage(sock, msg, userId, sender);
                        continue;
                    }
                } else if (messageObj.imageMessage && !messageObj.imageMessage.caption) {
                    await handleImage(sock, msg, userId, sender);
                    continue;
                } else if (messageObj.documentMessage) {
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

                await handleCommand(sock, msg, userId, text.trim(), sender, isGroup);

            } catch (err) {
                console.error(chalk.red('Message handler error:'), err);
            }
        }
    });

    return sock;
}

// ============ DAILY CLEANUP ============
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 30) {
        const nowIso = now.toISOString();
        let changed = false;
        
        for (const phone in db.cooldowns) {
            if (new Date(db.cooldowns[phone].cooldown_until) < now) {
                delete db.cooldowns[phone];
                changed = true;
            }
        }
        
        for (const uid in db.users) {
            const u = db.users[uid];
            if (u.tier !== 'Free' && u.expire_date && new Date(u.expire_date) < now) {
                u.tier = 'Free';
                u.expire_date = null;
                changed = true;
            }
        }
        
        if (changed) saveDB();
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

process.on('SIGINT', () => {
    console.log(chalk.yellow('\n👋 Bot dimatikan...'));
    process.exit(0);
});
