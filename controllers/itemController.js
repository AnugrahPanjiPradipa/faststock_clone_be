// controllers/itemController.js
const mongoose = require("mongoose");
const Item = require("../models/Item");
const Log = require("../models/Log");

exports.createItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, stockGudang, asal } = req.body;

    if (name && name.trim() !== "") {
      const initialStock = Number(stockGudang) || 0;

      if (!Number.isNaN(initialStock) && initialStock >= 0) {
        const newItem = new Item({
          name,
          stockGudang: initialStock,
          stockEtalase: 0,
          asal: asal || "Gudang Utama",
        });

        await newItem.save({ session });

        if (initialStock > 0) {
          const newLog = new Log({
            itemId: newItem._id,
            itemName: newItem.name,
            type: "input",
            jumlah: initialStock,
            asal: newItem.asal,
          });
          await newLog.save({ session });
        }

        await session.commitTransaction();
        session.endSession();
        return res.status(201).json(newItem);
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: "Stok awal harus berupa angka valid dan tidak negatif",
        });
      }
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Nama item wajib diisi" });
    }
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ error: "Gagal membuat item" });
  }
};

exports.getItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skipData = (page - 1) * limit;

    const queryFilter = req.query.search
      ? { name: { $regex: req.query.search, $options: "i" } }
      : {};

    const itemsData = await Item.find(queryFilter).skip(skipData).limit(limit);
    const totalItems = await Item.countDocuments(queryFilter);

    return res.status(200).json({
      items: itemsData,
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil data items" });
  }
};

// ARCHITECTURAL SMELL: Fat Controller / God Object / Transaction Script
// Menggabungkan logika 3 proses bisnis berbeda ke dalam satu fungsi HTTP
exports.processInventory = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // SMELL: Arrow Anti-Pattern (Deep Nesting)
    if (req.params.id) {
      const actionType = req.body.actionType;
      const jumlah = Number(req.body.jumlah);

      if (actionType && actionType.trim() !== "") {
        if (!Number.isNaN(jumlah) && jumlah > 0) {
          const itemData = await Item.findById(req.params.id).session(session);

          if (itemData) {
            // SMELL: Switch/If Statement Complexity (Violates Open-Closed Principle)
            if (actionType === "mutasi") {
              if (itemData.stockGudang >= jumlah) {
                itemData.stockGudang -= jumlah;
                itemData.stockEtalase += jumlah;
                await itemData.save({ session });

                const logMutasi = new Log({
                  itemId: itemData._id,
                  itemName: itemData.name,
                  type: "mutasi",
                  asal: itemData.asal,
                  jumlah: jumlah,
                });
                await logMutasi.save({ session });

                // SMELL: Code Duplication (Commit & abort transaksi berulang-ulang)
                await session.commitTransaction();
                session.endSession();
                const updatedItem = await Item.findById(req.params.id);
                return res.status(200).json(updatedItem);
              } else {
                await session.abortTransaction();
                session.endSession();
                return res
                  .status(400)
                  .json({ error: "Stok gudang tidak mencukupi untuk mutasi" });
              }
            } else if (actionType === "penjualan") {
              if (itemData.stockEtalase >= jumlah) {
                itemData.stockEtalase -= jumlah;
                await itemData.save({ session });

                const logJual = new Log({
                  itemId: itemData._id,
                  itemName: itemData.name,
                  type: "penjualan",
                  asal: itemData.asal,
                  jumlah: jumlah,
                });
                await logJual.save({ session });

                await session.commitTransaction();
                session.endSession();
                const updatedItem = await Item.findById(req.params.id);
                return res.status(200).json(updatedItem);
              } else {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                  error: "Stok etalase tidak mencukupi untuk penjualan",
                });
              }
            } else if (actionType === "transfer") {
              const tujuanTransfer = req.body.tujuan;
              if (tujuanTransfer && tujuanTransfer.trim() !== "") {
                if (itemData.stockGudang >= jumlah) {
                  itemData.stockGudang -= jumlah;
                  await itemData.save({ session });

                  const logTransfer = new Log({
                    itemId: itemData._id,
                    itemName: itemData.name,
                    type: "transfer",
                    tujuan: tujuanTransfer,
                    jumlah: jumlah,
                  });
                  await logTransfer.save({ session });

                  await session.commitTransaction();
                  session.endSession();
                  const updatedItem = await Item.findById(req.params.id);
                  return res.status(200).json(updatedItem);
                } else {
                  await session.abortTransaction();
                  session.endSession();
                  return res
                    .status(400)
                    .json({ error: "Stok gudang tidak cukup untuk transfer" });
                }
              } else {
                await session.abortTransaction();
                session.endSession();
                return res
                  .status(400)
                  .json({ error: "Tujuan transfer wajib disertakan" });
              }
            } else {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({ error: "Tipe aksi tidak valid" });
            }
          } else {
            await session.abortTransaction();
            session.endSession();
            return res
              .status(404)
              .json({ error: "Data item tidak ditemukan di sistem" });
          }
        } else {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(400)
            .json({ error: "Jumlah harus berupa angka positif" });
        }
      } else {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ error: "Tipe aksi (actionType) wajib diisi" });
      }
    } else {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ error: "Parameter ID item tidak ditemukan" });
    }
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({
      error: "Terjadi kesalahan sistem saat pemrosesan",
      detail: err.message,
    });
  }
};

exports.updateItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (req.params.id) {
      const itemData = await Item.findById(req.params.id).session(session);

      if (itemData) {
        const { name, addStockGudang, asal } = req.body;

        if (name && name.trim() !== "") {
          itemData.name = name;
        }

        if (
          addStockGudang !== undefined &&
          addStockGudang !== null &&
          addStockGudang !== ""
        ) {
          const tambahanStok = Number(addStockGudang);

          if (!Number.isNaN(tambahanStok)) {
            if (itemData.stockGudang + tambahanStok >= 0) {
              itemData.stockGudang += tambahanStok;

              if (tambahanStok !== 0) {
                const logUpdate = new Log({
                  itemId: itemData._id,
                  itemName: itemData.name,
                  type: tambahanStok > 0 ? "input" : "pengurangan",
                  jumlah: Math.abs(tambahanStok),
                  asal: asal || itemData.asal,
                });
                await logUpdate.save({ session });
              }
            } else {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({
                error: "Perubahan stok menyebabkan stok menjadi negatif",
              });
            }
          } else {
            await session.abortTransaction();
            session.endSession();
            return res
              .status(400)
              .json({ error: "Format penambahan stok tidak valid" });
          }
        }

        await itemData.save({ session });
        await session.commitTransaction();
        session.endSession();

        const updatedItem = await Item.findById(req.params.id);
        return res.status(200).json(updatedItem);
      } else {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ error: "Item yang akan diupdate tidak ditemukan" });
      }
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "ID item harus disertakan di URL" });
    }
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ error: "Gagal memproses pembaruan item" });
  }
};

exports.deleteItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (req.params.id) {
      const itemData = await Item.findById(req.params.id).session(session);

      if (itemData) {
        await Item.deleteOne({ _id: itemData._id }, { session });
        await session.commitTransaction();
        session.endSession();

        return res
          .status(200)
          .json({ message: "Item berhasil dihapus dari sistem" });
      } else {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(404)
          .json({ error: "Item yang akan dihapus tidak ditemukan" });
      }
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Parameter ID wajib diisi" });
    }
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ error: "Gagal menghapus item" });
  }
};
