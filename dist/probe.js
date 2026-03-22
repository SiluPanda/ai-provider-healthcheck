"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeProbe = executeProbe;
exports.classifyError = classifyError;
exports.classifyStatusCode = classifyStatusCode;
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
function executeProbe(options) {
    return new Promise((resolve) => {
        const start = performance.now();
        const parsed = new URL(options.url);
        const isHttps = parsed.protocol === 'https:';
        const transport = isHttps ? https : http;
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, options.timeoutMs);
        // Don't let the timeout prevent process exit
        if (timeout.unref) {
            timeout.unref();
        }
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: options.method,
            headers: options.headers,
            signal: controller.signal,
        };
        let ttfbMs;
        const req = transport.request(reqOptions, (res) => {
            ttfbMs = performance.now() - start;
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                clearTimeout(timeout);
                const latencyMs = performance.now() - start;
                const statusCode = res.statusCode ?? 0;
                const success = statusCode >= 200 && statusCode < 400;
                resolve({
                    success,
                    latencyMs,
                    ttfbMs,
                    statusCode,
                    error: success ? undefined : `HTTP ${statusCode}`,
                });
            });
        });
        req.on('error', (err) => {
            clearTimeout(timeout);
            const latencyMs = performance.now() - start;
            if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
                resolve({
                    success: false,
                    latencyMs,
                    ttfbMs,
                    error: 'PROBE_TIMEOUT',
                });
                return;
            }
            resolve({
                success: false,
                latencyMs,
                ttfbMs,
                error: err.code || err.message,
            });
        });
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}
function classifyError(error) {
    const status = extractStatusCode(error);
    if (status !== undefined) {
        if (status === 429 || status === 502 || status === 503 || status === 504)
            return 'transient';
        if (status === 401 || status === 403 || status === 400)
            return 'permanent';
    }
    if (isNetworkError(error))
        return 'transient';
    return 'unknown';
}
function classifyStatusCode(statusCode) {
    if (statusCode === undefined)
        return 'unknown';
    if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504)
        return 'transient';
    if (statusCode === 401 || statusCode === 403 || statusCode === 400)
        return 'permanent';
    return 'unknown';
}
function extractStatusCode(error) {
    if (error === null || error === undefined)
        return undefined;
    if (typeof error === 'number')
        return error;
    const obj = error;
    if (typeof obj.status === 'number')
        return obj.status;
    if (typeof obj.statusCode === 'number')
        return obj.statusCode;
    const response = obj.response;
    if (response) {
        if (typeof response.status === 'number')
            return response.status;
        if (typeof response.statusCode === 'number')
            return response.statusCode;
    }
    return undefined;
}
function isNetworkError(error) {
    if (error === null || error === undefined)
        return false;
    const obj = error;
    const code = obj.code;
    if (typeof code === 'string') {
        return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE'].includes(code);
    }
    const message = obj.message;
    if (typeof message === 'string') {
        return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|timed?\s*out/i.test(message);
    }
    return false;
}
//# sourceMappingURL=probe.js.map