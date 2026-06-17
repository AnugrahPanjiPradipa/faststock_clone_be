// routes/ItemRoutes.js
const express = require("express");
const router = express.Router();
const itemController = require("../controllers/itemController");

// Import middleware autentikasi & autorisasi
const { protect, adminOnly, staffAndAdmin } = require("../middleware/auth");

// Semua route di bawah ini wajib login (terotentikasi)
router.use(protect);

// Hak Akses: Staff (User) & Admin
router.get("/", staffAndAdmin, itemController.getItems); // Melihat Daftar Barang
router.put("/mutasi/:id", staffAndAdmin, itemController.mutasiGudang); // Mutasi Internal
router.put("/penjualan/:id", staffAndAdmin, itemController.penjualan); // Penjualan / Barang Keluar

// Hak Akses Khusus Admin (Staff dilarang)
router.post("/", adminOnly, itemController.createItem); // Menambah Master Barang
router.put("/:id", adminOnly, itemController.updateItem); // Edit Data Barang
router.delete("/:id", adminOnly, itemController.deleteItem); // Menghapus Barang
router.put("/transfer/:id", adminOnly, itemController.transferGudang); // Transfer Antar Cabang

module.exports = router;