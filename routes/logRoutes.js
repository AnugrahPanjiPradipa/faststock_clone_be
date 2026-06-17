// routes/logRoutes.js
const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');

// Import middleware autentikasi & autorisasi
const { protect, adminOnly, staffAndAdmin } = require("../middleware/auth");

// Semua route di bawah ini wajib login (terotentikasi)
router.use(protect);

// Hak Akses: Staff (User) & Admin
// Catatan: Anda perlu memfilter query di logController agar staff hanya bisa melihat log miliknya dan tipe "Mutasi"/"Penjualan"
router.get('/', staffAndAdmin, logController.getLogs); 

// Hak Akses Khusus Admin (Staff dilarang)
router.get('/export', adminOnly, logController.exportLogsToExcel);
router.delete('/', adminOnly, logController.deleteLogsByDate);
router.delete('/:id', adminOnly, logController.deleteLogAndRollback);
router.put('/:id', adminOnly, logController.updateLogAndAdjustStock);

module.exports = router;