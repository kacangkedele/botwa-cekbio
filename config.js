// ============ KONFIGURASI BOT ============
// GANTI SEMUA NILAI DI BAWAH SESUAI KEBUTUHAN ANDA

const config = {
    // Info Bot
    botName: 'Bot By Angga Official',
    ownerName: 'Angga Official',
    
    // Nomor Owner & Admin (format: 628xxx tanpa + dan tanpa spasi)
    ownerNumber: '6281234567890',        // GANTI dengan nomor Anda
    adminNumbers: ['6281234567890'],      // GANTI dengan nomor admin
    
    // Prefix command
    prefix: '.',
    
    // Tier & Limit
    tierLimits: { Free: 5, VIP: 25, XVIP: 50, VVIP: 100 },
    tierPrices: { VIP: 3000, XVIP: 7000, VVIP: 10000 },
    
    // Cooldown & Rate Limit
    cooldownDuration: 300,     // 5 menit dalam detik
    rateLimitWindow: 60,       // 60 detik window
    rateLimitMax: 10,          // max 10 command per menit
    
    // Link
    channelUrl: 'https://whatsapp.com/channel/0000000000000000',  // GANTI
    qrisImageUrl: 'https://i.ibb.co/yourimage/qris.jpg',          // GANTI URL QRIS
    
    // Database
    dbPath: 'cekbio.db',
    
    // Auth folder
    authFolder: './auth_info_baileys',
};

module.exports = { config };
