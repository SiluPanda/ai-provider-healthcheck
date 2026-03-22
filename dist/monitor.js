"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthMonitorImpl = void 0;
const node_events_1 = require("node:events");
const types_js_1 = require("./types.js");
const metrics_js_1 = require("./metrics.js");
const state_js_1 = require("./state.js");
const probe_js_1 = require("./probe.js");
const providers_js_1 = require("./providers.js");
const DEFAULT_CONFIG = {
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
};
class HealthMonitorImpl extends node_events_1.EventEmitter {
    config;
    providers = new Map();
    running = false;
    isShutdown = false;
    constructor(monitorConfig) {
        super();
        this.config = this.resolveConfig(monitorConfig);
        this.validateConfig(monitorConfig);
        for (const providerConfig of monitorConfig.providers) {
            const resolved = this.resolveProvider(providerConfig);
            const state = {
                provider: resolved,
                metrics: new metrics_js_1.MetricsCollector(this.config.maxSamplesPerProvider, this.config.metricsWindowMs),
                stateMachine: new state_js_1.HealthStateMachine(this.config),
                timer: null,
                lastProbeAt: null,
                lastProbeResult: null,
                lastSuccessAt: null,
                lastErrorAt: null,
            };
            this.providers.set(resolved.id, state);
        }
        if (this.config.autoStart) {
            this.start();
        }
    }
    start() {
        if (this.isShutdown) {
            throw new types_js_1.HealthCheckError('Monitor has been shut down', 'MONITOR_SHUTDOWN');
        }
        if (this.running)
            return;
        this.running = true;
        const providerIds = Array.from(this.providers.keys());
        const staggerMs = this.config.probeIntervalMs / Math.max(providerIds.length, 1);
        providerIds.forEach((id, index) => {
            const state = this.providers.get(id);
            if (!state.provider.probeFn)
                return;
            // Stagger initial probes
            const initialDelay = Math.min(index * staggerMs, 1000);
            const timer = setTimeout(() => {
                if (!this.running)
                    return;
                this.runProbe(id);
                this.scheduleNextProbe(id);
            }, initialDelay);
            if (timer.unref)
                timer.unref();
            state.timer = timer;
        });
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        for (const state of this.providers.values()) {
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
        }
    }
    shutdown() {
        this.stop();
        this.isShutdown = true;
        this.removeAllListeners();
        for (const state of this.providers.values()) {
            state.metrics.clear();
        }
    }
    getHealth(providerId) {
        this.ensureNotShutdown();
        const state = this.getProviderState(providerId);
        return this.buildHealth(state);
    }
    getAllHealth() {
        this.ensureNotShutdown();
        const result = {};
        for (const [id, state] of this.providers) {
            result[id] = this.buildHealth(state);
        }
        return result;
    }
    async probe(providerId) {
        this.ensureNotShutdown();
        const state = this.getProviderState(providerId);
        if (!state.provider.probeFn) {
            throw new types_js_1.HealthCheckError(`Provider '${providerId}' has no probe function configured`, 'PROBE_FAILED');
        }
        return this.runProbe(providerId);
    }
    reportSuccess(providerId, metrics) {
        this.ensureNotShutdown();
        const state = this.getProviderState(providerId);
        const now = Date.now();
        // Check for latency spikes BEFORE recording (compare against existing baseline)
        this.checkLatencySpike(providerId, metrics.latencyMs, now);
        const entry = {
            timestamp: now,
            latencyMs: metrics.latencyMs,
            success: true,
        };
        state.metrics.record(entry);
        state.lastSuccessAt = now;
        state.stateMachine.recordSuccess();
        // Evaluate state
        this.evaluateState(providerId, now);
    }
    reportError(providerId, error) {
        this.ensureNotShutdown();
        const state = this.getProviderState(providerId);
        const now = Date.now();
        const classification = (0, probe_js_1.classifyError)(error);
        const entry = {
            timestamp: now,
            latencyMs: undefined,
            success: false,
            errorClassification: classification,
        };
        state.metrics.record(entry);
        state.lastErrorAt = now;
        // Only count transient/unknown errors for consecutive failures
        if (classification !== 'permanent') {
            state.stateMachine.recordFailure();
        }
        // Evaluate state
        this.evaluateState(providerId, now);
    }
    async runProbe(providerId) {
        const state = this.getProviderState(providerId);
        if (!state.provider.probeFn) {
            throw new types_js_1.HealthCheckError(`Provider '${providerId}' has no probe function`, 'PROBE_FAILED');
        }
        let result;
        try {
            result = await state.provider.probeFn();
        }
        catch (err) {
            result = {
                success: false,
                latencyMs: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }
        // If monitor was stopped during probe, discard
        if (this.isShutdown)
            return result;
        const now = Date.now();
        state.lastProbeAt = now;
        state.lastProbeResult = result;
        // Check for latency spikes BEFORE recording (compare against existing baseline)
        if (result.success) {
            this.checkLatencySpike(providerId, result.latencyMs, now);
        }
        // Record into metrics
        const classification = result.success
            ? undefined
            : (0, probe_js_1.classifyStatusCode)(result.statusCode);
        const entry = {
            timestamp: now,
            latencyMs: result.success ? result.latencyMs : undefined,
            success: result.success,
            errorClassification: classification,
        };
        state.metrics.record(entry);
        if (result.success) {
            state.lastSuccessAt = now;
            state.stateMachine.recordSuccess();
        }
        else {
            state.lastErrorAt = now;
            if (classification !== 'permanent') {
                state.stateMachine.recordFailure();
            }
            // Emit probeConfigError for permanent errors
            if (classification === 'permanent') {
                this.safeEmit('error', {
                    message: `Probe config error for '${providerId}': ${result.error}`,
                    code: 'PROBE_CONFIG_ERROR',
                    provider: providerId,
                });
            }
        }
        // Emit probe event
        this.safeEmit('probe', {
            provider: providerId,
            success: result.success,
            latencyMs: result.latencyMs,
            ttfbMs: result.ttfbMs,
            statusCode: result.statusCode,
            error: result.error,
            timestamp: new Date(now).toISOString(),
        });
        // Evaluate state
        this.evaluateState(providerId, now);
        return result;
    }
    scheduleNextProbe(providerId) {
        if (!this.running)
            return;
        const state = this.providers.get(providerId);
        if (!state || !state.provider.probeFn)
            return;
        const currentState = state.stateMachine.getState();
        const interval = currentState === 'degraded' || currentState === 'unhealthy'
            ? this.config.degradedProbeIntervalMs
            : state.provider.probeIntervalMs;
        const timer = setTimeout(() => {
            if (!this.running)
                return;
            this.runProbe(providerId).catch(() => {
                // Errors handled inside runProbe
            });
            this.scheduleNextProbe(providerId);
        }, interval);
        if (timer.unref)
            timer.unref();
        // Clear old timer before setting new one
        if (state.timer) {
            clearTimeout(state.timer);
        }
        state.timer = timer;
    }
    evaluateState(providerId, now) {
        const state = this.getProviderState(providerId);
        const previousState = state.stateMachine.getState();
        const evaluation = state.stateMachine.evaluate(state.metrics, now);
        if (evaluation) {
            const health = this.buildHealth(state, now);
            // Emit stateChange
            this.safeEmit('stateChange', {
                provider: providerId,
                from: previousState,
                to: evaluation.newState,
                reason: evaluation.reason,
                timestamp: new Date(now).toISOString(),
                health,
            });
            // Emit specific events
            if (evaluation.newState === 'degraded') {
                const stats = state.metrics.getLatencyStats(now);
                this.safeEmit('degraded', {
                    provider: providerId,
                    reason: evaluation.reason,
                    errorRate: state.metrics.getErrorRate(now),
                    p95Ms: stats.p95,
                    timestamp: new Date(now).toISOString(),
                });
            }
            if (evaluation.newState === 'healthy' &&
                (previousState === 'degraded' || previousState === 'unhealthy')) {
                const downtimeMs = now - state.stateMachine.getStateChangedAt();
                this.safeEmit('recovered', {
                    provider: providerId,
                    from: previousState,
                    downtimeMs: Math.max(0, downtimeMs),
                    timestamp: new Date(now).toISOString(),
                });
            }
            // Reschedule probes if interval changes
            if (this.running && state.provider.probeFn) {
                this.scheduleNextProbe(providerId);
            }
        }
    }
    checkLatencySpike(providerId, latencyMs, now) {
        const state = this.getProviderState(providerId);
        const stats = state.metrics.getLatencyStats(now);
        if (stats.p95 === undefined || stats.sampleCount < 5)
            return;
        const threshold = stats.p95 * this.config.latencySpikeMultiplier;
        if (latencyMs > threshold) {
            this.safeEmit('latencySpike', {
                provider: providerId,
                latencyMs,
                p95Ms: stats.p95,
                thresholdMs: threshold,
                timestamp: new Date(now).toISOString(),
            });
        }
    }
    buildHealth(state, now) {
        const currentTime = now ?? Date.now();
        const stats = state.metrics.getLatencyStats(currentTime);
        const errorCounts = state.metrics.getErrorCounts(currentTime);
        const currentState = state.stateMachine.getState();
        const stateChangedAt = state.stateMachine.getStateChangedAt();
        return {
            provider: state.provider.id,
            name: state.provider.name,
            state: currentState,
            stateAge: currentTime - stateChangedAt,
            stateChangedAt: new Date(stateChangedAt).toISOString(),
            latency: stats,
            errorRate: state.metrics.getErrorRate(currentTime),
            sampleCount: state.metrics.getSampleCount(currentTime),
            consecutiveFailures: state.stateMachine.getConsecutiveFailures(),
            lastProbeAt: state.lastProbeAt ? new Date(state.lastProbeAt).toISOString() : null,
            lastProbeResult: state.lastProbeResult,
            lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
            lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : null,
            permanentErrors: errorCounts.permanent,
            transientErrors: errorCounts.transient,
        };
    }
    getProviderState(providerId) {
        const state = this.providers.get(providerId);
        if (!state) {
            throw new types_js_1.HealthCheckError(`Unknown provider: '${providerId}'`, 'UNKNOWN_PROVIDER');
        }
        return state;
    }
    ensureNotShutdown() {
        if (this.isShutdown) {
            throw new types_js_1.HealthCheckError('Monitor has been shut down', 'MONITOR_SHUTDOWN');
        }
    }
    resolveConfig(config) {
        const probeIntervalMs = config.probeIntervalMs ?? DEFAULT_CONFIG.probeIntervalMs;
        return {
            probeIntervalMs,
            probeTimeoutMs: config.probeTimeoutMs ?? DEFAULT_CONFIG.probeTimeoutMs,
            degradedProbeIntervalMs: config.degradedProbeIntervalMs ?? Math.floor(probeIntervalMs / 2),
            metricsWindowMs: config.metricsWindowMs ?? DEFAULT_CONFIG.metricsWindowMs,
            maxSamplesPerProvider: config.maxSamplesPerProvider ?? DEFAULT_CONFIG.maxSamplesPerProvider,
            degradedErrorRate: config.degradedErrorRate ?? DEFAULT_CONFIG.degradedErrorRate,
            unhealthyErrorRate: config.unhealthyErrorRate ?? DEFAULT_CONFIG.unhealthyErrorRate,
            healthyErrorRate: config.healthyErrorRate ?? DEFAULT_CONFIG.healthyErrorRate,
            degradedLatencyMs: config.degradedLatencyMs ?? DEFAULT_CONFIG.degradedLatencyMs,
            healthyLatencyMs: config.healthyLatencyMs ?? DEFAULT_CONFIG.healthyLatencyMs,
            unhealthyAfterConsecutiveFailures: config.unhealthyAfterConsecutiveFailures ??
                DEFAULT_CONFIG.unhealthyAfterConsecutiveFailures,
            stateChangeMinSamples: config.stateChangeMinSamples ?? DEFAULT_CONFIG.stateChangeMinSamples,
            latencySpikeMultiplier: config.latencySpikeMultiplier ?? DEFAULT_CONFIG.latencySpikeMultiplier,
            autoStart: config.autoStart ?? DEFAULT_CONFIG.autoStart,
        };
    }
    validateConfig(config) {
        if (!config.providers || config.providers.length === 0) {
            throw new types_js_1.HealthCheckError('At least one provider is required', 'INVALID_CONFIG');
        }
        const ids = new Set();
        for (const p of config.providers) {
            if (!p.id) {
                throw new types_js_1.HealthCheckError('Provider id is required', 'INVALID_CONFIG');
            }
            if (ids.has(p.id)) {
                throw new types_js_1.HealthCheckError(`Duplicate provider id: '${p.id}'`, 'INVALID_CONFIG');
            }
            ids.add(p.id);
        }
    }
    resolveProvider(config) {
        const probeIntervalMs = config.probeIntervalMs ?? this.config.probeIntervalMs;
        const probeTimeoutMs = config.probeTimeoutMs ?? this.config.probeTimeoutMs;
        if ((0, providers_js_1.isBuiltInProvider)(config.id)) {
            const builtIn = providers_js_1.BUILT_IN_PROVIDERS[config.id];
            const apiKey = config.apiKey;
            const baseUrl = config.baseUrl;
            return {
                id: config.id,
                name: config.name ?? builtIn.name,
                probeFn: config.probeFn ?? (0, providers_js_1.createBuiltInProbeFn)(builtIn, apiKey, baseUrl, probeTimeoutMs),
                probeIntervalMs,
                probeTimeoutMs,
            };
        }
        return {
            id: config.id,
            name: config.name ?? config.id,
            probeFn: config.probeFn,
            probeIntervalMs,
            probeTimeoutMs,
        };
    }
    safeEmit(event, data) {
        try {
            this.emit(event, data);
        }
        catch (err) {
            // Prevent listener errors from crashing the monitor
            if (event !== 'error') {
                try {
                    this.emit('error', {
                        message: `Error in '${event}' listener: ${err instanceof Error ? err.message : String(err)}`,
                        code: 'PROBE_FAILED',
                        cause: err,
                    });
                }
                catch {
                    // Nothing we can do
                }
            }
        }
    }
}
exports.HealthMonitorImpl = HealthMonitorImpl;
//# sourceMappingURL=monitor.js.map