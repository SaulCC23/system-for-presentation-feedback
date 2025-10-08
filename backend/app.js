// ==========================================================
// app.js
// Servidor Node.js con Express, Socket.IO y MySQL + PDFKit
// ==========================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const fs = require("fs");

// ----------------------------------------------------------------
// CONFIGURACIÓN DEL SERVIDOR EXPRESS + SOCKET.IO
// ----------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde carpeta /public
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // raíz opcional

// ----------------------------------------------------------------
// INTEGRACIÓN DEL SERVICIO DE SESIONES
// ----------------------------------------------------------------
const InMemorySessionRepository = require("./InMemorySessionRepository");
const SessionService = require("./SessionService");

const sessionRepo = new InMemorySessionRepository();
const sessionService = new SessionService(sessionRepo);

// ----------------------------------------------------------------
// INTEGRACIÓN DEL SERVICIO DE RECUPERACIÓN DE CONTRASEÑA
// ----------------------------------------------------------------
const {
  generateTemporaryPassword,
  sendRecoveryEmail,
  saveTemporaryPassword,
} = require("./passwordRecoveryService");

// Endpoint POST /recover-password
app.post("/api/recover-password", async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "El correo electrónico es requerido." });
  }

  try {
    const tempPassword = generateTemporaryPassword();
    saveTemporaryPassword(email, tempPassword);

    const sent = await sendRecoveryEmail(email, tempPassword);

    if (!sent) {
      return res.status(500).json({ error: "No se pudo enviar el correo." });
    }

    return res.status(200).json({
      message: "Contraseña temporal generada y enviada correctamente al correo (válida por 10 minutos).",
    });
  } catch (err) {
    console.error("Error en /api/recover-password:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ----------------------------------------------------------------
// CONEXIÓN A MYSQL (XAMPP)
// ----------------------------------------------------------------
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "", // coloca tu contraseña de MySQL si tienes una
  database: "peer_review",
});

// ----------------------------------------------------------------
// LOGIN Y REGISTRO DE USUARIOS
// ----------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) {
    return res.status(400).json({ message: "Correo y contraseña son obligatorios" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM usuarios WHERE correo = ?", [correo]);
    if (rows.length === 0) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.contrasena);
    if (!validPassword) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    const [roles] = await db.query("SELECT nombre_rol FROM roles WHERE id_rol = ?", [user.id_rol]);
    const rolNombre = roles.length > 0 ? roles[0].nombre_rol : "Desconocido";

    res.json({
      user: {
        id: user.id_usuario,
        nombre_completo: user.nombre_completo,
        correo: user.correo,
        rol: user.id_rol,
        rolNombre,
      },
    });
  } catch (err) {
    console.error("Error en /api/login:", err);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

app.post("/api/register", async (req, res) => {
  const { nombre_completo, correo, password, id_rol } = req.body;

  if (!nombre_completo || !correo || !password) {
    return res.status(400).json({ message: "Faltan datos requeridos" });
  }

  try {
    const [existe] = await db.query("SELECT * FROM usuarios WHERE correo = ?", [correo]);
    if (existe.length > 0) {
      return res.status(409).json({ message: "El correo ya está registrado" });
    }

    if (!correo.endsWith("@merida.tecnm.mx")) {
      return res.status(400).json({ message: "El correo debe ser institucional (@merida.tecnm.mx)" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const rolAsignado = id_rol || 2;

    await db.query(
      "INSERT INTO usuarios (nombre_completo, correo, contrasena, id_rol) VALUES (?, ?, ?, ?)",
      [nombre_completo, correo, hashedPassword, rolAsignado]
    );

    res.status(201).json({ message: "Usuario registrado correctamente" });
  } catch (err) {
    console.error("Error en /api/register:", err);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// ----------------------------------------------------------------
// RUTAS DE SESIONES Y CHAT
// ----------------------------------------------------------------
const chatHistory = {}; // { codigo_sesion: [{ nombre, mensaje, hora, id }] }

app.post("/api/sessions", (req, res) => {
  try {
    const newSession = sessionService.createSession();
    chatHistory[newSession.code] = [];
    console.log(`✅ Sesión creada con código: ${newSession.code}`);
    res.status(201).json({ code: newSession.code, createdAt: newSession.createdAt });
  } catch (error) {
    console.error("Error al crear sesión:", error.message);
    res.status(500).json({ message: "Error al generar un código único." });
  }
});

app.get("/api/sessions/:code/status", (req, res) => {
  const code = req.params.code;
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: "El código debe ser un número de 6 dígitos." });
  }
  const inUse = sessionService.isCodeInUse(code);
  res.json({ code, isActive: inUse });
});

// ----------------------------------------------------------------
// GENERAR PDF REAL CON PDFKIT
// ----------------------------------------------------------------
app.get("/api/generate-pdf", (req, res) => {
  const codigo = req.query.codigo;
  const messages = chatHistory[codigo];

  if (!codigo || !messages) {
    return res.status(404).json({ error: "Código de sala no encontrado o sin historial de chat." });
  }

  const reportsDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const fileName = `reporte_chat_${codigo}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));
  doc.pipe(res);

  doc.fontSize(18).text(`Reporte de Chat - Sala ${codigo}`, { align: "center" });
  doc.moveDown();
  doc.fontSize(12);

  messages.forEach((msg) => {
    doc.text(`[${msg.hora}] ${msg.nombre}: ${msg.mensaje}`);
    doc.moveDown(0.5);
  });

  doc.end();
});

// ----------------------------------------------------------------
// SOCKET.IO (Chat + WebRTC + control invitados)
// ----------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("Nuevo cliente conectado:", socket.id);

  socket.on("join-session", ({ codigo, rol, nombre }, callback) => {
    if (!sessionService.isCodeInUse(codigo)) {
      return callback({ success: false, message: "⚠️ Código de sala no activo." });
    }

    socket.join(codigo);
    socket.data.roomCode = codigo;

    socket.data.rol = rol || "invitado";
    socket.data.nombre = nombre || "Invitado";

    console.log(`${socket.data.rol} [${socket.data.nombre}] unido a la sala: ${codigo}`);
    socket.to(codigo).emit("user-joined", { id: socket.id, nombre: socket.data.nombre, rol: socket.data.rol });

    const messages = chatHistory[codigo] || [];
    socket.emit("chat-history", messages);

    callback({ success: true, message: `✅ Unido a la sala ${codigo} como ${socket.data.rol}.` });
  });

  socket.on("nuevo-mensaje", ({ codigo, nombre, mensaje }) => {
    if (!sessionService.isCodeInUse(codigo) || !chatHistory[codigo]) return;

    if (socket.data.rol === "invitado") {
      socket.emit("mensaje-error", { message: "Invitados no pueden enviar mensajes." });
      return;
    }

    const msg = { nombre, mensaje, hora: new Date().toLocaleTimeString(), id: socket.id };
    chatHistory[codigo].push(msg);
    io.to(codigo).emit("mensaje-chat", msg);
  });

  socket.on("signal", ({ codigo, to, signal }) => {
    if (!sessionService.isCodeInUse(codigo) || !to || !signal) return;
    io.to(to).emit("signal", { from: socket.id, signal });
  });

  socket.on("disconnect", () => {
    const codigo = socket.data.roomCode;
    const rol = socket.data.rol;
    const nombre = socket.data.nombre;
    if (!codigo) return;

    if (rol === "presentador") {
      console.log(`🚨 Presentador [${nombre}] salió de la sala ${codigo}. Finalizando sesión.`);
      const ended = sessionService.endSession(codigo);
      if (ended) {
        delete chatHistory[codigo];
        io.to(codigo).emit("session-ended", { reason: "El presentador se desconectó." });
      }
    } else {
      console.log(`Usuario [${nombre}] salió de la sala ${codigo}.`);
      socket.to(codigo).emit("user-left", { id: socket.id, nombre, rol });
    }
  });
});

// ----------------------------------------------------------------
// INICIAR SERVIDOR
// ----------------------------------------------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});