// utils/sendEmail.js
const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  // Konfigurasi transporter (contoh menggunakan Gmail)
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Gunakan App Password jika pakai Gmail
    },
  });

  const mailOptions = {
    from: "FastStock <noreply@faststock.com>",
    to: options.email,
    subject: options.subject,
    text: options.message,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
