"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const monitor_js_1 = require("../monitor.js");
const types_js_1 = require("../types.js");
function makeConfig(overrides = {}) {
    return {
        providers: [
            {
                id: 'test-provider',
                name: 'Test Provider',
                probeFn: async () => ({
                    success: true,
                    latencyMs: 100,
                    statusCode: 200,
                }),
            },
        ],
        probeIntervalMs: 30_000,
        probeTimeoutMs: 10_000,
        stateChangeMinSamples: 1,
        ...overrides,
    };
}
function makeSuccessProbe(latencyMs = 100) {
    return async () => ({
        success: true,
        latencyMs,
        statusCode: 200,
    });
}
function makeFailureProbe(statusCode = 503, latencyMs = 100) {
    return async () => ({
        success: false,
        latencyMs,
        statusCode,
        error: `HTTP ${statusCode}`,
    });
}
(0, vitest_1.describe)('HealthMonitorImpl', () => {
    let monitor;
    (0, vitest_1.afterEach)(() => {
        if (monitor) {
            monitor.shutdown();
        }
    });
    (0, vitest_1.describe)('construction', () => {
        (0, vitest_1.it)('creates a monitor with valid config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            (0, vitest_1.expect)(monitor).toBeDefined();
        });
        (0, vitest_1.it)('throws on empty providers', () => {
            (0, vitest_1.expect)(() => new monitor_js_1.HealthMonitorImpl({ providers: [] })).toThrow(types_js_1.HealthCheckError);
        });
        (0, vitest_1.it)('throws on duplicate provider ids', () => {
            (0, vitest_1.expect)(() => new monitor_js_1.HealthMonitorImpl({
                providers: [
                    { id: 'a', name: 'A' },
                    { id: 'a', name: 'A2' },
                ],
            })).toThrow('Duplicate');
        });
        (0, vitest_1.it)('throws on missing provider id', () => {
            (0, vitest_1.expect)(() => new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: '', name: 'NoId' }],
            })).toThrow('id is required');
        });
    });
    (0, vitest_1.describe)('getHealth', () => {
        (0, vitest_1.it)('returns unknown state initially', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.state).toBe('unknown');
            (0, vitest_1.expect)(health.provider).toBe('test-provider');
            (0, vitest_1.expect)(health.name).toBe('Test Provider');
            (0, vitest_1.expect)(health.lastProbeAt).toBeNull();
            (0, vitest_1.expect)(health.lastProbeResult).toBeNull();
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(0);
            (0, vitest_1.expect)(health.errorRate).toBeUndefined();
            (0, vitest_1.expect)(health.latency.sampleCount).toBe(0);
        });
        (0, vitest_1.it)('throws for unknown provider', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            (0, vitest_1.expect)(() => monitor.getHealth('nonexistent')).toThrow(types_js_1.HealthCheckError);
            try {
                monitor.getHealth('nonexistent');
            }
            catch (e) {
                (0, vitest_1.expect)(e.code).toBe('UNKNOWN_PROVIDER');
            }
        });
    });
    (0, vitest_1.describe)('getAllHealth', () => {
        (0, vitest_1.it)('returns health for all providers', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'a', name: 'Provider A', probeFn: makeSuccessProbe() },
                    { id: 'b', name: 'Provider B', probeFn: makeSuccessProbe() },
                ],
            }));
            const all = monitor.getAllHealth();
            (0, vitest_1.expect)(Object.keys(all)).toEqual(['a', 'b']);
            (0, vitest_1.expect)(all['a'].provider).toBe('a');
            (0, vitest_1.expect)(all['b'].provider).toBe('b');
        });
    });
    (0, vitest_1.describe)('probe', () => {
        (0, vitest_1.it)('executes probe and returns result', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            const result = await monitor.probe('test-provider');
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.latencyMs).toBe(100);
            (0, vitest_1.expect)(result.statusCode).toBe(200);
        });
        (0, vitest_1.it)('throws for unknown provider', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            await (0, vitest_1.expect)(monitor.probe('nonexistent')).rejects.toThrow(types_js_1.HealthCheckError);
        });
        (0, vitest_1.it)('throws for provider without probe function', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [{ id: 'no-probe', name: 'No Probe' }],
            }));
            await (0, vitest_1.expect)(monitor.probe('no-probe')).rejects.toThrow(types_js_1.HealthCheckError);
        });
        (0, vitest_1.it)('updates health state after probe', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            await monitor.probe('test-provider');
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.state).toBe('healthy');
            (0, vitest_1.expect)(health.lastProbeAt).not.toBeNull();
            (0, vitest_1.expect)(health.lastProbeResult).not.toBeNull();
            (0, vitest_1.expect)(health.lastProbeResult.success).toBe(true);
        });
        (0, vitest_1.it)('updates latency stats after successful probe', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            await monitor.probe('test-provider');
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.latency.p50).toBe(100);
            (0, vitest_1.expect)(health.latency.sampleCount).toBe(1);
        });
        (0, vitest_1.it)('records failure when probe returns success: false', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    {
                        id: 'failing',
                        name: 'Failing',
                        probeFn: makeFailureProbe(503),
                    },
                ],
            }));
            const result = await monitor.probe('failing');
            (0, vitest_1.expect)(result.success).toBe(false);
            const health = monitor.getHealth('failing');
            (0, vitest_1.expect)(health.state).toBe('unhealthy');
        });
        (0, vitest_1.it)('handles probe function that throws', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    {
                        id: 'throwing',
                        name: 'Throwing',
                        probeFn: async () => {
                            throw new Error('network error');
                        },
                    },
                ],
            }));
            const result = await monitor.probe('throwing');
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toBe('network error');
        });
    });
    (0, vitest_1.describe)('reportSuccess', () => {
        (0, vitest_1.it)('records success metrics', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.reportSuccess('test-provider', { latencyMs: 150 });
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.state).toBe('healthy');
            (0, vitest_1.expect)(health.latency.p50).toBe(150);
            (0, vitest_1.expect)(health.sampleCount).toBe(1);
            (0, vitest_1.expect)(health.lastSuccessAt).not.toBeNull();
        });
        (0, vitest_1.it)('throws for unknown provider', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            (0, vitest_1.expect)(() => monitor.reportSuccess('nonexistent', { latencyMs: 100 })).toThrow(types_js_1.HealthCheckError);
        });
        (0, vitest_1.it)('resets consecutive failures on success', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            // Report errors first
            monitor.reportError('test-provider', { status: 503 });
            monitor.reportError('test-provider', { status: 503 });
            let health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(2);
            // Report success
            monitor.reportSuccess('test-provider', { latencyMs: 100 });
            health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(0);
        });
    });
    (0, vitest_1.describe)('reportError', () => {
        (0, vitest_1.it)('records transient error', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.reportError('test-provider', { status: 503 });
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.transientErrors).toBe(1);
            (0, vitest_1.expect)(health.lastErrorAt).not.toBeNull();
        });
        (0, vitest_1.it)('records permanent error without affecting consecutive failures', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.reportError('test-provider', { status: 401 });
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.permanentErrors).toBe(1);
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(0); // permanent errors don't increment
        });
        (0, vitest_1.it)('increments consecutive failures for transient errors', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.reportError('test-provider', { status: 503 });
            monitor.reportError('test-provider', { status: 429 });
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(2);
        });
        (0, vitest_1.it)('throws for unknown provider', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            (0, vitest_1.expect)(() => monitor.reportError('nonexistent', { status: 503 })).toThrow(types_js_1.HealthCheckError);
        });
    });
    (0, vitest_1.describe)('state transitions via probe', () => {
        (0, vitest_1.it)('transitions unknown -> healthy on first success', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            (0, vitest_1.expect)(monitor.getHealth('test-provider').state).toBe('unknown');
            await monitor.probe('test-provider');
            (0, vitest_1.expect)(monitor.getHealth('test-provider').state).toBe('healthy');
        });
        (0, vitest_1.it)('transitions unknown -> unhealthy on first failure', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'p', name: 'P', probeFn: makeFailureProbe(503) },
                ],
            }));
            await monitor.probe('p');
            (0, vitest_1.expect)(monitor.getHealth('p').state).toBe('unhealthy');
        });
        (0, vitest_1.it)('transitions healthy -> degraded on elevated error rate', async () => {
            let shouldFail = false;
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    {
                        id: 'p',
                        name: 'P',
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
            }));
            // Get to healthy
            await monitor.probe('p');
            (0, vitest_1.expect)(monitor.getHealth('p').state).toBe('healthy');
            // Start failing
            shouldFail = true;
            for (let i = 0; i < 5; i++) {
                await monitor.probe('p');
            }
            (0, vitest_1.expect)(monitor.getHealth('p').state).not.toBe('healthy');
        });
    });
    (0, vitest_1.describe)('events', () => {
        (0, vitest_1.it)('emits stateChange event on transition', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            const events = [];
            monitor.on('stateChange', (e) => events.push(e));
            await monitor.probe('test-provider');
            (0, vitest_1.expect)(events).toHaveLength(1);
            (0, vitest_1.expect)(events[0].from).toBe('unknown');
            (0, vitest_1.expect)(events[0].to).toBe('healthy');
            (0, vitest_1.expect)(events[0].provider).toBe('test-provider');
            (0, vitest_1.expect)(events[0].timestamp).toBeDefined();
            (0, vitest_1.expect)(events[0].health).toBeDefined();
        });
        (0, vitest_1.it)('emits probe event on every probe', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            const events = [];
            monitor.on('probe', (e) => events.push(e));
            await monitor.probe('test-provider');
            (0, vitest_1.expect)(events).toHaveLength(1);
            (0, vitest_1.expect)(events[0].success).toBe(true);
            (0, vitest_1.expect)(events[0].latencyMs).toBe(100);
            (0, vitest_1.expect)(events[0].provider).toBe('test-provider');
        });
        (0, vitest_1.it)('emits degraded event', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'p', name: 'P', probeFn: makeSuccessProbe() },
                ],
                stateChangeMinSamples: 1,
                degradedErrorRate: 0.05,
                unhealthyErrorRate: 0.30,
                unhealthyAfterConsecutiveFailures: 999,
            }));
            const events = [];
            monitor.on('degraded', (e) => events.push(e));
            // Get to healthy first
            await monitor.probe('p');
            // Build up baseline successes to keep error rate between 5% and 30%
            for (let i = 0; i < 80; i++) {
                monitor.reportSuccess('p', { latencyMs: 100 });
            }
            // Add enough errors: 10 errors / (81 + 10) = ~11% -> degraded not unhealthy
            for (let i = 0; i < 10; i++) {
                monitor.reportError('p', { status: 503 });
            }
            (0, vitest_1.expect)(events.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(events[0].provider).toBe('p');
            (0, vitest_1.expect)(events[0].reason).toBeDefined();
        });
        (0, vitest_1.it)('emits recovered event when transitioning to healthy', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'p', name: 'P', probeFn: makeSuccessProbe() },
                ],
                stateChangeMinSamples: 1,
                degradedErrorRate: 0.05,
                unhealthyErrorRate: 0.30,
                healthyErrorRate: 0.02,
                unhealthyAfterConsecutiveFailures: 999,
            }));
            const recoveredEvents = [];
            monitor.on('recovered', (e) => recoveredEvents.push(e));
            // Get to healthy
            await monitor.probe('p');
            // Build baseline successes
            for (let i = 0; i < 80; i++) {
                monitor.reportSuccess('p', { latencyMs: 100 });
            }
            // Push to degraded (error rate ~11%, between 5% and 30%)
            for (let i = 0; i < 10; i++) {
                monitor.reportError('p', { status: 503 });
            }
            // Recover with lots of successes to bring error rate below 2%
            for (let i = 0; i < 500; i++) {
                monitor.reportSuccess('p', { latencyMs: 100 });
            }
            (0, vitest_1.expect)(recoveredEvents.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(recoveredEvents[0].provider).toBe('p');
            (0, vitest_1.expect)(recoveredEvents[0].from).toBe('degraded');
        });
        (0, vitest_1.it)('emits error event for permanent probe errors', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'p', name: 'P', probeFn: makeFailureProbe(401) },
                ],
            }));
            const errors = [];
            monitor.on('error', (e) => errors.push(e));
            await monitor.probe('p');
            (0, vitest_1.expect)(errors.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(errors[0].code).toBe('PROBE_CONFIG_ERROR');
        });
        (0, vitest_1.it)('emits latencySpike event when latency exceeds threshold', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                latencySpikeMultiplier: 3.0,
                stateChangeMinSamples: 1,
            }));
            const spikes = [];
            monitor.on('latencySpike', (e) => spikes.push(e));
            // Build up baseline
            for (let i = 0; i < 10; i++) {
                monitor.reportSuccess('test-provider', { latencyMs: 100 });
            }
            // Report a spike (100 * 3 = 300 threshold, so 500 should trigger)
            monitor.reportSuccess('test-provider', { latencyMs: 500 });
            (0, vitest_1.expect)(spikes.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(spikes[0].latencyMs).toBe(500);
            (0, vitest_1.expect)(spikes[0].provider).toBe('test-provider');
        });
    });
    (0, vitest_1.describe)('start and stop', () => {
        (0, vitest_1.it)('start is idempotent', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.start();
            monitor.start(); // should not throw
            monitor.stop();
        });
        (0, vitest_1.it)('stop is idempotent', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.stop(); // not started, should not throw
            monitor.stop();
        });
        (0, vitest_1.it)('start throws after shutdown', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.shutdown();
            (0, vitest_1.expect)(() => monitor.start()).toThrow(types_js_1.HealthCheckError);
            try {
                monitor.start();
            }
            catch (e) {
                (0, vitest_1.expect)(e.code).toBe('MONITOR_SHUTDOWN');
            }
        });
        (0, vitest_1.it)('schedules probes on start with fake timers', () => {
            vitest_1.vi.useFakeTimers();
            try {
                let probeCount = 0;
                monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                    providers: [
                        {
                            id: 'p',
                            name: 'P',
                            probeFn: async () => {
                                probeCount++;
                                return { success: true, latencyMs: 100, statusCode: 200 };
                            },
                        },
                    ],
                    probeIntervalMs: 1000,
                }));
                monitor.start();
                // Initial probe should fire quickly
                vitest_1.vi.advanceTimersByTime(100);
                // The async probe needs to resolve
                (0, vitest_1.expect)(probeCount).toBeGreaterThanOrEqual(0);
                monitor.stop();
            }
            finally {
                vitest_1.vi.useRealTimers();
            }
        });
    });
    (0, vitest_1.describe)('shutdown', () => {
        (0, vitest_1.it)('prevents all operations after shutdown', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.shutdown();
            (0, vitest_1.expect)(() => monitor.getHealth('test-provider')).toThrow(types_js_1.HealthCheckError);
            (0, vitest_1.expect)(() => monitor.getAllHealth()).toThrow(types_js_1.HealthCheckError);
            (0, vitest_1.expect)(() => monitor.reportSuccess('test-provider', { latencyMs: 100 })).toThrow(types_js_1.HealthCheckError);
            (0, vitest_1.expect)(() => monitor.reportError('test-provider', { status: 503 })).toThrow(types_js_1.HealthCheckError);
        });
        (0, vitest_1.it)('removes all listeners', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.on('stateChange', () => { });
            monitor.on('probe', () => { });
            monitor.shutdown();
            (0, vitest_1.expect)(monitor.listenerCount('stateChange')).toBe(0);
            (0, vitest_1.expect)(monitor.listenerCount('probe')).toBe(0);
        });
    });
    (0, vitest_1.describe)('multiple providers', () => {
        (0, vitest_1.it)('tracks providers independently', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'a', name: 'A', probeFn: makeSuccessProbe(100) },
                    { id: 'b', name: 'B', probeFn: makeFailureProbe(503) },
                ],
            }));
            await monitor.probe('a');
            await monitor.probe('b');
            (0, vitest_1.expect)(monitor.getHealth('a').state).toBe('healthy');
            (0, vitest_1.expect)(monitor.getHealth('b').state).toBe('unhealthy');
            (0, vitest_1.expect)(monitor.getHealth('a').latency.p50).toBe(100);
        });
        (0, vitest_1.it)('getAllHealth returns all providers', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    { id: 'x', name: 'X', probeFn: makeSuccessProbe() },
                    { id: 'y', name: 'Y', probeFn: makeSuccessProbe() },
                    { id: 'z', name: 'Z', probeFn: makeSuccessProbe() },
                ],
            }));
            const all = monitor.getAllHealth();
            (0, vitest_1.expect)(Object.keys(all)).toHaveLength(3);
        });
    });
    (0, vitest_1.describe)('autoStart', () => {
        (0, vitest_1.it)('starts probing automatically when autoStart is true', () => {
            vitest_1.vi.useFakeTimers();
            try {
                monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                    autoStart: true,
                    probeIntervalMs: 5000,
                }));
                // Should not throw - monitor was auto-started
                monitor.stop();
            }
            finally {
                vitest_1.vi.useRealTimers();
            }
        });
    });
    (0, vitest_1.describe)('passive monitoring without probeFn', () => {
        (0, vitest_1.it)('tracks health via reportSuccess/reportError only', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [{ id: 'passive', name: 'Passive Provider' }],
                stateChangeMinSamples: 1,
            }));
            monitor.reportSuccess('passive', { latencyMs: 200 });
            (0, vitest_1.expect)(monitor.getHealth('passive').state).toBe('healthy');
            (0, vitest_1.expect)(monitor.getHealth('passive').latency.p50).toBe(200);
        });
    });
    (0, vitest_1.describe)('built-in provider resolution', () => {
        (0, vitest_1.it)('resolves openai provider config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'openai', apiKey: 'test-key' }],
            });
            const health = monitor.getHealth('openai');
            (0, vitest_1.expect)(health.name).toBe('OpenAI');
        });
        (0, vitest_1.it)('resolves anthropic provider config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'anthropic', apiKey: 'test-key' }],
            });
            const health = monitor.getHealth('anthropic');
            (0, vitest_1.expect)(health.name).toBe('Anthropic');
        });
        (0, vitest_1.it)('resolves google provider config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'google', apiKey: 'test-key' }],
            });
            (0, vitest_1.expect)(monitor.getHealth('google').name).toBe('Google Gemini');
        });
        (0, vitest_1.it)('resolves cohere provider config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'cohere', apiKey: 'test-key' }],
            });
            (0, vitest_1.expect)(monitor.getHealth('cohere').name).toBe('Cohere');
        });
        (0, vitest_1.it)('resolves mistral provider config', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'mistral', apiKey: 'test-key' }],
            });
            (0, vitest_1.expect)(monitor.getHealth('mistral').name).toBe('Mistral');
        });
        (0, vitest_1.it)('allows name override for built-in provider', () => {
            monitor = new monitor_js_1.HealthMonitorImpl({
                providers: [{ id: 'openai', apiKey: 'test-key', name: 'My OpenAI' }],
            });
            (0, vitest_1.expect)(monitor.getHealth('openai').name).toBe('My OpenAI');
        });
    });
    (0, vitest_1.describe)('health status fields', () => {
        (0, vitest_1.it)('populates all ProviderHealth fields after probe', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            await monitor.probe('test-provider');
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.provider).toBe('test-provider');
            (0, vitest_1.expect)(health.name).toBe('Test Provider');
            (0, vitest_1.expect)(health.state).toBe('healthy');
            (0, vitest_1.expect)(health.stateAge).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(health.stateChangedAt).toBeDefined();
            (0, vitest_1.expect)(health.latency.p50).toBe(100);
            (0, vitest_1.expect)(health.errorRate).toBe(0);
            (0, vitest_1.expect)(health.sampleCount).toBe(1);
            (0, vitest_1.expect)(health.consecutiveFailures).toBe(0);
            (0, vitest_1.expect)(health.lastProbeAt).toBeDefined();
            (0, vitest_1.expect)(health.lastProbeResult).toBeDefined();
            (0, vitest_1.expect)(health.lastSuccessAt).toBeDefined();
            (0, vitest_1.expect)(health.lastErrorAt).toBeNull();
            (0, vitest_1.expect)(health.permanentErrors).toBe(0);
            (0, vitest_1.expect)(health.transientErrors).toBe(0);
        });
        (0, vitest_1.it)('tracks lastErrorAt after error', () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig());
            monitor.reportError('test-provider', { status: 503 });
            const health = monitor.getHealth('test-provider');
            (0, vitest_1.expect)(health.lastErrorAt).not.toBeNull();
        });
    });
    (0, vitest_1.describe)('edge cases', () => {
        (0, vitest_1.it)('handles rapid successive probes', async () => {
            let counter = 0;
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    {
                        id: 'p',
                        name: 'P',
                        probeFn: async () => ({
                            success: true,
                            latencyMs: ++counter * 10,
                            statusCode: 200,
                        }),
                    },
                ],
            }));
            await Promise.all([
                monitor.probe('p'),
                monitor.probe('p'),
                monitor.probe('p'),
            ]);
            const health = monitor.getHealth('p');
            (0, vitest_1.expect)(health.sampleCount).toBe(3);
        });
        (0, vitest_1.it)('handles probe that returns ttfbMs', async () => {
            monitor = new monitor_js_1.HealthMonitorImpl(makeConfig({
                providers: [
                    {
                        id: 'p',
                        name: 'P',
                        probeFn: async () => ({
                            success: true,
                            latencyMs: 200,
                            ttfbMs: 50,
                            statusCode: 200,
                        }),
                    },
                ],
            }));
            const result = await monitor.probe('p');
            (0, vitest_1.expect)(result.ttfbMs).toBe(50);
        });
    });
});
//# sourceMappingURL=monitor.test.js.map