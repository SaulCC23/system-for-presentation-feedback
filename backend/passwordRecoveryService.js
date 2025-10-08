import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// Almacenamiento temporal en memoria (clave = email)
const temporaryPasswords = new Map();


export function generateTemporaryPassword() {
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

  return password
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
}

/* Guarda la contraseña temporal para un usuario (válida 10 min) */
export function saveTemporaryPassword(email, password) {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos
  temporaryPasswords.set(email, { password, expiresAt });
  console.log(`🕒 Contraseña temporal válida hasta: ${new Date(expiresAt).toLocaleTimeString()}`);
}

/* Verifica si la contraseña temporal sigue siendo válida*/
export function isTemporaryPasswordValid(email, password) {
  const entry = temporaryPasswords.get(email);
  if (!entry) return false;

  const { password: stored, expiresAt } = entry;
  const stillValid = stored === password && Date.now() < expiresAt;
  if (!stillValid) {
    temporaryPasswords.delete(email); // Limpia expirados automáticamente
  }
  return stillValid;
}

/* Envía la contraseña temporal al correo del usuario*/
export async function sendRecoveryEmail(email, temporaryPassword) {
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
        <p>Te enviamos la siguiente <strong>contraseña temporal</strong> para que puedas acceder y cambiarla por una nueva y más segura:</p>
        <p style="font-size: 18px; font-weight: bold;">${temporaryPassword}</p>
        <p>Por seguridad, esta contraseña expirará en <b>10 minutos</b>.</p>
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



