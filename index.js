import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import handleMessage, { prosesTransaksiKeuangan } from './chiga.js';

// === KONFIGURASI EMAIL TUMBAL ===
const EMAIL_TUMBAL = 'cocstm302@gmail.com'; // Alamat Gmail tumbal kamu
const APP_PASSWORD = '';      // WAJIB ISI LAGI: 16 digit App Password Google kamu

// Variabel global untuk mencegah interval ganda saat WA reconnect & mencegah proses email duplikat
let activeSock = null;
let intervalWaktu = null;
let intervalEmail = null;
let sedangCekEmail = false;
const processedUids = new Set();

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

    activeSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
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
            mulaiMesinWaktu();
            mulaiPantauEmail();
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

// === MESIN PEMBACA EMAIL (LIVIN' MANDIRI, GRAB, & GOOGLE CLASSROOM) ===
function mulaiPantauEmail() {
    // Hapus interval lama jika sempat reconnect agar tidak jalan dobel/berkali-kali
    if (intervalEmail) clearInterval(intervalEmail);

    intervalEmail = setInterval(async () => {
        if (sedangCekEmail) return; // Cegah tabrakan proses jika pengecekan sebelumnya belum kelar
        if (!APP_PASSWORD || EMAIL_TUMBAL.includes('emailtumbalkamu')) return;
        if (!activeSock) return;

        let dbUser = bacaDB('database_user.json');
        if (!dbUser) return;

        const targetJid = Object.keys(dbUser).find(jid => dbUser[jid].aktif);
        if (!targetJid) return;

        sedangCekEmail = true;

        const client = new ImapFlow({
            host: 'imap.gmail.com',
            port: 993,
            secure: true,
            auth: { user: EMAIL_TUMBAL, pass: APP_PASSWORD },
            logger: false
        });

        try {
            await client.connect();
            let lock = await client.getMailboxLock('INBOX');
            try {
                // Gunakan { uid: true } agar konsisten menggunakan UID unik email
                const unseenUids = await client.search({ seen: false }, { uid: true });
                
                for (let uid of unseenUids) {
                    // Jika UID ini sudah pernah diproses, langsung lewati dan tandai Seen
                    if (processedUids.has(uid)) {
                        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
                        continue;
                    }

                    let message = await client.fetchOne(uid, { source: true }, { uid: true });
                    if (!message || !message.source) continue;

                    // KUNCI ANTI-SPAM: Langsung catat UID & tandai sudah dibaca SEBELUM eksekusi potong saldo/tugas
                    processedUids.add(uid);
                    await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });

                    let parsed = await simpleParser(message.source);
                    let subjekEmail = parsed.subject || "";
                    let pengirimEmail = parsed.from?.text || "";
                    let teksEmail = parsed.text || (parsed.html ? parsed.html.replace(/<[^>]+>/g, '\n') : "");

                    // 1. DETEKSI STRUK QRIS LIVIN' MANDIRI
                    if (teksEmail.includes("Pembayaran Berhasil") || teksEmail.includes("Nominal Transaksi")) {
                        let matchPenerima = teksEmail.match(/Penerima\s*\n+\s*([^\n\r]+)/i);
                        let namaPenerima = matchPenerima ? matchPenerima[1].trim() : "Merchant QRIS";

                        let matchNominal = teksEmail.match(/Nominal Transaksi[\s\S]*?Rp\s*([\d\.,]+)/i);
                        if (matchNominal) {
                            let angkaBersih = parseInt(matchNominal[1].replace(/[\.,]/g, ''), 10);
                            if (!isNaN(angkaBersih) && angkaBersih > 0) {
                                await prosesTransaksiKeuangan(
                                    activeSock, 
                                    targetJid, 
                                    angkaBersih, 
                                    `QRIS: ${namaPenerima}`, 
                                    "Auto-Email Livin'"
                                );
                            }
                        }
                    }

                    // 2. DETEKSI STRUK GRAB E-RECEIPT (GrabFood / GrabBike / GrabCar)
                    else if (subjekEmail.includes("Your Grab E-Receipt") || pengirimEmail.toLowerCase().includes("grab.com")) {
                        // Ambil nama resto/merchant setelah "Pesanan Dari:" atau jenis layanan
                        let matchMerchant = teksEmail.match(/Pesanan Dari:\s*\n*\s*([^\n\r]+)/i) || teksEmail.match(/Jenis Kendaraan:\s*\n*\s*([^\n\r]+)/i);
                        let namaMerchant = matchMerchant ? matchMerchant[1].trim() : "Transaksi Grab";

                        // Tangkap angka setelah TOTAL atau TOTAL (INCL. TAX) (mendukung format Rp 13549 tanpa titik)
                        let matchNominal = teksEmail.match(/TOTAL(?:\s*\(INCL\.\s*TAX\))?[\s\S]*?Rp\s*([\d\.,]+)/i);
                        if (matchNominal) {
                            let angkaBersih = parseInt(matchNominal[1].replace(/[\.,]/g, ''), 10);
                            if (!isNaN(angkaBersih) && angkaBersih > 0) {
                                await prosesTransaksiKeuangan(
                                    activeSock,
                                    targetJid,
                                    angkaBersih,
                                    `Grab: ${namaMerchant}`,
                                    "Auto-Email Grab"
                                );
                            }
                        }
                    }

                    // 3. DETEKSI TUGAS GOOGLE CLASSROOM (DENGAN CEK ANTI-DUPLIKAT)
                    else if (subjekEmail.includes("Tugas baru:") || subjekEmail.includes("New assignment:")) {
                        let namaTugas = subjekEmail.replace(/.*(Tugas baru:|New assignment:)\s*/i, "").trim();
                        let matchTenggat = teksEmail.match(/(?:Tenggat|Due|Tenggat waktu)[:\s]+([^\n\r]+)/i);
                        let waktuDeadline = matchTenggat ? matchTenggat[1].trim() : "Cek Classroom";

                        let dataTugas = bacaDB('tugas.json');
                        if (!Array.isArray(dataTugas)) dataTugas = [];
                        
                        let labelTugas = `[Classroom] ${namaTugas}`;
                        // Cek apakah tugas dengan nama yang sama persis sudah ada di tugas.json
                        let sudahAda = dataTugas.some(t => t.tugas === labelTugas);

                        if (!sudahAda) {
                            dataTugas.push({ tugas: labelTugas, deadline: waktuDeadline, selesai: false });
                            tulisDB('tugas.json', dataTugas);

                            await activeSock.sendMessage(targetJid, { 
                                text: `📚 *TUGAS CLASSROOM BARU!*\n\n📝 Tugas: *${namaTugas}*\n⏰ Deadline: ${waktuDeadline}\n\n_Otomatis masuk ke daftar tugas kamu._` 
                            });
                        }
                    }
                }
            } finally {
                lock.release();
            }
            await client.logout();
        } catch (err) {
            // Abaikan error jaringan sesaat
        } finally {
            sedangCekEmail = false;
        }
    }, 60000);
}

// === MESIN PENGINGAT TUGAS HARIAN (JAM 19:00 WIB) ===
function mulaiMesinWaktu() {
    if (intervalWaktu) clearInterval(intervalWaktu);

    intervalWaktu = setInterval(() => {
        if (!activeSock) return;

        const sekarang = new Date();
        const waktuWIB = new Date(sekarang.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        
        const jam = waktuWIB.getHours();
        const tglSekarang = waktuWIB.toLocaleDateString('en-CA');

        let dbUser = bacaDB('database_user.json');
        if (!dbUser) return;

        for (const nomorJid in dbUser) {
            let user = dbUser[nomorJid];
            if (!user.aktif) continue;

            if (jam === 19 && user.tglTugasRemind !== tglSekarang) {
                let dataTugas = bacaDB('tugas.json');
                if (dataTugas && Array.isArray(dataTugas)) {
                    let tugasBelum = dataTugas.filter(t => !t.selesai);
                    if (tugasBelum.length > 0) {
                        let teks = `🚨 *PENGINGAT TUGAS HARIAN* 🚨\n\n`;
                        tugasBelum.forEach((t, i) => { teks += `*${i+1}. ${t.tugas}*\n⏰ DL: ${t.deadline}\n\n`; });
                        teks += `Ayo dikerjain bos!`;
                        activeSock.sendMessage(nomorJid, { text: teks });
                    }
                }
                user.tglTugasRemind = tglSekarang;
                tulisDB('database_user.json', dbUser);
            }
        }
    }, 60000);
}

process.on('uncaughtException', (err) => console.error(err));
process.on('unhandledRejection', (err) => console.error(err));

connectToWhatsApp();