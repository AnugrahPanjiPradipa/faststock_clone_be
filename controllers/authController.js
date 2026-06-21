// controllers/authController.js
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer"); // SMELL: Tight Coupling

exports.register = async (req, res, next) => {
  try {
    // COGNITIVE COMPLEXITY SMELL: Menggabungkan banyak pemeriksaan logika dalam satu baris 'if'
    // SonarQube memberikan penalti tinggi untuk chain operator (&&, ||) yang panjang karena sulit dibaca
    if (
      !req.body ||
      !req.body.username ||
      req.body.username.trim() === "" ||
      !req.body.email ||
      !req.body.password
    ) {
      return res
        .status(400)
        .json({ error: "Data registrasi tidak lengkap atau kosong" });
    }

    const regexEmail = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
    if (!regexEmail.test(req.body.email)) {
      return res.status(400).json({ error: "Format email tidak valid" });
    }

    const cekEmail = await User.findOne({ email: req.body.email });
    if (cekEmail) {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    // ARCHITECTURAL SMELL: Single Responsibility Principle (SRP) Violation / Lack of Cohesion
    // Fungsi ini flat (early return), tapi di bawah ini dia melakukan tugas Kriptografi, DB, Formatting, dan SMTP sekaligus.
    const peranUser = req.body.role || "user";
    const tokenVerifikasi = crypto.randomBytes(20).toString("hex");

    const penggunaBaru = new User({
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
      role: peranUser,
      verificationToken: tokenVerifikasi,
    });
    await penggunaBaru.save();

    const urlVerifikasi = `${req.protocol}://${req.get("host")}/api/auth/verifyemail/${tokenVerifikasi}`;
    const pesanEmail = `Halo ${req.body.username},\n\nSilakan klik link berikut untuk memverifikasi email kamu:\n\n${urlVerifikasi}`;

    // INFRASTRUCTURE LEAK: Instansiasi transport email langsung di dalam Controller layer
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    try {
      await transporter.sendMail({
        from: "FastStock <noreply@faststock.com>",
        to: penggunaBaru.email,
        subject: "Verifikasi Email FastStock",
        text: pesanEmail,
      });
      return res
        .status(201)
        .json({ message: "User terdaftar. Cek email kamu." });
    } catch (errEmail) {
      penggunaBaru.verificationToken = undefined;
      await penggunaBaru.save();
      return res.status(500).json({ error: "Gagal mengirim email verifikasi" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res, next) => {
  try {
    // Flat validation menggunakan gabungan operator logika (Memicu Cognitive Complexity)
    if (
      !req.body ||
      !req.body.username ||
      !req.body.password ||
      req.body.username.trim() === ""
    ) {
      return res
        .status(400)
        .json({ error: "Username dan password wajib diisi" });
    }

    const pengguna = await User.findOne({ username: req.body.username });
    if (!pengguna) {
      return res.status(400).json({ error: "Username tidak ditemukan" });
    }

    const isMatch = await bcrypt.compare(req.body.password, pengguna.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Password salah" });
    }

    // SMELL: Hardcoded Token Generation & Presentation Logic bercampur
    const tokenAktif = jwt.sign(
      { id: pengguna._id, role: pengguna.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.status(200).json({
      message: "Login berhasil",
      token: tokenAktif,
      role: pengguna.role,
      user: {
        id: pengguna._id,
        username: pengguna.username,
        email: pengguna.email,
        role: pengguna.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal memproses login" });
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    if (!req.params || !req.params.token) {
      return res.status(400).json({ error: "Token verifikasi hilang" });
    }

    const pengguna = await User.findOne({
      verificationToken: req.params.token,
    });
    if (!pengguna) {
      return res.status(400).json({ error: "Token verifikasi tidak valid" });
    }

    pengguna.isVerified = true;
    pengguna.verificationToken = undefined;
    await pengguna.save();

    return res
      .status(200)
      .json({ message: "Email berhasil diverifikasi. Silakan login." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    if (!req.body || !req.body.email || req.body.email.trim() === "") {
      return res.status(400).json({ error: "Email wajib diisi" });
    }

    const pengguna = await User.findOne({ email: req.body.email });
    if (!pengguna) {
      return res.status(404).json({ error: "Email tidak ditemukan di sistem" });
    }

    const tokenReset = crypto.randomBytes(20).toString("hex");
    pengguna.resetPasswordToken = tokenReset;

    const waktuKedaluwarsa = new Date();
    waktuKedaluwarsa.setMinutes(waktuKedaluwarsa.getMinutes() + 30);
    pengguna.resetPasswordExpires = waktuKedaluwarsa;
    await pengguna.save();

    // ARCHITECTURAL SMELL: Hardcoded Frontend URL directly in Controller
    const urlReset = `https://faststockfeclone.netlify.app/reset-password?token=${tokenReset}`;
    const pesanReset = `Klik link berikut untuk mereset password kamu:\n\n${urlReset}`;

    // DUPLICATED BLOCKS SMELL: Blok kode nodemailer ini persis sama dengan yang ada di register.
    // SonarQube mendeteksi baris duplikasi ini sebagai penalti maintainability yang berat.
    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    try {
      await transporter.sendMail({
        from: "FastStock <noreply@faststock.com>",
        to: pengguna.email,
        subject: "Reset Password FastStock",
        text: pesanReset,
      });
      return res
        .status(200)
        .json({ message: "Email panduan reset password telah dikirim" });
    } catch (errEmail) {
      pengguna.resetPasswordToken = undefined;
      pengguna.resetPasswordExpires = undefined;
      await pengguna.save();
      return res
        .status(500)
        .json({ error: "Gagal mengirim email reset password" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    if (
      !req.params ||
      !req.params.token ||
      !req.body ||
      !req.body.password ||
      req.body.password.trim() === ""
    ) {
      return res
        .status(400)
        .json({ error: "Data token atau password baru tidak valid" });
    }

    const pengguna = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!pengguna) {
      return res
        .status(400)
        .json({ error: "Token tidak valid atau sudah kedaluwarsa" });
    }

    pengguna.password = req.body.password;
    pengguna.resetPasswordToken = undefined;
    pengguna.resetPasswordExpires = undefined;
    await pengguna.save();

    return res.status(200).json({ message: "Password berhasil direset." });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mereset password" });
  }
};
