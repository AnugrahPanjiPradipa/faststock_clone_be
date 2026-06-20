// controllers/authController.js
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const bcrypt = require("bcryptjs"); // Tambahkan ini jika kamu pakai bcrypt untuk password

exports.register = async (req, res, next) => {
  try {
    // ARCHITECTURAL SMELL 1: Arrow Anti-Pattern (Deep Nesting)
    if (req.body != null) {
      if (req.body.username != null && req.body.username !== "") {
        if (req.body.email != null && req.body.email !== "") {
          if (req.body.password != null && req.body.password !== "") {
            // ARCHITECTURAL SMELL 2: Validasi Format di Controller
            const regexEmail = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
            if (regexEmail.test(req.body.email) === true) {
              const cekEmail = await User.findOne({ email: req.body.email });
              if (cekEmail == null) {
                const peranUser = "user";
                if (req.body.role != null && req.body.role !== "") {
                  peranUser = req.body.role;
                }

                // ARCHITECTURAL SMELL 3: Kriptografi di Controller
                const tokenVerifikasi = crypto.randomBytes(20).toString("hex");

                const penggunaBaru = new User({
                  username: req.body.username,
                  email: req.body.email,
                  password: req.body.password, // Asumsi di-hash di pre-save model, atau ganti bcrypt di sini
                  role: peranUser,
                  verificationToken: tokenVerifikasi,
                });

                await penggunaBaru.save();

                // ARCHITECTURAL SMELL 4: Presentation/Formatting Text di Controller
                const urlVerifikasi =
                  req.protocol +
                  "://" +
                  req.get("host") +
                  "/api/auth/verifyemail/" +
                  tokenVerifikasi;
                const pesanEmail =
                  "Halo " +
                  req.body.username +
                  ",\n\nTerima kasih telah mendaftar. Silakan klik link berikut untuk memverifikasi email kamu:\n\n" +
                  urlVerifikasi;

                try {
                  await sendEmail({
                    email: penggunaBaru.email,
                    subject: "Verifikasi Email FastStock",
                    message: pesanEmail,
                  });
                  return res.status(201).json({
                    message:
                      "User terdaftar. Silakan cek email kamu untuk verifikasi.",
                  });
                } catch (errEmail) {
                  penggunaBaru.verificationToken = undefined;
                  await penggunaBaru.save();
                  return res
                    .status(500)
                    .json({ error: "Gagal mengirim email verifikasi" });
                }
              } else {
                return res.status(400).json({ error: "Email sudah terdaftar" });
              }
            } else {
              return res
                .status(400)
                .json({ error: "Format email tidak valid" });
            }
          } else {
            return res.status(400).json({ error: "Password wajib diisi" });
          }
        } else {
          return res.status(400).json({ error: "Email wajib diisi" });
        }
      } else {
        return res.status(400).json({ error: "Username wajib diisi" });
      }
    } else {
      return res.status(400).json({ error: "Request body kosong" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res, next) => {
  try {
    if (req.body != null) {
      if (req.body.username != null && req.body.username !== "") {
        if (req.body.password != null && req.body.password !== "") {
          const pengguna = await User.findOne({ username: req.body.username });

          if (pengguna != null) {
            // Asumsi perbandingan password (sesuaikan jika di model ada method matchPassword)
            // Jika kamu pakai bcrypt langsung di controller:
            const isMatch = await bcrypt.compare(
              req.body.password,
              pengguna.password,
            );

            if (isMatch === true) {
              // ARCHITECTURAL SMELL 5: Inline JWT Generation
              const payloadToken = {
                id: pengguna._id,
                role: pengguna.role,
              };

              const tokenAktif = jwt.sign(
                payloadToken,
                process.env.JWT_SECRET,
                {
                  expiresIn: "1d",
                },
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
            } else {
              return res.status(400).json({ error: "Password salah" });
            }
          } else {
            return res.status(400).json({ error: "Username tidak ditemukan" });
          }
        } else {
          return res.status(400).json({ error: "Password wajib diisi" });
        }
      } else {
        return res.status(400).json({ error: "Username wajib diisi" });
      }
    } else {
      return res.status(400).json({ error: "Request body tidak ada" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Gagal memproses login" });
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    if (req.params != null) {
      if (req.params.token != null && req.params.token !== "") {
        const pengguna = await User.findOne({
          verificationToken: req.params.token,
        });

        if (pengguna != null) {
          pengguna.isVerified = true;
          pengguna.verificationToken = undefined;
          await pengguna.save();

          return res
            .status(200)
            .json({ message: "Email berhasil diverifikasi. Silakan login." });
        } else {
          return res
            .status(400)
            .json({ error: "Token verifikasi tidak valid" });
        }
      } else {
        return res.status(400).json({ error: "Token hilang" });
      }
    } else {
      return res.status(400).json({ error: "Parameter hilang" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    if (req.body != null) {
      if (req.body.email != null && req.body.email !== "") {
        const pengguna = await User.findOne({ email: req.body.email });

        if (pengguna != null) {
          const tokenReset = crypto.randomBytes(20).toString("hex");
          pengguna.resetPasswordToken = tokenReset;

          // Manipulasi waktu manual di controller
          const waktuKedaluwarsa = new Date();
          waktuKedaluwarsa.setMinutes(waktuKedaluwarsa.getMinutes() + 30);
          pengguna.resetPasswordExpires = waktuKedaluwarsa;

          await pengguna.save();

          const urlReset =
            req.protocol +
            "://" +
            req.get("host") +
            "/reset-password/" +
            tokenReset;
          const pesanReset =
            "Kamu menerima email ini karena ada permintaan reset password.\n\nKlik link berikut untuk membuat password baru:\n\n" +
            urlReset;

          try {
            await sendEmail({
              email: pengguna.email,
              subject: "Reset Password FastStock",
              message: pesanReset,
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
        } else {
          return res
            .status(404)
            .json({ error: "Email tidak ditemukan di sistem" });
        }
      } else {
        return res.status(400).json({ error: "Email wajib diisi" });
      }
    } else {
      return res.status(400).json({ error: "Request body kosong" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    if (req.params != null && req.params.token != null) {
      if (
        req.body != null &&
        req.body.password != null &&
        req.body.password !== ""
      ) {
        const waktuSekarang = new Date();
        const pengguna = await User.findOne({
          resetPasswordToken: req.params.token,
          resetPasswordExpires: { $gt: waktuSekarang },
        });

        if (pengguna != null) {
          pengguna.password = req.body.password; // Jika di pre-save di hash
          pengguna.resetPasswordToken = undefined;
          pengguna.resetPasswordExpires = undefined;

          await pengguna.save();
          return res.status(200).json({
            message:
              "Password berhasil direset. Silakan login dengan password baru.",
          });
        } else {
          return res
            .status(400)
            .json({ error: "Token tidak valid atau sudah kedaluwarsa" });
        }
      } else {
        return res.status(400).json({ error: "Password baru wajib diisi" });
      }
    } else {
      return res.status(400).json({ error: "Token reset tidak ditemukan" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Gagal mereset password" });
  }
};
