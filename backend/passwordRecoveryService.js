// passwordRecoveryService.js
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
require("dotenv").config();

// Almacenamiento temporal en memoria (clave = userId)
const temporaryPasswords = new Map();

// Conexión a la base de datos
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "peer_review",
});

// Genera una contraseña temporal de 8 caracteres
function generateTemporaryPassword() {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const allChars = uppercase + lowercase + digits;

  let password = "";
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += digits[Math.floor(Math.random() * digits.length)];

  for (let i = password.length; i < 8; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Mezcla los caracteres
  return password
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
}

// Guarda la contraseña temporal para un usuario (válida 10 minutos)
async function saveTemporaryPassword(userId, password) {
  const hashed = await bcrypt.hash(password, 10);
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos

  temporaryPasswords.set(userId, { passwordHash: hashed, expiresAt });
  console.log(`🕒 Contraseña temporal válida hasta: ${new Date(expiresAt).toLocaleTimeString()}`);

  // Guardar la contraseña temporal en la DB para login
  await db.query("UPDATE usuarios SET contrasena = ? WHERE id_usuario = ?", [hashed, userId]);
}

// Verifica si la contraseña temporal sigue siendo válida
function isTemporaryPasswordValid(userId) {
  const entry = temporaryPasswords.get(userId);
  if (!entry) return false;

  const { expiresAt } = entry;
  const stillValid = Date.now() < expiresAt;
  if (!stillValid) temporaryPasswords.delete(userId);
  return stillValid;
}

// Envía la contraseña temporal al correo del usuario
async function sendRecoveryEmail(email, temporaryPassword) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Soporte del Sistema" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Recuperación de contraseña",
      html: `
        <h2>🔐 Recuperación de contraseña</h2>
        <p>Hemos recibido tu solicitud para recuperar tu contraseña.</p>
        <p>Tu <strong>contraseña temporal</strong> es:</p>
        <p style="font-size: 18px; font-weight: bold;">${temporaryPassword}</p>
        <p>Esta contraseña expirará en <b>10 minutos</b>.</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Correo enviado correctamente.");
    return true;
  } catch (error) {
    console.error("❌ Error al enviar el correo:", error);
    return false;
  }
}

module.exports = {
  generateTemporaryPassword,
  saveTemporaryPassword,
  isTemporaryPasswordValid,
  sendRecoveryEmail,
};
