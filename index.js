import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import handleMessage from './chiga.js';

// === Helper DB ===
function bacaDB(namaFile) {
    try {
        const p = path.join(process.cwd(), namaFile);
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) { return null; }
}
function tulisDB(namaFile, data) {
    fs.writeFileSync(path.join(process.cwd(), namaFile), JSON.stringify(data, null, 2));
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }), 
        browser: ["Ubuntu", "Chrome", "20.0.0"] 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('⏳ Sedang memuat QR Code...');
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Logout! Hapus auth_info_baileys.');
            } else {
                console.log('🔄 Terputus, menyambung ulang...');
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot berhasil terhubung dan siap digunakan!');
            mulaiMesinWaktu(sock); // Nyalakan Alarm dan Spam
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            const m = messages[0];
            if (!m.message) return;
            await handleMessage(sock, m);
        }
    });
}

// === MESIN ALARM & SPAM ANTI-DOOM SCROLLING ===
function mulaiMesinWaktu(sock) {
    setInterval(() => {
        // Tarik zona waktu Jakarta agar stabil
        const sekarang = new Date();
        const waktuWIB = new Date(sekarang.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        
        const jam = waktuWIB.getHours();
        const tglSekarang = waktuWIB.toLocaleDateString('en-CA'); // Format: YYYY-MM-DD
        const msSekarang = waktuWIB.getTime();

        let dbUser = bacaDB('database_user.json');
        if (!dbUser) return;

        for (const nomorJid in dbUser) {
            let user = dbUser[nomorJid];
            if (!user.aktif) continue;

            // 1. PENGINGAT TUGAS HARIAN (JAM 15:00 WIB)
            if (jam === 15 && user.tglTugasRemind !== tglSekarang) {
                let dataTugas = bacaDB('tugas.json');
                if (dataTugas && Array.isArray(dataTugas) && dataTugas.length > 0) {
                    let teks = `🚨 *PENGINGAT TUGAS HARIAN* 🚨\n\n`;
                    dataTugas.forEach((t, i) => { teks += `*${i+1}. ${t.tugas}*\n⏰ DL: ${t.deadline}\n\n`; });
                    teks += `Ayo dikerjain bos!`;
                    
                    sock.sendMessage(nomorJid, { text: teks });
                }
                user.tglTugasRemind = tglSekarang; // Tandai sudah dikirim hari ini
                tulisDB('database_user.json', dbUser);
            }

            // 2. SPAM ANTI-DOOM SCROLLING (19:00 - 21:59 WIB, TIAP 5 MENIT)
            if (jam >= 19 && jam <= 21) {
                // Cek kalau lu belum ngetik password aman
                if (user.doomAmanTgl !== tglSekarang) {
                    // Cek apakah sudah 5 menit (300.000 ms) sejak spam terakhir
                    if (!user.lastSpamTime || (msSekarang - user.lastSpamTime >= 300000)) {
                        
                        const variasiPesan = [
                            "🚨 WOI! UDAH MALEM STOP DOOM SCROLLING!",
                            "⚠️ HP-nya ditaruh bos, lanjutin tugas sana!",
                            "💀 Masih aja scroll TikTok/IG mulu, tutup woi!",
                            "🛑 Berhenti main HP sekarang. Balas *aku tak doom scrolling* kalau udah beneran sadar."
                        ];
                        const pesanRandom = variasiPesan[Math.floor(Math.random() * variasiPesan.length)];
                        
                        sock.sendMessage(nomorJid, { text: pesanRandom });
                        
                        user.lastSpamTime = msSekarang; // Reset timer spam 5 menit
                        tulisDB('database_user.json', dbUser);
                    }
                }
            }
        }
    }, 60000); // Looping dicek setiap 1 Menit (60000 ms)
}

// === SISTEM ANTI-CRASH ===
process.on('uncaughtException', (err) => console.error(err));
process.on('unhandledRejection', (err) => console.error(err));

connectToWhatsApp();