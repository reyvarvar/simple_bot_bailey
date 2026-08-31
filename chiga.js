import path from "path";
import fs from "fs";

// === FUNGSI DATABASE ===
function bacaDB(namaFile) {
    try {
        const p = path.join(process.cwd(), namaFile);
        if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({}));
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) { return {}; }
}
function tulisDB(namaFile, data) {
    fs.writeFileSync(path.join(process.cwd(), namaFile), JSON.stringify(data, null, 2));
}

// === FUNGSI BACA DEADLINE (AUTO HAPUS) ===
function parseDeadlineStr(str) {
    try {
        // Mengubah "13-11-25 13.00" jadi format waktu komputer
        let parts = str.split(' ');
        let dateP = parts[0].split('-');
        let timeP = (parts[1] || '23.59').split('.');
        let d = parseInt(dateP[0]);
        let m = parseInt(dateP[1]) - 1;
        let y = parseInt(dateP[2]) + 2000;
        let h = parseInt(timeP[0]);
        let min = parseInt(timeP[1]);
        let t = new Date(y, m, d, h, min).getTime();
        return isNaN(t) ? null : t;
    } catch(e) { return null; }
}

export default async function handleMessage(sock, m) {
  try {
    const pengirim = m.key.remoteJid;
    
    // Abaikan pesan dari grup, status, atau bot
    if (pengirim.endsWith("@g.us") || pengirim === "status@broadcast" || m.key.fromMe) return;

    // === PENARIK PESAN ===
    let pesanMasuk = m.message?.conversation || 
                     m.message?.extendedTextMessage?.text || 
                     m.message?.ephemeralMessage?.message?.conversation ||
                     m.message?.ephemeralMessage?.message?.extendedTextMessage?.text || 
                     m.message?.imageMessage?.caption || 
                     m.message?.videoMessage?.caption || "";
                     
    pesanMasuk = pesanMasuk.trim();
    if (!pesanMasuk) return; 

    const inputLower = pesanMasuk.toLowerCase();
    console.log(`[DEBUG] Ada chat masuk: ${pesanMasuk}`);

    async function kirimTeks(teks) {
      await sock.sendMessage(pengirim, { text: teks }, { quoted: m });
    }
    
    async function kirimGambarLokal(pathFile, captionText) {
      const filePath = path.join(process.cwd(), pathFile);
      if (fs.existsSync(filePath)) {
        await sock.sendMessage(pengirim, { image: fs.readFileSync(filePath), caption: captionText }, { quoted: m });
      } else {
        await kirimTeks(captionText);
      }
    }

    // === 1. LOGIKA HALO & STOP ===
    let dbUser = bacaDB('database_user.json');

    if (inputLower === "./halo") {
      if (!dbUser[pengirim]) dbUser[pengirim] = {};
      dbUser[pengirim].aktif = true;
      tulisDB('database_user.json', dbUser);
      return await kirimTeks(`👋 Halo Bos! Asisten FATISDA *AKTIF*.\n\nKetik *0* untuk menu utama.\nKetik *./stop* untuk mematikan bot.`);
    }

    if (inputLower === "./stop") {
      if (dbUser[pengirim]) {
        dbUser[pengirim].aktif = false;
        tulisDB('database_user.json', dbUser);
      }
      return await kirimTeks(`🛑 Bot *DINONAKTIFKAN*. Ketik ./halo untuk menyalakan lagi.`);
    }

    if (!dbUser[pengirim] || !dbUser[pengirim].aktif) return;

    // === 2. MANTRA ANTI-DOOM SCROLLING ===
    if (inputLower === "aku tak doom scrolling") {
        const tglSekarang = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        dbUser[pengirim].doomAmanTgl = tglSekarang; 
        tulisDB('database_user.json', dbUser);
        return await kirimTeks("✅ Mantap! Selamat istirahat atau nugas bos. Bot nggak akan nge-spam lu malam ini.");
    }

    // === 3. MANAJEMEN TUGAS (TAMBAH & SELESAI) ===
    if (inputLower.startsWith("./update tugas ")) {
      const parts = pesanMasuk.split(/ deadline /i);
      if (parts.length < 2) return await kirimTeks("❌ Format salah bang!\n*./update tugas [nama] deadline [waktu]*\nContoh: ./update tugas pbo deadline 13-11-25 13.00");
      
      const namaTugas = parts[0].replace(/.\/update tugas /i, "").trim();
      const waktuDeadline = parts[1].trim();

      let dataTugas = bacaDB('tugas.json');
      if (!Array.isArray(dataTugas)) dataTugas = []; 
      
      dataTugas.push({ tugas: namaTugas, deadline: waktuDeadline, selesai: false });
      tulisDB('tugas.json', dataTugas);
      return await kirimTeks(`✅ *TUGAS DICATAT*\n📚 ${namaTugas}\n⏰ ${waktuDeadline}`);
    }

    if (inputLower.startsWith("./selesai ")) {
        let nomor = parseInt(inputLower.replace("./selesai ", "").trim());
        let dataTugas = bacaDB('tugas.json');
        
        if (!Array.isArray(dataTugas) || dataTugas.length === 0) {
            return await kirimTeks("❌ Belum ada tugas yang dicatat bos.");
        }
        if (isNaN(nomor) || nomor < 1 || nomor > dataTugas.length) {
            return await kirimTeks(`❌ Nomor salah! Pilih dari 1 sampai ${dataTugas.length}.`);
        }
        
        dataTugas[nomor - 1].selesai = true;
        tulisDB('tugas.json', dataTugas);
        return await kirimTeks(`✅ Mantap! Tugas *~${dataTugas[nomor - 1].tugas}~* udah dicoret dari daftar utang nyawa lu.`);
    }

    // === 4. FITUR KEUANGAN ===
    if (inputLower.startsWith("./catat ") || inputLower === "./saldo") {
        let dbKeuangan = bacaDB('keuangan.json');
        
        if (!dbKeuangan[pengirim]) {
            dbKeuangan[pengirim] = {
                saldo: 750000,
                resetDate: new Date().getTime() + (15 * 24 * 60 * 60 * 1000), 
                history: []
            };
        }

        let uangUser = dbKeuangan[pengirim];
        let sekarangMs = new Date().getTime();

        if (sekarangMs > uangUser.resetDate) {
            uangUser.saldo = 750000;
            uangUser.resetDate = sekarangMs + (15 * 24 * 60 * 60 * 1000);
            uangUser.history = []; 
            await kirimTeks("🔄 *SIKLUS BARU DIMULAI*\n\nSudah lewat 15 hari! Saldo dompet lu udah di-reset penuh jadi *Rp 750.000*.");
        }

        const sisaHari = Math.ceil((uangUser.resetDate - sekarangMs) / (1000 * 60 * 60 * 24));

        if (inputLower === "./saldo") {
            return await kirimTeks(`💰 *INFO DOMPET LU*\n\n💳 Sisa Saldo: *Rp ${uangUser.saldo.toLocaleString('id-ID')}*\n⏳ Reset siklus: *${sisaHari} hari lagi*`);
        }

        if (inputLower.startsWith("./catat ")) {
            let textCatat = pesanMasuk.replace(/.\/catat /i, "").trim();
            let matchAngka = textCatat.match(/^\d+/);
            
            if (!matchAngka) return await kirimTeks("❌ Format salah!\nContoh: *./catat 15000 makan siang*");

            let nominal = parseInt(matchAngka[0]);
            let keterangan = textCatat.replace(matchAngka[0], "").trim() || "Nggak ada keterangan";

            if (nominal > uangUser.saldo) {
                return await kirimTeks(`⚠️ *SALDO NGGAK CUKUP!*\n\nSisa saldo lu cuma *Rp ${uangUser.saldo.toLocaleString('id-ID')}*, masa mau ngeluarin Rp ${nominal.toLocaleString('id-ID')}? Tahan bang!`);
            }

            uangUser.saldo -= nominal;
            uangUser.history.push({ tgl: new Date().toLocaleDateString('id-ID'), nominal, ket: keterangan });
            tulisDB('keuangan.json', dbKeuangan);
            
            return await kirimTeks(`📉 *PENGELUARAN TERCATAT*\n\n💸 Keluar: Rp ${nominal.toLocaleString('id-ID')} (${keterangan})\n💳 Sisa Saldo: *Rp ${uangUser.saldo.toLocaleString('id-ID')}*\n⏳ Reset: ${sisaHari} hari lagi.`);
        }
    }

    // === 5. MENU UTAMA ===
    if (pesanMasuk === "0" || inputLower === "menu") {
      const menuUtama = `🎓 *ASISTEN PRIBADI*\n\n1️⃣ Jadwal Hari Ini & Besok\n2️⃣ Link Penting\n3️⃣ Daftar Tugas\n\n📌 *PANDUAN FITUR TAMBAHAN:*\n\n💰 *Keuangan (Limit 750k/15 hari)*\n• Cek sisa duit: Ketik *./saldo*\n• Catat jajan: Ketik *./catat 15000 makan siang*\n\n📚 *Pengingat Tugas*\n• Tambah: Ketik *./update tugas pbo deadline 13-11-25 13.00*\n• Coret Selesai: Ketik *./selesai 1* (sesuai nomor urut)\n\n👉 Ketik angka menu.`;
      
      return await kirimGambarLokal("./image/fatisda.jpeg", menuUtama);
    }

    if (pesanMasuk === "1") {
      let jadwalDB = bacaDB('jadwal.json');
      const jadwalIF = jadwalDB["informatika25a"];
      if (!jadwalIF) return await kirimTeks("❌ Database jadwal belum tersedia.");

      const waktuSekarang = new Date();
      const namaHariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      
      let indexHariIni = waktuSekarang.getDay();
      let indexBesok = indexHariIni + 1;
      
      if (indexHariIni === 5) indexBesok = 1;
      if (indexHariIni === 0 || indexHariIni === 6) { indexHariIni = 1; indexBesok = 2; }

      const hariIniStr = namaHariIndo[indexHariIni];
      const besokStr = namaHariIndo[indexBesok];

      let teksJadwal = `📅 *JADWAL KULIAH KELAS A*\n\n`;
      teksJadwal += `📍 *HARI INI (${hariIniStr.toUpperCase()})*\n${jadwalIF[hariIniStr] || "_Tidak ada jadwal_"}\n\n`;
      teksJadwal += `⏩ *BESOK (${besokStr.toUpperCase()})*\n${jadwalIF[besokStr] || "_Tidak ada jadwal_"}\n\n`;
      teksJadwal += `_Ketik 0 untuk kembali._`;

      return await kirimTeks(teksJadwal);
    }

    if (pesanMasuk === "2") return await kirimTeks(`📌 *LINK PENTING*\nSIAKAD: https://siakad.uns.ac.id/\nBank Soal: https://uns.id/BankSoalFATISDA\nDiscord: https://uns.id/ftisd-discord`);

    // LOGIKA CEK TUGAS & AUTO-HAPUS (MENU 3)
    if (pesanMasuk === "3") {
      let dataTugas = bacaDB('tugas.json');
      
      if (!Array.isArray(dataTugas) || dataTugas.length === 0) {
        return await kirimTeks("🎉 *TIDAK ADA TUGAS*\n\nSaat ini belum ada tugas yang dicatat. Aman bos!");
      }

      // Filter Auto-Hapus Tugas Expired
      let sekarang = new Date().getTime();
      let tugasBaru = [];
      let adaYangDihapus = false;

      for (let t of dataTugas) {
          let msDeadline = parseDeadlineStr(t.deadline);
          // Kalau format salah atau deadline udah lewat, kita buang (nggak di-push)
          if (msDeadline && msDeadline < sekarang) {
              adaYangDihapus = true;
          } else {
              tugasBaru.push(t);
          }
      }

      // Update file kalau ada tugas yang kadaluarsa
      if (adaYangDihapus) {
          tulisDB('tugas.json', tugasBaru);
          dataTugas = tugasBaru; 
      }

      // Cek lagi setelah difilter, siapa tau habis semua
      if (dataTugas.length === 0) {
        return await kirimTeks("🎉 *TIDAK ADA TUGAS*\n\nSemua tugas udah kelar atau kelewat deadline. Bebas!");
      }

      let balasan = `📝 *DAFTAR TUGAS LU*\n\n`;
      dataTugas.forEach((t, i) => {
        // Tanda coret kalau udah selesai
        let namaTugas = t.selesai ? `~${t.tugas}~ (✅ Selesai)` : t.tugas;
        balasan += `*${i + 1}. ${namaTugas}*\n   ⏰ Deadline: ${t.deadline}\n\n`;
      });
      balasan += `_Semangat ngerjainnya bos!_`;
      
      return await kirimTeks(balasan);
    }
    
  } catch (error) {
    console.error("[SYSTEM] Error Chiga:", error);
  }
}