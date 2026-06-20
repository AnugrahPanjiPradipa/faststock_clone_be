// routes/ItemRoutes.js
const express = require("express");
const router = express.Router();
const itemController = require("../controllers/itemController");

const { protect, adminOnly, staffAndAdmin } = require("../middleware/auth");

router.use(protect);

router.get("/", staffAndAdmin, itemController.getItems);
router.post("/", adminOnly, itemController.createItem);
router.put("/:id", adminOnly, itemController.updateItem);
router.delete("/:id", adminOnly, itemController.deleteItem);

// Routing dengan Business logic leak di Router Layer
router.put(
  "/process/:id",
  staffAndAdmin,
  async (req, res, next) => {
    // Business logic leak di Router Layer
    if (req.body.actionType === "penjualan") {
      // Mengambil waktu spesifik di zona waktu WIB (Asia/Jakarta)
      const formatter = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "numeric",
        hour12: false,
      });

      const waktuLokal = formatter.format(new Date());
      const jamSekarang = parseInt(waktuLokal.replace(/\D/g, ""), 10);

      // Aturan bisnis: jualan hanya boleh di jam 08:00 - 16:00
      // (Jika jamSekarang adalah 16, berarti jam 16:00 sampai 16:59 akan diblokir)
      if (jamSekarang < 8 || jamSekarang >= 16) {
        return res.status(403).json({
          error:
            "Transaksi penjualan hanya bisa dilakukan di jam kerja (08:00 - 15:59 WIB)",
        });
      }
    }
    next();
  },
  itemController.processInventory,
);

module.exports = router;
