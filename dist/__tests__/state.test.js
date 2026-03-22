"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const state_js_1 = require("../state.js");
const metrics_js_1 = require("../metrics.js");
function makeConfig(overrides = {}) {
    return {
        probeIntervalMs: 30_000,
        probeTimeoutMs: 10_000,
        degradedProbeIntervalMs: 15_000,
        metricsWindowMs: 300_000,
        maxSamplesPerProvider: 1000,
        degradedErrorRate: 0.05,
        unhealthyErrorRate: 0.30,
        healthyErrorRate: 0.02,
        degradedLatencyMs: 5000,
        healthyLatencyMs: 3000,
        unhealthyAfterConsecutiveFailures: 3,
        stateChangeMinSamples: 3,
        latencySpikeMultiplier: 3.0,
        autoStart: false,
        ...overrides,
    };
}
(0, vitest_1.describe)('HealthStateMachine', () => {
    let sm;
    let metrics;
    const config = makeConfig();
    (0, vitest_1.beforeEach)(() => {
        sm = new state_js_1.HealthStateMachine(config);
        metrics = new metrics_js_1.MetricsCollector(1000, 300_000);
    });
    (0, vitest_1.describe)('initial state', () => {
        (0, vitest_1.it)('starts in unknown state', () => {
            (0, vitest_1.expect)(sm.getState()).toBe('unknown');
        });
        (0, vitest_1.it)('starts with 0 consecutive failures', () => {
            (0, vitest_1.expect)(sm.getConsecutiveFailures()).toBe(0);
        });
    });
    (0, vitest_1.describe)('unknown -> healthy', () => {
        (0, vitest_1.it)('transitions to healthy on first successful probe', () => {
            const now = Date.now();
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('healthy');
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
        });
    });
    (0, vitest_1.describe)('unknown -> unhealthy', () => {
        (0, vitest_1.it)('transitions to unhealthy on first failed probe', () => {
            const now = Date.now();
            metrics.record({
                timestamp: now,
                latencyMs: undefined,
                success: false,
                errorClassification: 'transient',
            });
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('unhealthy');
            (0, vitest_1.expect)(sm.getState()).toBe('unhealthy');
        });
    });
    (0, vitest_1.describe)('healthy -> degraded', () => {
        (0, vitest_1.it)('transitions to degraded when error rate exceeds threshold with hysteresis', () => {
            const now = Date.now();
            // First, get to healthy
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
            // Add samples to produce an error rate between degraded (5%) and unhealthy (30%)
            // 80 successes + 10 failures = 10/90 ~ 11% error rate -> degraded but not unhealthy
            for (let i = 0; i < 80; i++) {
                metrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            // First evaluation: hysteresis counter = 1
            let result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).toBeNull();
            // Second evaluation: hysteresis counter = 2
            result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).toBeNull();
            // Third evaluation: hysteresis counter = 3, transition occurs
            result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('degraded');
            (0, vitest_1.expect)(sm.getState()).toBe('degraded');
        });
        (0, vitest_1.it)('transitions to degraded when p95 latency exceeds threshold', () => {
            const now = Date.now();
            // Get to healthy
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            // Add high-latency samples (p95 > 5000ms)
            for (let i = 0; i < 20; i++) {
                metrics.record({ timestamp: now, latencyMs: 6000, success: true });
            }
            // 3 evaluations for hysteresis
            sm.evaluate(metrics, now);
            sm.evaluate(metrics, now);
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('degraded');
        });
    });
    (0, vitest_1.describe)('degraded -> unhealthy', () => {
        (0, vitest_1.it)('transitions to unhealthy when error rate exceeds unhealthy threshold', () => {
            const now = Date.now();
            // Force to degraded state directly
            sm.forceState('degraded', now);
            (0, vitest_1.expect)(sm.getState()).toBe('degraded');
            // Create metrics with error rate > unhealthy threshold (30%)
            // Use a fresh collector: 5 successes + 5 failures = 50% error rate
            const unhealthyMetrics = new metrics_js_1.MetricsCollector(1000, 300_000);
            for (let i = 0; i < 5; i++) {
                unhealthyMetrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            for (let i = 0; i < 5; i++) {
                unhealthyMetrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            // Hysteresis for degraded -> unhealthy
            sm.evaluate(unhealthyMetrics, now);
            sm.evaluate(unhealthyMetrics, now);
            const result = sm.evaluate(unhealthyMetrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('unhealthy');
        });
    });
    (0, vitest_1.describe)('consecutive failures', () => {
        (0, vitest_1.it)('tracks consecutive failures', () => {
            sm.recordFailure();
            (0, vitest_1.expect)(sm.getConsecutiveFailures()).toBe(1);
            sm.recordFailure();
            (0, vitest_1.expect)(sm.getConsecutiveFailures()).toBe(2);
            sm.recordSuccess();
            (0, vitest_1.expect)(sm.getConsecutiveFailures()).toBe(0);
        });
        (0, vitest_1.it)('transitions to unhealthy after consecutive failures bypassing hysteresis', () => {
            const now = Date.now();
            // Get to healthy
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
            // Record consecutive failures
            sm.recordFailure();
            sm.recordFailure();
            sm.recordFailure();
            // Add a sample for evaluation
            metrics.record({
                timestamp: now,
                latencyMs: undefined,
                success: false,
                errorClassification: 'transient',
            });
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('unhealthy');
            (0, vitest_1.expect)(result.reason).toContain('consecutive');
        });
    });
    (0, vitest_1.describe)('recovery: degraded -> healthy', () => {
        (0, vitest_1.it)('transitions back to healthy when metrics improve with hysteresis', () => {
            const now = Date.now();
            // Get to healthy
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            // Force to degraded state
            sm.forceState('degraded', now);
            (0, vitest_1.expect)(sm.getState()).toBe('degraded');
            // Use a fresh collector with only good data
            const freshMetrics = new metrics_js_1.MetricsCollector(1000, 300_000);
            for (let i = 0; i < 10; i++) {
                freshMetrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            // 3 evaluations for hysteresis
            sm.evaluate(freshMetrics, now);
            sm.evaluate(freshMetrics, now);
            const result = sm.evaluate(freshMetrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('healthy');
        });
        (0, vitest_1.it)('requires both error rate and latency within thresholds for recovery', () => {
            const now = Date.now();
            sm.forceState('degraded', now);
            // Low error rate but high latency
            const highLatencyMetrics = new metrics_js_1.MetricsCollector(1000, 300_000);
            for (let i = 0; i < 20; i++) {
                highLatencyMetrics.record({ timestamp: now, latencyMs: 4000, success: true });
            }
            // Latency at 4000 is between healthy (3000) and degraded (5000)
            // From degraded, must drop below healthyLatencyMs (3000) to recover
            sm.evaluate(highLatencyMetrics, now);
            sm.evaluate(highLatencyMetrics, now);
            sm.evaluate(highLatencyMetrics, now);
            // Should NOT recover because p95 is above healthyLatencyMs (3000)
            (0, vitest_1.expect)(sm.getState()).toBe('degraded');
        });
    });
    (0, vitest_1.describe)('recovery: unhealthy -> healthy', () => {
        (0, vitest_1.it)('transitions from unhealthy to healthy with good metrics', () => {
            const now = Date.now();
            sm.forceState('unhealthy', now);
            const goodMetrics = new metrics_js_1.MetricsCollector(1000, 300_000);
            for (let i = 0; i < 10; i++) {
                goodMetrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            // This should go unhealthy -> degraded first, or directly to healthy
            // Since error rate is 0 and latency is low, it should classify as healthy
            sm.evaluate(goodMetrics, now);
            sm.evaluate(goodMetrics, now);
            const result = sm.evaluate(goodMetrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.newState).toBe('healthy');
        });
    });
    (0, vitest_1.describe)('hysteresis', () => {
        (0, vitest_1.it)('resets hysteresis counter when target state changes', () => {
            const now = Date.now();
            // Get to healthy
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            // Trigger degraded evaluation
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            // First eval: hysteresis = 1
            sm.evaluate(metrics, now);
            // Now add many successes to change the error rate back
            const freshMetrics = new metrics_js_1.MetricsCollector(1000, 300_000);
            for (let i = 0; i < 20; i++) {
                freshMetrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            // This should reset hysteresis since target state changed back to healthy
            const result = sm.evaluate(freshMetrics, now);
            (0, vitest_1.expect)(result).toBeNull(); // Still healthy, no transition
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
        });
        (0, vitest_1.it)('does not transition without enough consistent signals', () => {
            const now = Date.now();
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            // Only 1 evaluation with bad data
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            sm.evaluate(metrics, now);
            // State should still be healthy
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
        });
    });
    (0, vitest_1.describe)('stateChangeMinSamples = 1', () => {
        (0, vitest_1.it)('transitions immediately when hysteresis is 1', () => {
            const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
            const fastSm = new state_js_1.HealthStateMachine(fastConfig);
            const now = Date.now();
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            fastSm.evaluate(metrics, now);
            (0, vitest_1.expect)(fastSm.getState()).toBe('healthy');
            // Add failures
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            const result = fastSm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            // With high error rate, should transition
        });
    });
    (0, vitest_1.describe)('forceState', () => {
        (0, vitest_1.it)('sets state directly', () => {
            const now = Date.now();
            sm.forceState('degraded', now);
            (0, vitest_1.expect)(sm.getState()).toBe('degraded');
            (0, vitest_1.expect)(sm.getStateChangedAt()).toBe(now);
        });
        (0, vitest_1.it)('resets hysteresis', () => {
            const now = Date.now();
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            // Start building hysteresis
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            sm.evaluate(metrics, now); // hysteresis = 1
            // Force state resets hysteresis
            sm.forceState('healthy', now);
            (0, vitest_1.expect)(sm.getState()).toBe('healthy');
        });
    });
    (0, vitest_1.describe)('no transition when conditions not met', () => {
        (0, vitest_1.it)('returns null when no data', () => {
            const result = sm.evaluate(metrics);
            (0, vitest_1.expect)(result).toBeNull();
        });
        (0, vitest_1.it)('returns null when state matches current classification', () => {
            const now = Date.now();
            for (let i = 0; i < 10; i++) {
                metrics.record({ timestamp: now, latencyMs: 100, success: true });
            }
            sm.evaluate(metrics, now); // unknown -> healthy
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('reason messages', () => {
        (0, vitest_1.it)('includes error rate in degraded reason', () => {
            const now = Date.now();
            const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
            const fastSm = new state_js_1.HealthStateMachine(fastConfig);
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            fastSm.evaluate(metrics, now);
            // Add failures to exceed degraded threshold
            for (let i = 0; i < 10; i++) {
                metrics.record({
                    timestamp: now,
                    latencyMs: undefined,
                    success: false,
                    errorClassification: 'transient',
                });
            }
            const result = fastSm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.reason).toContain('error rate');
        });
        (0, vitest_1.it)('includes latency in degraded reason', () => {
            const now = Date.now();
            const fastConfig = makeConfig({ stateChangeMinSamples: 1 });
            const fastSm = new state_js_1.HealthStateMachine(fastConfig);
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            fastSm.evaluate(metrics, now);
            // Add high latency samples
            for (let i = 0; i < 20; i++) {
                metrics.record({ timestamp: now, latencyMs: 6000, success: true });
            }
            const result = fastSm.evaluate(metrics, now);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.reason).toContain('p95 latency');
        });
        (0, vitest_1.it)('includes consecutive failures in unhealthy reason', () => {
            const now = Date.now();
            metrics.record({ timestamp: now, latencyMs: 100, success: true });
            sm.evaluate(metrics, now);
            sm.recordFailure();
            sm.recordFailure();
            sm.recordFailure();
            metrics.record({
                timestamp: now,
                latencyMs: undefined,
                success: false,
                errorClassification: 'transient',
            });
            const result = sm.evaluate(metrics, now);
            (0, vitest_1.expect)(result.reason).toContain('consecutive');
        });
    });
});
//# sourceMappingURL=state.test.js.map