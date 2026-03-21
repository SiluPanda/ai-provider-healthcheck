import type { SampleEntry, LatencyStats, ErrorClassification } from './types.js';

export class MetricsCollector {
  private readonly samples: SampleEntry[] = [];
  private readonly maxSamples: number;
  private readonly windowMs: number;
  private writeIndex = 0;
  private count = 0;

  constructor(maxSamples: number, windowMs: number) {
    this.maxSamples = maxSamples;
    this.windowMs = windowMs;
  }

  record(entry: SampleEntry): void {
    if (this.count < this.maxSamples) {
      this.samples.push(entry);
      this.count++;
    } else {
      this.samples[this.writeIndex] = entry;
    }
    this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
  }

  private getWindowSamples(now?: number): SampleEntry[] {
    const cutoff = (now ?? Date.now()) - this.windowMs;
    const result: SampleEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const sample = this.samples[i];
      if (sample.timestamp >= cutoff) {
        result.push(sample);
      }
    }
    return result;
  }

  getLatencyStats(now?: number): LatencyStats {
    const samples = this.getWindowSamples(now);
    const latencies: number[] = [];
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

    let stddev: number | undefined;
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

  getErrorRate(now?: number): number | undefined {
    const samples = this.getWindowSamples(now);
    if (samples.length === 0) {
      return undefined;
    }

    let errors = 0;
    let total = 0;
    for (const s of samples) {
      total++;
      if (!s.success && s.errorClassification !== 'permanent') {
        errors++;
      }
    }

    return total === 0 ? undefined : errors / total;
  }

  getErrorCounts(now?: number): { transient: number; permanent: number } {
    const samples = this.getWindowSamples(now);
    let transient = 0;
    let permanent = 0;
    for (const s of samples) {
      if (!s.success) {
        if (s.errorClassification === 'permanent') {
          permanent++;
        } else {
          transient++;
        }
      }
    }
    return { transient, permanent };
  }

  getSampleCount(now?: number): number {
    return this.getWindowSamples(now).length;
  }

  clear(): void {
    this.samples.length = 0;
    this.writeIndex = 0;
    this.count = 0;
  }
}
