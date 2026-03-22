"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthStateMachine = void 0;
class HealthStateMachine {
    config;
    state = 'unknown';
    stateChangedAt = Date.now();
    consecutiveFailures = 0;
    hysteresisCounter = 0;
    pendingState = null;
    constructor(config) {
        this.config = config;
    }
    getState() {
        return this.state;
    }
    getStateChangedAt() {
        return this.stateChangedAt;
    }
    getConsecutiveFailures() {
        return this.consecutiveFailures;
    }
    recordSuccess() {
        this.consecutiveFailures = 0;
    }
    recordFailure() {
        this.consecutiveFailures++;
    }
    evaluate(metrics, now) {
        const stats = metrics.getLatencyStats(now);
        const errorRate = metrics.getErrorRate(now);
        const sampleCount = metrics.getSampleCount(now);
        // Check consecutive failures first -- overrides everything
        if (this.consecutiveFailures >= this.config.unhealthyAfterConsecutiveFailures) {
            return this.tryTransition('unhealthy', `${this.consecutiveFailures} consecutive probe failures`, now);
        }
        // For unknown state, the first sample determines the initial state
        if (this.state === 'unknown') {
            if (sampleCount === 0)
                return null;
            // First sample: determine initial state based on most recent result
            if (errorRate !== undefined && errorRate > 0) {
                return this.tryTransition('unhealthy', 'First probe failed', now);
            }
            return this.tryTransition('healthy', 'First successful probe', now);
        }
        // Need minimum samples before evaluating transitions (except from unknown)
        if (sampleCount < this.config.stateChangeMinSamples) {
            return null;
        }
        const targetState = this.classifyState(stats.p95, errorRate);
        if (targetState === this.state) {
            this.hysteresisCounter = 0;
            this.pendingState = null;
            return null;
        }
        return this.tryTransition(targetState, this.buildReason(targetState, stats.p95, errorRate), now);
    }
    classifyState(p95, errorRate) {
        // Check unhealthy thresholds
        if (errorRate !== undefined && errorRate >= this.config.unhealthyErrorRate) {
            return 'unhealthy';
        }
        // Check degraded thresholds
        if (errorRate !== undefined && errorRate >= this.config.degradedErrorRate) {
            return 'degraded';
        }
        if (p95 !== undefined && p95 >= this.config.degradedLatencyMs) {
            return 'degraded';
        }
        // Check healthy thresholds (asymmetric -- harder to become healthy)
        if (this.state === 'degraded' || this.state === 'unhealthy') {
            const errorOk = errorRate === undefined || errorRate < this.config.healthyErrorRate;
            const latencyOk = p95 === undefined || p95 < this.config.healthyLatencyMs;
            if (errorOk && latencyOk) {
                return 'healthy';
            }
            // Still degraded -- haven't crossed back to healthy thresholds
            return this.state;
        }
        return 'healthy';
    }
    tryTransition(targetState, reason, now) {
        // From unknown, transition immediately (no hysteresis)
        if (this.state === 'unknown') {
            return this.applyTransition(targetState, reason, now);
        }
        // Hysteresis: require consistent signals
        if (this.pendingState === targetState) {
            this.hysteresisCounter++;
        }
        else {
            this.pendingState = targetState;
            this.hysteresisCounter = 1;
        }
        // Consecutive failures bypass hysteresis for unhealthy transition
        if (targetState === 'unhealthy' &&
            this.consecutiveFailures >= this.config.unhealthyAfterConsecutiveFailures) {
            return this.applyTransition(targetState, reason, now);
        }
        if (this.hysteresisCounter >= this.config.stateChangeMinSamples) {
            return this.applyTransition(targetState, reason, now);
        }
        return null;
    }
    applyTransition(targetState, reason, now) {
        this.state = targetState;
        this.stateChangedAt = now ?? Date.now();
        this.hysteresisCounter = 0;
        this.pendingState = null;
        return { newState: targetState, reason };
    }
    buildReason(targetState, p95, errorRate) {
        const parts = [];
        if (targetState === 'unhealthy') {
            if (errorRate !== undefined && errorRate >= this.config.unhealthyErrorRate) {
                parts.push(`error rate ${(errorRate * 100).toFixed(1)}% exceeds unhealthy threshold ${(this.config.unhealthyErrorRate * 100).toFixed(1)}%`);
            }
            if (this.consecutiveFailures >= this.config.unhealthyAfterConsecutiveFailures) {
                parts.push(`${this.consecutiveFailures} consecutive failures`);
            }
        }
        else if (targetState === 'degraded') {
            if (errorRate !== undefined && errorRate >= this.config.degradedErrorRate) {
                parts.push(`error rate ${(errorRate * 100).toFixed(1)}% exceeds degraded threshold ${(this.config.degradedErrorRate * 100).toFixed(1)}%`);
            }
            if (p95 !== undefined && p95 >= this.config.degradedLatencyMs) {
                parts.push(`p95 latency ${p95.toFixed(0)}ms exceeds degraded threshold ${this.config.degradedLatencyMs}ms`);
            }
        }
        else if (targetState === 'healthy') {
            parts.push('error rate and latency within healthy thresholds');
        }
        return parts.length > 0 ? parts.join('; ') : `transitioned to ${targetState}`;
    }
    forceState(state, now) {
        this.state = state;
        this.stateChangedAt = now ?? Date.now();
        this.hysteresisCounter = 0;
        this.pendingState = null;
    }
}
exports.HealthStateMachine = HealthStateMachine;
//# sourceMappingURL=state.js.map