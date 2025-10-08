const Session = require("./Session");

class SessionService {
  constructor(repo, maxAttempts = 1000) {
    this.repo = repo;
    this.maxAttempts = maxAttempts;
  }

  generateCode() {
    let attempts = 0;
    let code;

    do {
      if (++attempts > this.maxAttempts) {
        throw new Error("No se pudo generar un código único.");
      }

      // Número aleatorio de 6 dígitos (000000–999999)
      code = Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, "0");
    } while (this.repo.isCodeActive(code));

    return code;
  }

  createSession() {
    const code = this.generateCode();
    const session = new Session(code);
    this.repo.add(session);
    return session;
  }

  endSession(code) {
    if (!code) return false;
    return this.repo.end(code);
  }

  getActiveSessions() {
    return this.repo.getActiveSessions();
  }

  isCodeInUse(code) {
    if (!code) return false;
    return this.repo.isCodeActive(code);
  }
}

module.exports = SessionService;
