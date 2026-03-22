"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthCheckError = void 0;
class HealthCheckError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'HealthCheckError';
        this.code = code;
    }
}
exports.HealthCheckError = HealthCheckError;
//# sourceMappingURL=types.js.map