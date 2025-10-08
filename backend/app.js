// app.js
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { jsPDF } = require("jspdf");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ==========================================================
   ESTRUCTURA DE DATOS EN MEMORIA
========================================================== */
const sessions = {}; // { codigo_sesion: { presentadorSocketId, espectadores: [], mensajes: [] } }

/* ==========================================================
   MANEJO DE SOCKET.IO
========================================================== */
io.on("connection", (socket) => {
  console.log("nuevo cliente conectado:", socket.id);

  // --- unir a una sala ---
  socket.on("join-session", ({ codigo, rol, nombre }) => {
    if (!sessions[codigo]) {
      sessions[codigo] = {
        presentadorSocketId: null,
        espectadores: [],
        mensajes: [],
      };
    }

    socket.join(codigo);

    if (rol === "presentador") {
      sessions[codigo].presentadorSocketId = socket.id;
      console.log(`presentador unido a la sala ${codigo}`);
    } else {
      sessions[codigo].espectadores.push(socket.id);
      console.log(`espectador unido a la sala ${codigo}`);
    }

    // enviar historial de mensajes al unirse
    socket.emit("chat-history", sessions[codigo].mensajes);
  });

  // --- mensajes del chat ---
  socket.on("nuevo-mensaje", ({ codigo, nombre, mensaje }) => {
    if (!sessions[codigo]) return;
    const msg = { nombre, mensaje, hora: new Date().toLocaleTimeString() };
    sessions[codigo].mensajes.push(msg);

    // enviar mensaje solo a esa sala
    io.to(codigo).emit("mensaje-chat", msg);
  });

  // --- intercambio de señalización webrtc ---
  socket.on("offer", ({ codigo, offer }) => {
    const session = sessions[codigo];
    if (!session) return;
    // enviar la oferta a todos los espectadores
    socket.to(codigo).emit("webrtc-offer", { offer });
  });

  socket.on("answer", ({ codigo, answer }) => {
    const session = sessions[codigo];
    if (!session) return;
    // enviar la respuesta al presentador
    if (session.presentadorSocketId) {
      io.to(session.presentadorSocketId).emit("webrtc-answer", { answer });
    }
  });

  socket.on("candidate", ({ codigo, candidate }) => {
    socket.to(codigo).emit("webrtc-candidate", { candidate });
  });

  // --- desconexión ---
  socket.on("disconnect", () => {
    console.log("cliente desconectado:", socket.id);
    for (const codigo in sessions) {
      const session = sessions[codigo];
      if (session.presentadorSocketId === socket.id) {
        console.log(`presentador salió de la sala ${codigo}`);
        io.to(codigo).emit("presentador-desconectado");
        delete sessions[codigo];
      } else {
        session.espectadores = session.espectadores.filter((id) => id !== socket.id);
      }
    }
  });
});

/* ==========================================================
   ENDPOINT PARA GENERAR PDF DEL CHAT
========================================================== */
app.get("/api/generate-pdf", (req, res) => {
  const codigo = req.query.codigo;
  if (!codigo || !sessions[codigo]) {
    return res.status(400).json({ error: "Código inválido" });
  }

  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`Reporte de Comentarios - Sala ${codigo}`, 10, 10);

  let y = 20;
  sessions[codigo].mensajes.forEach((msg) => {
    doc.setFontSize(12);
    doc.text(`${msg.hora} - ${msg.nombre}: ${msg.mensaje}`, 10, y);
    y += 10;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  });

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=reporte_${codigo}.pdf`);
  res.send(pdfBuffer);
});

/* ==========================================================
   INICIAR SERVIDOR
========================================================== */
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
