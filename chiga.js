import path from "path";
import fs from "fs";

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

function getTanggalWIB() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function getWaktuWIBObj() {
    const sekarang = new Date();
    return new Date(sekarang.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

function parseDeadlineStr(str) {
    try {
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

// === FUNGSI MATEMATIKA KEUANGAN (1.5JT / 30 HARI = 50RB/HARI) ===
export function kelolaKeuanganHarian(pengirim) {
    let dbKeuangan = bacaDB('keuangan.json');
    const tglSekarang = getTanggalWIB();
    const waktuWIB = getWaktuWIBObj();
    //atur sendiri
    const JATAH_BULANAN = 0;
    const LIMIT_HARIAN = 0;

    const tglHariIni = waktuWIB.getDate();
    const sisaHariDefault = Math.max(1, 30 - tglHariIni + 1);

    if (!dbKeuangan[pengirim]) {
        dbKeuangan[pengirim] = {
            saldoBulanan: JATAH_BULANAN,
            sisaHari: sisaHariDefault,
            tglTerakhir: tglSekarang,
            terpakaiHariIni: 0,
            hutangHarian: 0,
            surplusTabungan: 0,
            history: []
        };
    }

    let u = dbKeuangan[pengirim];

    // AUTO-FIX JIKA FILE JSON LAMA MASIH UNDEFINED / NaN
    if (typeof u.sisaHari !== 'number' || isNaN(u.sisaHari) || u.sisaHari <= 0) {
        u.sisaHari = sisaHariDefault;
    }
    if (typeof u.saldoBulanan !== 'number' || isNaN(u.saldoBulanan)) {
        u.saldoBulanan = JATAH_BULANAN;
    }
    if (typeof u.terpakaiHariIni !== 'number' || isNaN(u.terpakaiHariIni)) {
        u.terpakaiHariIni = 0;
    }
    if (!u.tglTerakhir) {
        u.tglTerakhir = tglSekarang;
    }

    // Cek pergantian hari otomatis
    if (u.tglTerakhir !== tglSekarang) {
        let tglKemarin = new Date(u.tglTerakhir);
        let tglSkrgObj = new Date(tglSekarang);
        let selisihHari = Math.floor((tglSkrgObj - tglKemarin) / (1000 * 60 * 60 * 24));

        if (selisihHari > 0) {
            u.sisaHari -= selisihHari;
            u.terpakaiHariIni = 0;
            u.tglTerakhir = tglSekarang;

            if (u.sisaHari <= 0) {
                u.saldoBulanan = JATAH_BULANAN;
                u.sisaHari = 30;
                u.hutangHarian = 0;
                u.surplusTabungan = 0;
                u.history = [];
            }
        }
    }

    // Hitung target ideal & hutang
    let targetSaldoIdealSekarang = u.sisaHari * LIMIT_HARIAN;
    let toleransiJatahHariIni = Math.min(u.terpakaiHariIni, LIMIT_HARIAN);
    let hitunganHutang = (targetSaldoIdealSekarang - toleransiJatahHariIni) - u.saldoBulanan;

    if (hitunganHutang > 0) {
        u.hutangHarian = hitunganHutang;
        u.surplusTabungan = 0;
    } else {
        u.hutangHarian = 0;
        u.surplusTabungan = Math.abs(hitunganHutang);
    }

    tulisDB('keuangan.json', dbKeuangan);
    return { dbKeuangan, u, LIMIT_HARIAN, targetSaldoIdealSekarang };
}

// === FUNGSI PENCATAT TRANSAKSI ===
export async function prosesTransaksiKeuangan(sock, pengirim, nominal, keterangan, sumber = "Manual") {
    let { dbKeuangan, u, LIMIT_HARIAN } = kelolaKeuanganHarian(pengirim);

    u.saldoBulanan -= nominal;
    u.terpakaiHariIni += nominal;
    u.history.push({
        tgl: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        nominal,
        ket: keterangan,
        sumber
    });

    tulisDB('keuangan.json', dbKeuangan);

    let evaluasi = kelolaKeuanganHarian(pengirim);
    u = evaluasi.u;

    let sisaJatahHariIni = LIMIT_HARIAN - u.terpakaiHariIni;
    let statusHarianTeks = "";

    if (sisaJatahHariIni >= 0) {
        statusHarianTeks = `✅ Sisa Jatah Hari Ini: *Rp ${sisaJatahHariIni.toLocaleString('id-ID')}*`;
    } else {
        statusHarianTeks = `🚨 *OVERLIMIT HARI INI:* Lewat *Rp ${Math.abs(sisaJatahHariIni).toLocaleString('id-ID')}* dari jatah Rp 50.000!`;
    }

    if (u.hutangHarian > 0) {
        statusHarianTeks += `\n⚠️ *Total Hutang Target:* Rp ${u.hutangHarian.toLocaleString('id-ID')}\n_(Uangmu kurang Rp ${u.hutangHarian.toLocaleString('id-ID')} dari target ideal ${u.sisaHari} hari)_`;
    } else if (u.surplusTabungan > 0) {
        statusHarianTeks += `\n🌟 *Surplus/Hemat:* +Rp ${u.surplusTabungan.toLocaleString('id-ID')} di atas target!`;
    }

    let pesanNotif = `📉 *PENGELUARAN (${sumber})*\n\n` +
                     `💸 Keluar: *Rp ${nominal.toLocaleString('id-ID')}* (${keterangan})\n` +
                     `📊 Hari Ini: Rp ${u.terpakaiHariIni.toLocaleString('id-ID')} / Rp 50.000\n` +
                     `${statusHarianTeks}\n\n` +
                     `💳 Sisa Saldo: *Rp ${u.saldoBulanan.toLocaleString('id-ID')}* (${u.sisaHari} hari lagi)`;

    await sock.sendMessage(pengirim, { text: pesanNotif });
}

// === TAMPILAN AWAL RINGKAS ===
function buatDashboardRingkas(pengirim) {
    const waktuWIB = getWaktuWIBObj();
    const namaHariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const hariIniStr = namaHariIndo[waktuWIB.getDay()];
    const tanggalLengkap = waktuWIB.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    let jadwalDB = bacaDB('jadwal.json');
    let jadwalIF = jadwalDB ? jadwalDB["informatika25a"] : null;
    let jadwalHariIni = (jadwalIF && jadwalIF[hariIniStr]) ? jadwalIF[hariIniStr] : "_Libur / Tidak ada jadwal kuliah_";
    jadwalHariIni = jadwalHariIni.replace(/praktikum/gi, "🔵 *PRAKTIKUM*");

    let dataTugas = bacaDB('tugas.json');
    if (!Array.isArray(dataTugas)) dataTugas = [];
    let sekarangMs = new Date().getTime();
    
    dataTugas = dataTugas.filter(t => {
        let ms = parseDeadlineStr(t.deadline);
        return !ms || ms >= sekarangMs;
    });
    tulisDB('tugas.json', dataTugas);

    let tugasBelumSelesai = dataTugas.filter(t => !t.selesai);
    let teksTugas = "";
    if (tugasBelumSelesai.length === 0) {
        teksTugas = "🎉 _Aman! Tidak ada tugas._";
    } else {
        dataTugas.forEach((t, i) => {
            if (!t.selesai) {
                teksTugas += `*${i + 1}. ${t.tugas}* (⏰ ${t.deadline})\n`;
            }
        });
    }

    let { u, LIMIT_HARIAN, targetSaldoIdealSekarang } = kelolaKeuanganHarian(pengirim);
    let sisaJatahHariIni = LIMIT_HARIAN - u.terpakaiHariIni;

    return `🗓️ *${hariIniStr}, ${tanggalLengkap}*\n\n` +
           `📚 *MATKUL HARI INI:*\n${jadwalHariIni}\n\n` +
           `📝 *TUGAS BELUM KELAR:*\n${teksTugas.trim()}\n\n` +
           `💰 *DOMPET LU (${u.sisaHari} hari lagi):*\n` +
           `• Saldo Nyata: *Rp ${u.saldoBulanan.toLocaleString('id-ID')}*\n` +
           `• Target Seharusnya: Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')}\n` +
           `• Sisa Jatah Hari Ini: *Rp ${sisaJatahHariIni.toLocaleString('id-ID')}*\n` +
           `• Hutang Target: *Rp ${u.hutangHarian.toLocaleString('id-ID')}*\n\n` +
           `👉 _Ketik *0* untuk membuka Menu Lengkap._`;
}

// === TAMPILAN MENU LENGKAP (SAAT KETIK 0 / MENU) ===
function buatMenuLengkap(pengirim) {
    let { u, LIMIT_HARIAN, targetSaldoIdealSekarang } = kelolaKeuanganHarian(pengirim);
    let sisaJatahHariIni = LIMIT_HARIAN - u.terpakaiHariIni;

    return `⚙️ *MENU LENGKAP & PERINTAH BOT*\n\n` +
           `💰 *INFO SALDO AKTIF (${u.sisaHari} hari lagi):*\n` +
           `• Saldo Nyata: *Rp ${u.saldoBulanan.toLocaleString('id-ID')}*\n` +
           `• Saldo Seharusnya: Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')}\n` +
           `• Sisa Jatah Hari Ini: *Rp ${sisaJatahHariIni.toLocaleString('id-ID')}*\n` +
           `• Hutang Target: *Rp ${u.hutangHarian.toLocaleString('id-ID')}*\n\n` +
           `*navigasi:*\n` +
           `• *1* : Jadwal Hari Ini & Besok\n` +
           `• *2* : Link Penting Kampus\n` +
           `• *3* : Semua Daftar Tugas\n` +
           `• *4* : Jadwal Full 1 Minggu\n\n` +
           `*keuangan:*\n` +
           `• *./saldo* : Detail dompet & hitungan hutang\n` +
           `• *./catat 15000 makan* : Catat pengeluaran\n` +
           `• *./setuang [saldo] [hari]* : Set saldo & hitung hutang (Cth: *./setuang 1300000 27*)\n` +
           `• *./sethari [hari]* : Ubah sisa hari aja (Cth: *./sethari 27*)\n` +
           `• *./resetuang* : Reset siklus 1.5jt baru (30 hari)\n\n` +
           `*manajemen tugas:*\n` +
           `• *./update tugas [nama] deadline [tgl]*\n` +
           `• *./selesai [no]* : Tandai tugas kelar\n` +
           `• *./hapus tugas [no]* : Hapus tugas\n\n` +
           `🔙 *Ketik "kembali" atau "00" untuk keluar ke Tampilan Awal.*\n` +
           `🛑 *Ketik "./stop" untuk mematikan bot.*`;
}

export default async function handleMessage(sock, m) {
  try {
    const pengirim = m.key.remoteJid;
    if (pengirim.endsWith("@g.us") || pengirim === "status@broadcast" || m.key.fromMe) return;

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

    let dbUser = bacaDB('database_user.json');

    // === TAMPILAN AWAL RINGKAS & TOMBOL KELUAR/KEMBALI ===
    if (
      inputLower === "./halo" || 
      inputLower === "./info" || 
      inputLower === "kembali" || 
      inputLower === "keluar" || 
      inputLower === "back" || 
      pesanMasuk === "00"
    ) {
      if (!dbUser[pengirim]) dbUser[pengirim] = {};
      dbUser[pengirim].aktif = true;
      tulisDB('database_user.json', dbUser);
      const teksRingkas = buatDashboardRingkas(pengirim);
      return await kirimGambarLokal("./image/fatisda.jpeg", teksRingkas);
    }

    if (inputLower === "./stop") {
      if (dbUser[pengirim]) {
        dbUser[pengirim].aktif = false;
        tulisDB('database_user.json', dbUser);
      }
      return await kirimTeks(`🛑 Bot *DINONAKTIFKAN*. Ketik ./halo untuk menyalakan lagi.`);
    }

    if (!dbUser[pengirim] || !dbUser[pengirim].aktif) return;

    // === KETIK 0 UNTUK BUKA MENU LENGKAP ===
    if (pesanMasuk === "0" || inputLower === "menu") {
      return await kirimTeks(buatMenuLengkap(pengirim));
    }

    // === MANAJEMEN TUGAS ===
    if (inputLower.startsWith("./update tugas ")) {
      const parts = pesanMasuk.split(/ deadline /i);
      if (parts.length < 2) return await kirimTeks("❌ Format salah bang!\n*./update tugas [nama] deadline [waktu]*");
      
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
        
        if (!Array.isArray(dataTugas) || dataTugas.length === 0 || isNaN(nomor) || nomor < 1 || nomor > dataTugas.length) {
            return await kirimTeks("❌ Nomor salah atau nggak ada tugas.");
        }
        
        dataTugas[nomor - 1].selesai = true;
        tulisDB('tugas.json', dataTugas);
        return await kirimTeks(`✅ Mantap! Tugas *~${dataTugas[nomor - 1].tugas}~* udah dicoret.`);
    }

    if (inputLower.startsWith("./hapus tugas ")) {
        let nomor = parseInt(inputLower.replace("./hapus tugas ", "").trim());
        let dataTugas = bacaDB('tugas.json');
        
        if (!Array.isArray(dataTugas) || dataTugas.length === 0 || isNaN(nomor) || nomor < 1 || nomor > dataTugas.length) {
            return await kirimTeks("❌ Nomor salah atau nggak ada tugas.");
        }
        
        let tugasDihapus = dataTugas[nomor - 1].tugas;
        dataTugas.splice(nomor - 1, 1); 
        tulisDB('tugas.json', dataTugas);
        return await kirimTeks(`🗑️ Tugas *${tugasDihapus}* berhasil dihapus permanen!`);
    }

    // === KEUANGAN & UPDATE SALDO / HARI ===
    if (inputLower === "./saldo") {
        let { u, LIMIT_HARIAN, targetSaldoIdealSekarang } = kelolaKeuanganHarian(pengirim);
        let sisaHariIni = LIMIT_HARIAN - u.terpakaiHariIni;

        let teksSaldo = `💰 *INFO DOMPET & HITUNGAN TARGET*\n\n` +
                        `⏳ Sisa Waktu: *${u.sisaHari} hari lagi*\n` +
                        `💳 Saldo Nyata: *Rp ${u.saldoBulanan.toLocaleString('id-ID')}*\n` +
                        `🎯 Target Seharusnya (${u.sisaHari}x50rb): *Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')}*\n\n` +
                        `📉 Terpakai Hari Ini: *Rp ${u.terpakaiHariIni.toLocaleString('id-ID')}*\n` +
                        `💵 Sisa Jatah Hari Ini: *Rp ${sisaHariIni.toLocaleString('id-ID')}*\n` +
                        `⚠️ Hutang Target: *Rp ${u.hutangHarian.toLocaleString('id-ID')}*` +
                        (u.surplusTabungan > 0 ? `\n🌟 Surplus Hemat: *+Rp ${u.surplusTabungan.toLocaleString('id-ID')}*` : ``) +
                        `\n\n🔙 _Ketik "kembali" ke Tampilan Awal, atau "0" ke Menu._`;
        return await kirimTeks(teksSaldo);
    }

    // UPDATE SALDO SEKALIGUS SISA HARI + HITUNG HUTANG OTOMATIS
    if (inputLower.startsWith("./setuang ")) {
        let args = pesanMasuk.replace(/.\/setuang /i, "").trim().split(/\s+/);
        let saldoBaru = parseInt(args[0]?.replace(/\./g, ''));
        
        if (isNaN(saldoBaru)) {
            return await kirimTeks("❌ Format salah!\nKetik: *./setuang [saldo] [sisa_hari]*\nContoh: *./setuang 1300000 27*");
        }

        const waktuWIB = getWaktuWIBObj();
        const sisaHariDefault = Math.max(1, 30 - waktuWIB.getDate() + 1);

        let sisaHariCustom = parseInt(args[1]);
        if (isNaN(sisaHariCustom) || sisaHariCustom <= 0) sisaHariCustom = sisaHariDefault;

        let dbKeuangan = bacaDB('keuangan.json');
        dbKeuangan[pengirim] = {
            saldoBulanan: saldoBaru,
            sisaHari: sisaHariCustom,
            tglTerakhir: getTanggalWIB(),
            terpakaiHariIni: 0,
            hutangHarian: 0,
            surplusTabungan: 0,
            history: []
        };
        tulisDB('keuangan.json', dbKeuangan);

        let { u, targetSaldoIdealSekarang } = kelolaKeuanganHarian(pengirim);
        let hariBerjalan = 30 - sisaHariCustom;

        let infoSelisih = "";
        if (u.hutangHarian > 0) {
            infoSelisih = `⚠️ *Hutang Tercatat: Rp ${u.hutangHarian.toLocaleString('id-ID')}*\n_(Karena di sisa ${sisaHariCustom} hari, uangmu harusnya Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')})_`;
        } else if (u.surplusTabungan > 0) {
            infoSelisih = `🌟 *Surplus / Lebih Hemat: +Rp ${u.surplusTabungan.toLocaleString('id-ID')}*\n_(Uangmu di atas target seharusnya Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')})_`;
        } else {
            infoSelisih = `✅ *Pas Sesuai Target!* Tidak ada hutang.`;
        }

        return await kirimTeks(
            `✅ *SALDO & HITUNGAN HARI DIATUR!*\n\n` +
            `🗓️ Siklus: *${sisaHariCustom} hari lagi* (Sudah jalan ${hariBerjalan} hari)\n` +
            `💳 Saldo Nyata: *Rp ${saldoBaru.toLocaleString('id-ID')}*\n` +
            `🎯 Seharusnya (${sisaHariCustom} x 50rb): *Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')}*\n\n` +
            `${infoSelisih}\n\n` +
            `🔙 _Ketik "kembali" untuk melihat Tampilan Awal._`
        );
    }

    // UPDATE SISA HARI SAJA TANPA UBAH SALDO
    if (inputLower.startsWith("./sethari ")) {
        let hariBaru = parseInt(pesanMasuk.replace(/.\/sethari /i, "").trim());
        if (isNaN(hariBaru) || hariBaru <= 0) {
            return await kirimTeks("❌ Format salah!\nContoh: *./sethari 27*");
        }

        let dbKeuangan = bacaDB('keuangan.json');
        if (!dbKeuangan[pengirim]) kelolaKeuanganHarian(pengirim);
        dbKeuangan = bacaDB('keuangan.json');
        
        dbKeuangan[pengirim].sisaHari = hariBaru;
        tulisDB('keuangan.json', dbKeuangan);

        let { u, targetSaldoIdealSekarang } = kelolaKeuanganHarian(pengirim);

        return await kirimTeks(
            `⏳ *SISA HARI BERHASIL DIUBAH!*\n\n` +
            `🗓️ Sisa Hari: *${u.sisaHari} hari lagi*\n` +
            `💳 Saldo Nyata: *Rp ${u.saldoBulanan.toLocaleString('id-ID')}*\n` +
            `🎯 Saldo Seharusnya: *Rp ${targetSaldoIdealSekarang.toLocaleString('id-ID')}*\n` +
            `⚠️ Hutang Target: *Rp ${u.hutangHarian.toLocaleString('id-ID')}*\n\n` +
            `🔙 _Ketik "kembali" untuk melihat Tampilan Awal._`
        );
    }

    if (inputLower.startsWith("./catat ")) {
        let textCatat = pesanMasuk.replace(/.\/catat /i, "").trim();
        let matchAngka = textCatat.match(/^[\d\.]+/);
        if (!matchAngka) return await kirimTeks("❌ Format: *./catat 15000 makan*");

        let nominal = parseInt(matchAngka[0].replace(/\./g, ''));
        let keterangan = textCatat.replace(matchAngka[0], "").trim() || "Pengeluaran Manual";

        return await prosesTransaksiKeuangan(sock, pengirim, nominal, keterangan, "Manual WA");
    }

    if (inputLower === "./resetuang") {
        let dbKeuangan = bacaDB('keuangan.json');
        dbKeuangan[pengirim] = {
            saldoBulanan: 1500000,
            sisaHari: 30,
            tglTerakhir: getTanggalWIB(),
            terpakaiHariIni: 0,
            hutangHarian: 0,
            surplusTabungan: 0,
            history: []
        };
        tulisDB('keuangan.json', dbKeuangan);
        return await kirimTeks("🔄 *SIKLUS BARU 30 HARI DIMULAI*\n\nSaldo di-reset penuh jadi Rp 1.500.000 (30 hari x Rp 50.000) dan hutang kembali Rp 0.");
    }

    // === SUB-MENU ANGKA (1 - 4) ===
    if (pesanMasuk === "1") {
      let jadwalDB = bacaDB('jadwal.json');
      const jadwalIF = jadwalDB["informatika25a"];
      if (!jadwalIF) return await kirimTeks("❌ Database jadwal belum tersedia.");

      const waktuSekarang = getWaktuWIBObj();
      const namaHariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      
      let indexHariIni = waktuSekarang.getDay();
      let indexBesok = (indexHariIni + 1) % 7;

      const hariIniStr = namaHariIndo[indexHariIni];
      const besokStr = namaHariIndo[indexBesok];

      let jadwalHariIni = jadwalIF[hariIniStr] || "_Libur / Tidak ada jadwal_";
      let jadwalBesok = jadwalIF[besokStr] || "_Libur / Tidak ada jadwal_";

      jadwalHariIni = jadwalHariIni.replace(/praktikum/gi, "🔵 *PRAKTIKUM*");
      jadwalBesok = jadwalBesok.replace(/praktikum/gi, "🔵 *PRAKTIKUM*");

      let teksJadwal = `📅 *JADWAL KULIAH KELAS A*\n\n`;
      teksJadwal += `📍 *HARI INI (${hariIniStr.toUpperCase()})*\n${jadwalHariIni}\n\n`;
      teksJadwal += `⏩ *BESOK (${besokStr.toUpperCase()})*\n${jadwalBesok}\n\n`;
      teksJadwal += `🔙 _Ketik "kembali" ke Tampilan Awal, atau "0" ke Menu._`;

      return await kirimTeks(teksJadwal);
    }

    if (pesanMasuk === "2") return await kirimTeks(`📌 *LINK PENTING*\nSIAKAD: https://siakad.uns.ac.id/\nBank Soal: https://uns.id/BankSoalFATISDA\nDiscord: https://uns.id/ftisd-discord\n\n🔙 _Ketik "kembali" ke Tampilan Awal, atau "0" ke Menu._`);

    if (pesanMasuk === "3") {
      let dataTugas = bacaDB('tugas.json');
      if (!Array.isArray(dataTugas) || dataTugas.length === 0) {
        return await kirimTeks("🎉 *TIDAK ADA TUGAS*\n\nSaat ini belum ada tugas yang dicatat. Aman bos!\n\n🔙 _Ketik \"kembali\" ke Tampilan Awal._");
      }

      let balasan = `📝 *SEMUA DAFTAR TUGAS LU*\n\n`;
      dataTugas.forEach((t, i) => {
        let namaTugas = t.selesai ? `~${t.tugas}~ (✅ Selesai)` : t.tugas;
        balasan += `*${i + 1}. ${namaTugas}*\n   ⏰ Deadline: ${t.deadline}\n\n`;
      });
      balasan += `_Ketik ./selesai [nomor] jika sudah kelar._\n🔙 _Ketik "kembali" ke Tampilan Awal, atau "0" ke Menu._`;
      return await kirimTeks(balasan);
    }
    
    if (pesanMasuk === "4") {
      let jadwalDB = bacaDB('jadwal.json');
      const jadwalIF = jadwalDB["informatika25a"];
      if (!jadwalIF) return await kirimTeks("❌ Database jadwal belum tersedia.");

      let teksJadwal = `🗓️ *JADWAL FULL 1 MINGGU*\n\n`;
      const hariList = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];

      hariList.forEach(hari => {
          let isi = jadwalIF[hari] || "_Libur / Kosong_";
          isi = isi.replace(/praktikum/gi, "🔵 *PRAKTIKUM*");
          teksJadwal += `📍 *${hari.toUpperCase()}*\n${isi}\n\n`;
      });
      
      teksJadwal += `🔙 _Ketik "kembali" ke Tampilan Awal, atau "0" ke Menu._`;
      return await kirimTeks(teksJadwal);
    }
    
  } catch (error) {
    console.error("[SYSTEM] Error Chiga:", error);
  }
}