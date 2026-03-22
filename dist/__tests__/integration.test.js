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
const vitest_1 = require("vitest");
const http = __importStar(require("node:http"));
const index_js_1 = require("../index.js");
function createMockServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server, port });
        });
    });
}
function closeServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
    });
}
(0, vitest_1.describe)('Integration Tests', () => {
    const servers = [];
    const monitors = [];
    (0, vitest_1.afterEach)(async () => {
        for (const m of monitors) {
            m.shutdown();
        }
        monitors.length = 0;
        for (const s of servers) {
            await closeServer(s);
        }
        servers.length = 0;
    });
    (0, vitest_1.it)('probes a real HTTP server and reports healthy', async () => {
        const { server, port } = await createMockServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        servers.push(server);
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'local',
                    name: 'Local Server',
                    probeFn: async () => {
                        const start = performance.now();
                        return new Promise((resolve) => {
                            const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
                                const chunks = [];
                                res.on('data', (c) => chunks.push(c));
                                res.on('end', () => {
                                    resolve({
                                        success: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400,
                                        latencyMs: performance.now() - start,
                                        statusCode: res.statusCode ?? 0,
                                    });
                                });
                            });
                            req.on('error', () => {
                                resolve({ success: false, latencyMs: performance.now() - start, statusCode: 0 });
                            });
                        });
                    },
                },
            ],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        const result = await monitor.probe('local');
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.statusCode).toBe(200);
        (0, vitest_1.expect)(result.latencyMs).toBeGreaterThan(0);
        const health = monitor.getHealth('local');
        (0, vitest_1.expect)(health.state).toBe('healthy');
        (0, vitest_1.expect)(health.latency.p50).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('probes a failing HTTP server and reports unhealthy', async () => {
        const { server, port } = await createMockServer((_req, res) => {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Service Unavailable');
        });
        servers.push(server);
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'failing',
                    name: 'Failing Server',
                    probeFn: async () => {
                        const start = performance.now();
                        return new Promise((resolve) => {
                            const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
                                const chunks = [];
                                res.on('data', (c) => chunks.push(c));
                                res.on('end', () => {
                                    const code = res.statusCode ?? 0;
                                    resolve({
                                        success: code >= 200 && code < 400,
                                        latencyMs: performance.now() - start,
                                        statusCode: code,
                                        error: code >= 400 ? `HTTP ${code}` : undefined,
                                    });
                                });
                            });
                            req.on('error', (err) => {
                                resolve({
                                    success: false,
                                    latencyMs: performance.now() - start,
                                    statusCode: 0,
                                    error: err.message,
                                });
                            });
                        });
                    },
                },
            ],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        const result = await monitor.probe('failing');
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.statusCode).toBe(503);
        const health = monitor.getHealth('failing');
        (0, vitest_1.expect)(health.state).toBe('unhealthy');
    });
    (0, vitest_1.it)('emits stateChange events through lifecycle', async () => {
        let shouldFail = false;
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'lifecycle',
                    name: 'Lifecycle',
                    probeFn: async () => {
                        if (shouldFail) {
                            return { success: false, latencyMs: 100, statusCode: 503, error: 'HTTP 503' };
                        }
                        return { success: true, latencyMs: 100, statusCode: 200 };
                    },
                },
            ],
            stateChangeMinSamples: 1,
            degradedErrorRate: 0.05,
            unhealthyErrorRate: 0.30,
        });
        monitors.push(monitor);
        const stateChanges = [];
        monitor.on('stateChange', (e) => stateChanges.push(e));
        // Start healthy
        await monitor.probe('lifecycle');
        (0, vitest_1.expect)(stateChanges.length).toBe(1);
        (0, vitest_1.expect)(stateChanges[0].to).toBe('healthy');
        // Push to degraded with failures
        shouldFail = true;
        for (let i = 0; i < 5; i++) {
            await monitor.probe('lifecycle');
        }
        // Should have transitioned through states
        (0, vitest_1.expect)(stateChanges.length).toBeGreaterThan(1);
        const states = stateChanges.map((e) => e.to);
        (0, vitest_1.expect)(states).toContain('healthy');
    });
    (0, vitest_1.it)('tracks passive success/error reports correctly', () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [{ id: 'passive', name: 'Passive' }],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        // Report successes
        for (let i = 0; i < 10; i++) {
            monitor.reportSuccess('passive', { latencyMs: 100 + i * 10 });
        }
        let health = monitor.getHealth('passive');
        (0, vitest_1.expect)(health.state).toBe('healthy');
        (0, vitest_1.expect)(health.latency.sampleCount).toBe(10);
        (0, vitest_1.expect)(health.latency.min).toBe(100);
        (0, vitest_1.expect)(health.latency.max).toBe(190);
        (0, vitest_1.expect)(health.errorRate).toBe(0);
        // Now report errors to degrade
        for (let i = 0; i < 10; i++) {
            monitor.reportError('passive', { status: 503 });
        }
        health = monitor.getHealth('passive');
        (0, vitest_1.expect)(health.transientErrors).toBe(10);
        (0, vitest_1.expect)(health.errorRate).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('handles mixed probe and passive monitoring', async () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'mixed',
                    name: 'Mixed',
                    probeFn: async () => ({
                        success: true,
                        latencyMs: 200,
                        statusCode: 200,
                    }),
                },
            ],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        // Active probe
        await monitor.probe('mixed');
        // Passive reports
        monitor.reportSuccess('mixed', { latencyMs: 150 });
        monitor.reportSuccess('mixed', { latencyMs: 250 });
        const health = monitor.getHealth('mixed');
        (0, vitest_1.expect)(health.sampleCount).toBe(3);
        (0, vitest_1.expect)(health.state).toBe('healthy');
    });
    (0, vitest_1.it)('creates monitor with multiple providers', async () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'fast',
                    name: 'Fast Provider',
                    probeFn: async () => ({
                        success: true,
                        latencyMs: 50,
                        statusCode: 200,
                    }),
                },
                {
                    id: 'slow',
                    name: 'Slow Provider',
                    probeFn: async () => ({
                        success: true,
                        latencyMs: 3000,
                        statusCode: 200,
                    }),
                },
                {
                    id: 'down',
                    name: 'Down Provider',
                    probeFn: async () => ({
                        success: false,
                        latencyMs: 100,
                        statusCode: 503,
                        error: 'HTTP 503',
                    }),
                },
            ],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        await Promise.all([
            monitor.probe('fast'),
            monitor.probe('slow'),
            monitor.probe('down'),
        ]);
        const all = monitor.getAllHealth();
        (0, vitest_1.expect)(all['fast'].state).toBe('healthy');
        (0, vitest_1.expect)(all['fast'].latency.p50).toBe(50);
        (0, vitest_1.expect)(all['slow'].state).toBe('healthy');
        (0, vitest_1.expect)(all['slow'].latency.p50).toBe(3000);
        (0, vitest_1.expect)(all['down'].state).toBe('unhealthy');
    });
    (0, vitest_1.it)('supports full degradation and recovery cycle', async () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'cycling',
                    name: 'Cycling',
                    probeFn: async () => ({
                        success: true,
                        latencyMs: 100,
                        statusCode: 200,
                    }),
                },
            ],
            stateChangeMinSamples: 1,
            degradedErrorRate: 0.05,
            unhealthyErrorRate: 0.30,
            healthyErrorRate: 0.02,
        });
        monitors.push(monitor);
        const recovered = [];
        monitor.on('recovered', (e) => recovered.push(e));
        // Start healthy with a good baseline
        for (let i = 0; i < 5; i++) {
            await monitor.probe('cycling');
        }
        (0, vitest_1.expect)(monitor.getHealth('cycling').state).toBe('healthy');
        // Add more successes to build baseline
        for (let i = 0; i < 80; i++) {
            monitor.reportSuccess('cycling', { latencyMs: 100 });
        }
        // Degrade with errors (10 errors / 95 total ~ 10.5% -> degraded)
        for (let i = 0; i < 10; i++) {
            monitor.reportError('cycling', { status: 503 });
        }
        // Recover with lots of successes to bring error rate below 2%
        for (let i = 0; i < 500; i++) {
            monitor.reportSuccess('cycling', { latencyMs: 100 });
        }
        const health = monitor.getHealth('cycling');
        (0, vitest_1.expect)(health.state).toBe('healthy');
        (0, vitest_1.expect)(recovered.length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)('latency spike detection with mock data', () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [{ id: 'spike', name: 'Spike Test' }],
            stateChangeMinSamples: 1,
            latencySpikeMultiplier: 2.0,
        });
        monitors.push(monitor);
        const spikes = [];
        monitor.on('latencySpike', (e) => spikes.push(e));
        // Build baseline at 100ms
        for (let i = 0; i < 10; i++) {
            monitor.reportSuccess('spike', { latencyMs: 100 });
        }
        // Report a spike (2x threshold = 200ms, so 300 should trigger)
        monitor.reportSuccess('spike', { latencyMs: 300 });
        (0, vitest_1.expect)(spikes.length).toBe(1);
        (0, vitest_1.expect)(spikes[0].latencyMs).toBe(300);
        (0, vitest_1.expect)(spikes[0].p95Ms).toBeDefined();
    });
    (0, vitest_1.it)('permanent errors do not affect error rate', () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [{ id: 'perm', name: 'Perm Test' }],
            stateChangeMinSamples: 1,
        });
        monitors.push(monitor);
        // Report successes
        for (let i = 0; i < 10; i++) {
            monitor.reportSuccess('perm', { latencyMs: 100 });
        }
        // Report permanent errors (401 - wrong API key)
        for (let i = 0; i < 5; i++) {
            monitor.reportError('perm', { status: 401 });
        }
        const health = monitor.getHealth('perm');
        // Permanent errors don't count in error rate numerator
        (0, vitest_1.expect)(health.errorRate).toBe(0);
        (0, vitest_1.expect)(health.permanentErrors).toBe(5);
        (0, vitest_1.expect)(health.state).toBe('healthy');
    });
    (0, vitest_1.it)('createMonitor exports work correctly', () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'test',
                    name: 'Test',
                    probeFn: async () => ({ success: true, latencyMs: 100, statusCode: 200 }),
                },
            ],
        });
        monitors.push(monitor);
        (0, vitest_1.expect)(typeof monitor.start).toBe('function');
        (0, vitest_1.expect)(typeof monitor.stop).toBe('function');
        (0, vitest_1.expect)(typeof monitor.getHealth).toBe('function');
        (0, vitest_1.expect)(typeof monitor.getAllHealth).toBe('function');
        (0, vitest_1.expect)(typeof monitor.probe).toBe('function');
        (0, vitest_1.expect)(typeof monitor.reportSuccess).toBe('function');
        (0, vitest_1.expect)(typeof monitor.reportError).toBe('function');
        (0, vitest_1.expect)(typeof monitor.shutdown).toBe('function');
        (0, vitest_1.expect)(typeof monitor.on).toBe('function');
        (0, vitest_1.expect)(typeof monitor.off).toBe('function');
        (0, vitest_1.expect)(typeof monitor.removeAllListeners).toBe('function');
    });
    (0, vitest_1.it)('handles degraded event fields correctly', () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [{ id: 'deg', name: 'Degraded Test' }],
            stateChangeMinSamples: 1,
            degradedErrorRate: 0.05,
            unhealthyErrorRate: 0.30,
            unhealthyAfterConsecutiveFailures: 999,
        });
        monitors.push(monitor);
        const degradedEvents = [];
        monitor.on('degraded', (e) => degradedEvents.push(e));
        // Build up healthy baseline
        for (let i = 0; i < 80; i++) {
            monitor.reportSuccess('deg', { latencyMs: 100 });
        }
        // Push to degraded (10 errors / 90 total ~ 11% -> degraded but not unhealthy)
        for (let i = 0; i < 10; i++) {
            monitor.reportError('deg', { status: 503 });
        }
        (0, vitest_1.expect)(degradedEvents.length).toBeGreaterThanOrEqual(1);
        const evt = degradedEvents[0];
        (0, vitest_1.expect)(evt.provider).toBe('deg');
        (0, vitest_1.expect)(evt.timestamp).toBeDefined();
        (0, vitest_1.expect)(typeof evt.reason).toBe('string');
    });
    (0, vitest_1.it)('probe events include all fields', async () => {
        const monitor = (0, index_js_1.createMonitor)({
            providers: [
                {
                    id: 'fields',
                    name: 'Fields',
                    probeFn: async () => ({
                        success: true,
                        latencyMs: 123,
                        ttfbMs: 45,
                        statusCode: 200,
                    }),
                },
            ],
        });
        monitors.push(monitor);
        const probeEvents = [];
        monitor.on('probe', (e) => probeEvents.push(e));
        await monitor.probe('fields');
        (0, vitest_1.expect)(probeEvents).toHaveLength(1);
        (0, vitest_1.expect)(probeEvents[0].success).toBe(true);
        (0, vitest_1.expect)(probeEvents[0].latencyMs).toBe(123);
        (0, vitest_1.expect)(probeEvents[0].ttfbMs).toBe(45);
        (0, vitest_1.expect)(probeEvents[0].statusCode).toBe(200);
        (0, vitest_1.expect)(probeEvents[0].provider).toBe('fields');
        (0, vitest_1.expect)(probeEvents[0].timestamp).toBeDefined();
    });
});
//# sourceMappingURL=integration.test.js.map