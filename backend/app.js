require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { body, validationResult } = require("express-validator");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Ruta al JSON de comentarios
const commentsFile = path.join(__dirname, "comments.json");

// Pool de conexiones
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "peer_review",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});

// Mapeo de roles del front a id_rol en DB
const roleMap = {
  student: 2,
  professor: 1,
  moderator: 3,
};

// Regla de contraseña
const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

// -------------------- REGISTRO --------------------
app.post(
  "/api/register",
  [
    body("firstName").trim().notEmpty().withMessage("firstName requerido"),
    body("lastName").trim().notEmpty().withMessage("lastName requerido"),
    body("institutionalEmail")
      .isEmail()
      .withMessage("email institucional inválido"),
    body("recoveryEmail")
      .optional()
      .isEmail()
      .withMessage("email de recuperación inválido")
      .custom((value, { req }) => {
        if (value && value === req.body.institutionalEmail) {
          throw new Error(
            "El correo de recuperación no puede ser igual al institucional"
          );
        }
        return true;
      }),
    body("password")
      .matches(passwordRegex)
      .withMessage("Contraseña: min 8 chars, 1 mayúscula y 1 número"),
    body("role")
      .isIn(["student", "professor", "moderator"])
      .withMessage("role inválido"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const {
      firstName,
      lastName,
      institutionalEmail,
      recoveryEmail,
      password,
      role,
    } = req.body;

    const nombre_completo = `${firstName} ${lastName}`;
    const correo = institutionalEmail;
    const id_rol = roleMap[role] || 2;

    try {
      const [existing] = await pool.execute(
        "SELECT id_usuario FROM usuarios WHERE correo = ?",
        [correo]
      );
      if (existing.length)
        return res.status(409).json({ message: "Correo ya registrado" });

      const saltRounds = 10;
      const hashed = await bcrypt.hash(password, saltRounds);

      const sql =
        "INSERT INTO usuarios (nombre_completo, correo, contrasena, id_rol) VALUES (?, ?, ?, ?)";
      const [result] = await pool.execute(sql, [
        nombre_completo,
        correo,
        hashed,
        id_rol,
      ]);

      return res
        .status(201)
        .json({ message: "Usuario creado", userId: result.insertId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error en el servidor" });
    }
  }
);

// -------------------- LOGIN --------------------
app.post(
  "/api/login",
  [
    body("correo").isEmail().withMessage("Correo inválido"),
    body("password").notEmpty().withMessage("Password requerido"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { correo, password } = req.body;

    try {
      const [rows] = await pool.execute(
        "SELECT * FROM usuarios WHERE correo = ?",
        [correo]
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: "Correo no registrado" });
      }

      const user = rows[0];
      const isMatch = await bcrypt.compare(
        password,
        user.contrasena || user["contraseña"]
      );
      if (!isMatch) {
        return res.status(401).json({ message: "Contraseña incorrecta" });
      }

      res.json({
        message: "Login exitoso",
        user: {
          id: user.id_usuario,
          nombre_completo: user.nombre_completo,
          correo: user.correo,
          rol: user.id_rol,
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error en el servidor" });
    }
  }
);

// -------------------- WEBRTC --------------------
app.post("/webrtc-offer", async (req, res) => {
  try {
    const { sdp } = req.body;
    return res.json(sdp);
  } catch (err) {
    console.error("Error en WebRTC:", err);
    return res.status(500).json({ message: "Error en WebRTC" });
  }
});

// -------------------- COMMENTS --------------------
app.post("/api/comments", async (req, res) => {
  const { user, message } = req.body;

  if (!user || !user.id || !user.nombre_completo) {
    return res
      .status(401)
      .json({ message: "Debes iniciar sesión para comentar" });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ message: "El mensaje no puede estar vacío" });
  }

  let comments = [];
  if (fs.existsSync(commentsFile)) {
    const data = fs.readFileSync(commentsFile, "utf-8");
    comments = JSON.parse(data);
  }

  const newComment = {
    id: comments.length + 1,
    user: user.nombre_completo,
    message,
    timestamp: new Date().toISOString(),
  };

  comments.push(newComment);
  fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));

  res.status(201).json(newComment);
});

app.get("/api/comments", (req, res) => {
  if (!fs.existsSync(commentsFile)) {
    return res.json([]);
  }
  const data = fs.readFileSync(commentsFile, "utf-8");
  res.json(JSON.parse(data));
});

// -------------------- GENERAR PDF --------------------
app.get("/api/generate-pdf", (req, res) => {
  try {
    if (!fs.existsSync(commentsFile)) {
      return res
        .status(404)
        .json({ message: "No hay comentarios para generar PDF" });
    }

    const data = fs.readFileSync(commentsFile, "utf-8");
    const comments = JSON.parse(data);

    const doc = new PDFDocument();

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="reporte_comentarios.pdf"'
    );
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    doc
      .fontSize(20)
      .text("Reporte de Comentarios de Usuarios", { align: "center" });
    doc.moveDown();

    comments.forEach((comment, index) => {
      // Eliminamos acentos y emojis para evitar símbolos raros
      const cleanUser = comment.user
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const cleanMsg = comment.message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      doc
        .fontSize(12)
        .fillColor("#007acc")
        .text(
          `Usuario: ${cleanUser} (${new Date(
            comment.timestamp
          ).toLocaleString("es-MX")})`
        )
        .fillColor("black")
        .text(`Mensaje: ${cleanMsg}`, { indent: 20 });

      if (index < comments.length - 1) {
        doc.moveDown(0.5);
        doc
          .strokeColor("#cccccc")
          .lineWidth(1)
          .moveTo(50, doc.y)
          .lineTo(550, doc.y)
          .stroke();
        doc.moveDown(0.5);
      }
    });

    doc.end();
  } catch (error) {
    console.error("Error al generar PDF:", error);
    res.status(500).json({ message: "Error al generar el PDF" });
  }
});

// -------------------- SERVER --------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
