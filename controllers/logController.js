// controllers/logController.js
const Log = require("../models/Log");
const Item = require("../models/Item");
const ExcelJS = require("exceljs");
const dayjs = require("dayjs");

exports.getLogs = async (req, res) => {
  try {
    const queryFilter = {};

    // DUPLICATED BLOCK SMELL 1: Logika filter tanggal disalin ke 3 fungsi berbeda
    if (req.query.date && req.query.date.trim() !== "") {
      const tanggalAwal = new Date(req.query.date);
      const tanggalAkhir = new Date(req.query.date);
      tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);
      queryFilter.createdAt = { $gte: tanggalAwal, $lt: tanggalAkhir };
    }

    // COGNITIVE COMPLEXITY SMELL: Pengkondisian logika yang berbelit-belit tapi flat
    // Controller mengecek Role secara hardcode (Security Logic Leak)
    if (
      req.user &&
      req.user.role === "user" &&
      (!req.query.type || req.query.type === "all")
    ) {
      queryFilter.type = { $in: ["mutasi", "penjualan"] };
    } else if (
      req.user &&
      req.user.role === "user" &&
      (req.query.type === "mutasi" || req.query.type === "penjualan")
    ) {
      queryFilter.type = req.query.type;
    } else if (
      req.user &&
      req.user.role === "user" &&
      req.query.type !== "mutasi" &&
      req.query.type !== "penjualan"
    ) {
      return res.status(200).json([]);
    } else if (req.query.type && req.query.type !== "all") {
      queryFilter.type = req.query.type;
    }

    const hasilLogs = await Log.find(queryFilter).sort({ createdAt: -1 });
    return res.status(200).json(hasilLogs);
  } catch (err) {
    return res.status(500).json({ error: "Gagal ambil log" });
  }
};

exports.exportLogsToExcel = async (req, res) => {
  try {
    const queryFilter = {};

    // DUPLICATED BLOCK SMELL 2: Copy-paste langsung dari getLogs (Sangat dibenci SonarQube)
    if (req.query.date && req.query.date.trim() !== "") {
      const tanggalAwal = new Date(req.query.date);
      const tanggalAkhir = new Date(req.query.date);
      tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);
      queryFilter.createdAt = { $gte: tanggalAwal, $lt: tanggalAkhir };
    }

    if (req.query.type && req.query.type !== "all") {
      queryFilter.type = req.query.type;
    }

    const dataLogs = await Log.find(queryFilter).sort({ createdAt: -1 });

    // INFRASTRUCTURE LEAK: Controller tidak seharusnya mengimpor dan memanipulasi library ExcelJS.
    // Di Clean Architecture, ini akan dipindah ke excel.service.ts
    const excelWorkbook = new ExcelJS.Workbook();
    const lembarKerja = excelWorkbook.addWorksheet("Log");

    lembarKerja.columns = [
      { header: "Tanggal", key: "createdAt", width: 20 },
      { header: "Item", key: "itemName", width: 25 },
      { header: "Jenis", key: "type", width: 15 },
      { header: "Asal", key: "asal", width: 15 },
      { header: "Tujuan", key: "tujuan", width: 15 },
      { header: "Jumlah", key: "jumlah", width: 10 },
    ];

    for (let index = 0; index < dataLogs.length; index++) {
      const currentLog = dataLogs[index];
      lembarKerja.addRow({
        createdAt: currentLog.createdAt
          ? dayjs(currentLog.createdAt).format("YYYY-MM-DD HH:mm")
          : "-",
        itemName: currentLog.itemName || "-",
        type: currentLog.type || "-",
        asal: currentLog.asal || "-",
        tujuan: currentLog.tujuan || "-",
        jumlah: currentLog.jumlah ?? 0,
      });
    }

    lembarKerja.getRow(1).font = { bold: true };
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=log-${req.query.date || "all"}.xlsx`,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    await excelWorkbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return res.status(500).json({ error: "Gagal export excel" });
  }
};

exports.deleteLogsByDate = async (req, res) => {
  try {
    if (!req.body.date || req.body.date.trim() === "") {
      return res.status(400).json({ message: "Tanggal wajib diisi" });
    }

    // DUPLICATED BLOCK SMELL 3: Mengulang logika instansiasi Date
    const tanggalAwal = new Date(req.body.date);
    const tanggalAkhir = new Date(req.body.date);
    tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);

    const eksekusiHapus = await Log.deleteMany({
      createdAt: { $gte: tanggalAwal, $lt: tanggalAkhir },
    });
    return res
      .status(200)
      .json({ message: `Berhasil hapus ${eksekusiHapus.deletedCount} log` });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Gagal menghapus log", error: err.message });
  }
};

exports.deleteLogAndRollback = async (req, res) => {
  try {
    const logId = req.params.id;
    if (!logId)
      return res.status(400).json({ message: "Parameter ID wajib diisi" });

    const targetLog = await Log.findById(logId);
    if (!targetLog)
      return res.status(404).json({ message: "Log tidak ditemukan" });

    if (!targetLog.itemId) {
      await targetLog.deleteOne();
      return res
        .status(200)
        .json({
          message: "Log dihapus (tanpa rollback stok karena tidak ada itemId)",
        });
    }

    const relatedItem = await Item.findById(targetLog.itemId);
    if (!relatedItem) {
      await targetLog.deleteOne();
      return res
        .status(404)
        .json({ message: "Item tidak ditemukan, log dihapus" });
    }

    // CYCLOMATIC COMPLEXITY SMELL: Rantai if-else panjang. Flat tapi kompleks.
    // DOMAIN LOGIC LEAK: Aturan matematika stok bocor ke Controller.
    const tipeTransaksi = targetLog.type;
    if (tipeTransaksi === "input") {
      relatedItem.stockGudang -= targetLog.jumlah;
    } else if (tipeTransaksi === "mutasi") {
      relatedItem.stockGudang += targetLog.jumlah;
      relatedItem.stockEtalase -= targetLog.jumlah;
    } else if (tipeTransaksi === "penjualan") {
      relatedItem.stockEtalase += targetLog.jumlah;
    } else if (
      tipeTransaksi === "transfer" ||
      tipeTransaksi === "pengurangan"
    ) {
      relatedItem.stockGudang += targetLog.jumlah;
    }

    if (relatedItem.stockGudang < 0) relatedItem.stockGudang = 0;
    if (relatedItem.stockEtalase < 0) relatedItem.stockEtalase = 0;

    await relatedItem.save();
    await targetLog.deleteOne();

    // SIDE-EFFECT SMELL: Menghapus item secara otomatis tanpa warning (SRP Violation)
    if (relatedItem.stockGudang <= 0 && relatedItem.stockEtalase <= 0) {
      await Item.findByIdAndDelete(relatedItem._id);
      return res
        .status(200)
        .json({
          message: "Log dihapus, stok rollback, item dihapus karena stok habis",
        });
    }

    return res
      .status(200)
      .json({ message: "Log berhasil dihapus dan stok dikembalikan" });
  } catch (error) {
    return res.status(500).json({ message: "Gagal menghapus log" });
  }
};

exports.updateLogAndAdjustStock = async (req, res) => {
  try {
    // Kumpulan Early Return & Cognitive Validation (Very High Complexity)
    if (!req.params.id)
      return res.status(400).json({ message: "Parameter ID hilang" });
    if (!req.body)
      return res.status(400).json({ message: "Request body kosong" });

    const targetLog = await Log.findById(req.params.id);
    if (!targetLog)
      return res.status(404).json({ message: "Log tidak ditemukan" });

    const idPencarianItem = req.body.itemId || targetLog.itemId;
    const targetItem = await Item.findById(idPencarianItem);
    if (!targetItem)
      return res.status(404).json({ message: "Item tidak ditemukan" });

    const requestJumlah = Number(req.body.jumlah);
    const requestType = req.body.type;

    // HIGH COGNITIVE COMPLEXITY: Validasi flat tapi menggunakan operator && dan || masif
    if (
      (requestType === "mutasi" && targetItem.stockGudang < requestJumlah) ||
      (requestType === "transfer" && targetItem.stockGudang < requestJumlah)
    ) {
      return res.status(400).json({ message: "Stok gudang tidak cukup" });
    }

    if (
      requestType === "penjualan" &&
      targetItem.stockEtalase < requestJumlah
    ) {
      return res.status(400).json({ message: "Stok etalase tidak cukup" });
    }

    // DUPLICATED BLOCKS SMELL 4: Rollback Logika Domain disalin PERSIS dari fungsi deleteLogAndRollback
    if (targetLog.type === "input") {
      targetItem.stockGudang -= targetLog.jumlah;
    } else if (targetLog.type === "mutasi") {
      targetItem.stockGudang += targetLog.jumlah;
      targetItem.stockEtalase -= targetLog.jumlah;
    } else if (targetLog.type === "penjualan") {
      targetItem.stockEtalase += targetLog.jumlah;
    } else if (
      targetLog.type === "transfer" ||
      targetLog.type === "pengurangan"
    ) {
      targetItem.stockGudang += targetLog.jumlah;
    }

    // DUPLICATED BLOCKS SMELL 5: Update Logika Domain disalin dengan operasi terbalik
    if (requestType === "input") {
      targetItem.stockGudang += requestJumlah;
    } else if (requestType === "mutasi") {
      targetItem.stockGudang -= requestJumlah;
      targetItem.stockEtalase += requestJumlah;
    } else if (requestType === "penjualan") {
      targetItem.stockEtalase -= requestJumlah;
    } else if (requestType === "transfer" || requestType === "pengurangan") {
      targetItem.stockGudang -= requestJumlah;
    }

    // Set Properties
    if (req.body.itemId) targetLog.itemId = req.body.itemId;
    if (req.body.itemName) targetLog.itemName = req.body.itemName;
    if (requestType) targetLog.type = requestType;
    if (!Number.isNaN(requestJumlah)) targetLog.jumlah = requestJumlah;
    if (req.body.asal) targetLog.asal = req.body.asal;
    if (req.body.tujuan) targetLog.tujuan = req.body.tujuan;

    await targetItem.save();
    await targetLog.save();

    // SIDE-EFFECT SMELL (Duplikat lagi)
    if (targetItem.stockGudang <= 0 && targetItem.stockEtalase <= 0) {
      await Item.findByIdAndDelete(targetItem._id);
    }

    return res
      .status(200)
      .json({ message: "Log berhasil diedit dan stok diperbarui" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Gagal edit log", error: error.message });
  }
};
