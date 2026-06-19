// controllers/authController.js
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");

exports.register = async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Generate token verifikasi acak
    const verificationToken = crypto.randomBytes(20).toString("hex");

    const user = new User({
      username,
      email,
      password,
      role,
      verificationToken,
    });

    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

    const message = `Halo ${username},\n\nTerima kasih telah mendaftar. Silakan klik link berikut untuk memverifikasi email kamu:\n\n${verificationUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Verifikasi Email FastStock",
        message,
      });
      res.status(201).json({
        message: "User terdaftar. Silakan cek email kamu untuk verifikasi.",
      });
    } catch (err) {
      user.verificationToken = undefined;
      await user.save();
      return res.status(500).json({ error: "Gagal mengirim email verifikasi" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token });

    if (!user) {
      return res
        .status(400)
        .json({ error: "Token tidak valid atau sudah digunakan" });
    }

    user.isEmailVerified = true;
    user.verificationToken = undefined; // Hapus token setelah berhasil verifikasi
    await user.save();

    res
      .status(200)
      .json({ message: "Email berhasil diverifikasi. Silakan login." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user)
      return res.status(400).json({ error: "Username tidak ditemukan" });

    // Cek apakah email sudah diverifikasi
    if (!user.isEmailVerified) {
      return res.status(401).json({
        error: "Email belum diverifikasi. Silakan cek inbox email kamu.",
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: "Password salah" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Fitur Lupa Password ---
exports.forgotPassword = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(404).json({ error: "Email tidak terdaftar" });
    }

    const resetToken = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // Kadaluarsa dalam 10 menit
    await user.save();

    // 👇 INI BAGIAN YANG SUDAH DIUBAH KE PORT 5173 👇
    const resetUrl = `http://localhost:5173/reset-password?token=${resetToken}`;

    const message = `Kamu menerima email ini karena ada permintaan reset password.\n\nKlik link berikut untuk membuat password baru:\n\n${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Reset Password FastStock",
        message,
      });
      res
        .status(200)
        .json({ message: "Email panduan reset password telah dikirim" });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res
        .status(500)
        .json({ error: "Gagal mengirim email reset password" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    // Cari user berdasarkan token dan pastikan belum kedaluwarsa
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ error: "Token tidak valid atau sudah kedaluwarsa" });
    }

    // Set password baru dan hapus token reset
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res
      .status(200)
      .json({ message: "Password berhasil diubah. Silakan login." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
