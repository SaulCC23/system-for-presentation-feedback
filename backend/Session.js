// Representa una sesión
class Session {
  constructor(code) {
    this.code = code;
    this.isActive = true;
    this.createdAt = new Date().toISOString();
  }
}

module.exports = Session;
