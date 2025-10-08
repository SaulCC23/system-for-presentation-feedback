// Repositorio en memoria para almacenar sesiones activas
class InMemorySessionRepository {
  constructor() {
    this.activeSessions = new Map(); // clave: código, valor: objeto sesión
  }

  isCodeActive(code) {
    return this.activeSessions.has(code);
  }

  add(session) {
    if (this.activeSessions.has(session.code)) {
      throw new Error("El código ya existe en activo.");
    }
    this.activeSessions.set(session.code, session);
  }

  end(code) {
    return this.activeSessions.delete(code);
  }

  getActiveSessions() {
    return Array.from(this.activeSessions.values());
  }
}

module.exports = InMemorySessionRepository;
