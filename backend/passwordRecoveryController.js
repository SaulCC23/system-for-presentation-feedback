import {
  generateTemporaryPassword,
  sendRecoveryEmail,
  saveTemporaryPassword,
} from "./passwordRecoveryService.js";

/* endpoint POST /recover-password - Recibe un email y genera una contraseña temporal. */
export async function recoverPassword(req, res) {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "El correo electrónico es requerido." });
  }

  const tempPassword = generateTemporaryPassword();
  saveTemporaryPassword(email, tempPassword); // se guarda con vencimiento automático
  const sent = await sendRecoveryEmail(email, tempPassword);

  if (!sent) {
    return res.status(500).json({ error: "No se pudo enviar el correo." });
  }

  return res.status(200).json({
    message:
      "Contraseña temporal generada y enviada correctamente al correo (válida por 10 minutos).",
  });
}


