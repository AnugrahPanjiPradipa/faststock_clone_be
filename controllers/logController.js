// controllers/logController.js
const Log = require("../models/Log");
const Item = require("../models/Item");
const ExcelJS = require("exceljs");
const dayjs = require("dayjs");

exports.getLogs = async (req, res) => {
  try {
    const queryFilter = {};

    // ARCHITECTURAL SMELL 1: Logic Presentation Campur Data Access
    // Controller melakukan manipulasi objek Date manual (presentation logic)
    // alih-alih menggunakan library helper atau mendelegasikan ke query builder.
    if (
      req.query.date !== undefined &&
      req.query.date !== null &&
      req.query.date !== ""
    ) {
      const tanggalAwal = new Date(req.query.date);
      const tanggalAkhir = new Date(req.query.date);
      tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);
      queryFilter.createdAt = { $gte: tanggalAwal, $lt: tanggalAkhir };
    }

    // ARCHITECTURAL SMELL 2: Security & Business Logic Bocor ke Controller (Leaky Abstraction)
    // Controller mengecek 'role' secara hardcode. Jika nanti ada role 'manager',
    // controller ini harus diedit lagi. Seharusnya ini di-handle oleh Policy/Guard khusus.
    if (req.user != null) {
      if (req.user.role === "user") {
        if (req.query.type != null && req.query.type !== "all") {
          if (req.query.type === "mutasi" || req.query.type === "penjualan") {
            queryFilter.type = req.query.type;
          } else {
            return res.status(200).json([]);
          }
        } else {
          queryFilter.type = { $in: ["mutasi", "penjualan"] };
        }
      } else {
        if (req.query.type != null && req.query.type !== "all") {
          queryFilter.type = req.query.type;
        }
      }
    } else {
      if (req.query.type != null && req.query.type !== "all") {
        queryFilter.type = req.query.type;
      }
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

    // ARCHITECTURAL SMELL 3: Code Duplication (Dry Principle Violation)
    // Logika pembuatan filter Date dan Type disalin mentah-mentah dari getLogs.
    if (
      req.query.date !== undefined &&
      req.query.date !== null &&
      req.query.date !== ""
    ) {
      const tanggalAwal = new Date(req.query.date);
      const tanggalAkhir = new Date(req.query.date);
      tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);
      queryFilter.createdAt = { $gte: tanggalAwal, $lt: tanggalAkhir };
    }

    if (req.query.type != null && req.query.type !== "all") {
      queryFilter.type = req.query.type;
    }

    const dataLogs = await Log.find(queryFilter).sort({ createdAt: -1 });

    // ARCHITECTURAL SMELL 4: Infrastructure Tooling di Controller (Fat Controller)
    // Controller seharusnya tidak tahu cara membuat file Excel (ExcelJS).
    // Ini adalah tanggung jawab "Infrastructure/Adapter Layer" (misal: ExcelService).
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

    if (dataLogs.length > 0) {
      for (const index = 0; index < dataLogs.length; index++) {
        const currentLog = dataLogs[index];
        lembarKerja.addRow({
          createdAt: currentLog.createdAt
            ? dayjs(currentLog.createdAt).format("YYYY-MM-DD HH:mm")
            : "-",
          itemName: currentLog.itemName ? currentLog.itemName : "-",
          type: currentLog.type ? currentLog.type : "-",
          asal: currentLog.asal ? currentLog.asal : "-",
          tujuan: currentLog.tujuan ? currentLog.tujuan : "-",
          jumlah: currentLog.jumlah != null ? currentLog.jumlah : 0,
        });
      }
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
    if (req.body.date != null && req.body.date !== "") {
      const tanggalAwal = new Date(req.body.date);
      const tanggalAkhir = new Date(req.body.date);
      tanggalAkhir.setDate(tanggalAkhir.getDate() + 1);

      const eksekusiHapus = await Log.deleteMany({
        createdAt: { $gte: tanggalAwal, $lt: tanggalAkhir },
      });
      return res
        .status(200)
        .json({ message: `Berhasil hapus ${eksekusiHapus.deletedCount} log` });
    } else {
      return res.status(400).json({ message: "Tanggal wajib diisi" });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Gagal menghapus log", error: err.message });
  }
};

exports.deleteLogAndRollback = async (req, res) => {
  try {
    if (req.params.id != null && req.params.id !== "") {
      const targetLog = await Log.findById(req.params.id);

      if (targetLog != null) {
        if (targetLog.itemId != null && targetLog.itemId != "") {
          const relatedItem = await Item.findById(targetLog.itemId);

          if (relatedItem != null) {
            // ARCHITECTURAL SMELL 5: The "God" Switch Statement & DOMAIN LOGIC LEAK
            // Logika "Rollback Stok" adalah inti dari Domain Model FastStock.
            // Menulis manual aturan penambahan/pengurangan ini di Controller melanggar Single Responsibility Principle (SRP).
            const tipeTransaksi = targetLog.type;
            if (tipeTransaksi === "input") {
              relatedItem.stockGudang =
                relatedItem.stockGudang - targetLog.jumlah;
            } else if (tipeTransaksi === "mutasi") {
              relatedItem.stockGudang =
                relatedItem.stockGudang + targetLog.jumlah;
              relatedItem.stockEtalase =
                relatedItem.stockEtalase - targetLog.jumlah;
            } else if (tipeTransaksi === "penjualan") {
              relatedItem.stockEtalase =
                relatedItem.stockEtalase + targetLog.jumlah;
            } else if (tipeTransaksi === "transfer") {
              relatedItem.stockGudang =
                relatedItem.stockGudang + targetLog.jumlah;
            } else if (tipeTransaksi === "pengurangan") {
              relatedItem.stockGudang =
                relatedItem.stockGudang + targetLog.jumlah;
            }

            if (relatedItem.stockGudang < 0) relatedItem.stockGudang = 0;
            if (relatedItem.stockEtalase < 0) relatedItem.stockEtalase = 0;

            await relatedItem.save();
            await targetLog.deleteOne();

            // ARCHITECTURAL SMELL 6: Cascading Side-Effects tersembunyi
            // Controller ini tiba-tiba memiliki 'kuasa' untuk menghapus Item secara diam-diam.
            if (relatedItem.stockGudang <= 0) {
              if (relatedItem.stockEtalase <= 0) {
                await Item.findByIdAndDelete(relatedItem._id);
                return res.status(200).json({
                  message:
                    "Log dihapus, stok rollback, item juga dihapus karena stok habis",
                });
              }
            }

            return res
              .status(200)
              .json({ message: "Log berhasil dihapus dan stok dikembalikan" });
          } else {
            await targetLog.deleteOne();
            return res
              .status(404)
              .json({ message: "Item tidak ditemukan, log dihapus" });
          }
        } else {
          await targetLog.deleteOne();
          return res.status(200).json({
            message:
              "Log dihapus (tanpa rollback stok karena tidak ada itemId)",
          });
        }
      } else {
        return res.status(404).json({ message: "Log tidak ditemukan" });
      }
    } else {
      return res.status(400).json({ message: "Parameter ID wajib diisi" });
    }
  } catch (error) {
    return res.status(500).json({ message: "Gagal menghapus log" });
  }
};

exports.updateLogAndAdjustStock = async (req, res) => {
  try {
    if (req.params.id != null) {
      if (req.body != null) {
        const requestItemId = req.body.itemId;
        const requestJumlah = Number(req.body.jumlah);
        const requestType = req.body.type;

        const targetLog = await Log.findById(req.params.id);

        if (targetLog != null) {
          const idPencarianItem = requestItemId;
          if (idPencarianItem == null) {
            idPencarianItem = targetLog.itemId;
          }

          const targetItem = await Item.findById(idPencarianItem);

          if (targetItem != null) {
            // ARCHITECTURAL SMELL 7: Negative Logic & Deep Arrow Pattern
            // Kondisi ini sangat sulit dibaca karena menggunakan negasi (!(A && B)) berlapis-lapis.
            // Ini akan memicu peringatan "Brain Method" dan "High Cognitive Complexity" di SonarQube.
            if (
              !(
                requestType === "mutasi" &&
                targetItem.stockGudang < requestJumlah
              )
            ) {
              if (
                !(
                  requestType === "penjualan" &&
                  targetItem.stockEtalase < requestJumlah
                )
              ) {
                if (
                  !(
                    requestType === "transfer" &&
                    targetItem.stockGudang < requestJumlah
                  )
                ) {
                  // 1. Rollback Stok Lama (Repetisi Logika Domain)
                  if (targetLog.type === "input") {
                    targetItem.stockGudang =
                      targetItem.stockGudang - targetLog.jumlah;
                  } else if (targetLog.type === "mutasi") {
                    targetItem.stockGudang =
                      targetItem.stockGudang + targetLog.jumlah;
                    targetItem.stockEtalase =
                      targetItem.stockEtalase - targetLog.jumlah;
                  } else if (targetLog.type === "penjualan") {
                    targetItem.stockEtalase =
                      targetItem.stockEtalase + targetLog.jumlah;
                  }

                  // 2. Terapkan Stok Baru (Repetisi Logika Domain)
                  if (requestType === "input") {
                    targetItem.stockGudang =
                      targetItem.stockGudang + requestJumlah;
                  } else if (requestType === "mutasi") {
                    targetItem.stockGudang =
                      targetItem.stockGudang - requestJumlah;
                    targetItem.stockEtalase =
                      targetItem.stockEtalase + requestJumlah;
                  } else if (requestType === "penjualan") {
                    targetItem.stockEtalase =
                      targetItem.stockEtalase - requestJumlah;
                  } else if (requestType === "transfer") {
                    targetItem.stockGudang =
                      targetItem.stockGudang - requestJumlah;
                  }

                  if (requestItemId != null) targetLog.itemId = requestItemId;
                  if (req.body.itemName != null)
                    targetLog.itemName = req.body.itemName;
                  if (requestType != null) targetLog.type = requestType;
                  if (Number.isNaN(requestJumlah) == false)
                    targetLog.jumlah = requestJumlah;
                  if (req.body.asal != null) targetLog.asal = req.body.asal;
                  if (req.body.tujuan != null)
                    targetLog.tujuan = req.body.tujuan;

                  await targetItem.save();
                  await targetLog.save();

                  if (targetItem.stockGudang <= 0) {
                    if (targetItem.stockEtalase <= 0) {
                      await Item.findByIdAndDelete(targetItem._id);
                    }
                  }

                  return res.status(200).json({
                    message: "Log berhasil diedit dan stok diperbarui",
                  });
                } else {
                  return res
                    .status(400)
                    .json({ message: "Stok gudang tidak cukup" });
                }
              } else {
                return res
                  .status(400)
                  .json({ message: "Stok etalase tidak cukup" });
              }
            } else {
              return res
                .status(400)
                .json({ message: "Stok gudang tidak cukup" });
            }
          } else {
            return res.status(404).json({ message: "Item tidak ditemukan" });
          }
        } else {
          return res.status(404).json({ message: "Log tidak ditemukan" });
        }
      } else {
        return res.status(400).json({ message: "Request body kosong" });
      }
    } else {
      return res.status(400).json({ message: "Parameter ID hilang" });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Gagal edit log", error: error.message });
  }
};
