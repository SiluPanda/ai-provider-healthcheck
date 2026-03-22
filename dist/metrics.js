"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
class MetricsCollector {
    samples = [];
    maxSamples;
    windowMs;
    writeIndex = 0;
    count = 0;
    constructor(maxSamples, windowMs) {
        this.maxSamples = maxSamples;
        this.windowMs = windowMs;
    }
    record(entry) {
        if (this.count < this.maxSamples) {
            this.samples.push(entry);
            this.count++;
        }
        else {
            this.samples[this.writeIndex] = entry;
        }
        this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
    }
    getWindowSamples(now) {
        const cutoff = (now ?? Date.now()) - this.windowMs;
        const result = [];
        for (let i = 0; i < this.count; i++) {
            const sample = this.samples[i];
            if (sample.timestamp >= cutoff) {
                result.push(sample);
            }
        }
        return result;
    }
    getLatencyStats(now) {
        const samples = this.getWindowSamples(now);
        const latencies = [];
        for (const s of samples) {
            if (s.success && s.latencyMs !== undefined) {
                latencies.push(s.latencyMs);
            }
        }
        if (latencies.length === 0) {
            return {
                p50: undefined,
                p95: undefined,
                p99: undefined,
                mean: undefined,
                min: undefined,
                max: undefined,
                stddev: undefined,
                sampleCount: 0,
            };
        }
        latencies.sort((a, b) => a - b);
        const n = latencies.length;
        const sum = latencies.reduce((acc, v) => acc + v, 0);
        const mean = sum / n;
        let stddev;
        if (n >= 2) {
            const variance = latencies.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
            stddev = Math.sqrt(variance);
        }
        return {
            p50: latencies[Math.floor(n * 0.5)],
            p95: latencies[Math.floor(n * 0.95)],
            p99: latencies[Math.floor(n * 0.99)],
            mean,
            min: latencies[0],
            max: latencies[n - 1],
            stddev,
            sampleCount: n,
        };
    }
    getErrorRate(now) {
        const samples = this.getWindowSamples(now);
        if (samples.length === 0) {
            return undefined;
        }
        let errors = 0;
        let total = 0;
        for (const s of samples) {
            if (s.success || (s.errorClassification !== 'permanent')) {
                total++;
            }
            if (!s.success && s.errorClassification !== 'permanent') {
                errors++;
            }
        }
        return total === 0 ? undefined : errors / total;
    }
    getErrorCounts(now) {
        const samples = this.getWindowSamples(now);
        let transient = 0;
        let permanent = 0;
        for (const s of samples) {
            if (!s.success) {
                if (s.errorClassification === 'permanent') {
                    permanent++;
                }
                else {
                    transient++;
                }
            }
        }
        return { transient, permanent };
    }
    getSampleCount(now) {
        return this.getWindowSamples(now).length;
    }
    clear() {
        this.samples.length = 0;
        this.writeIndex = 0;
        this.count = 0;
    }
}
exports.MetricsCollector = MetricsCollector;
//# sourceMappingURL=metrics.js.map