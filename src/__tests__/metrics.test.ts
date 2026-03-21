import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import type { SampleEntry } from '../types.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  const WINDOW_MS = 60_000;
  const MAX_SAMPLES = 100;

  beforeEach(() => {
    collector = new MetricsCollector(MAX_SAMPLES, WINDOW_MS);
  });

  describe('record and getLatencyStats', () => {
    it('returns empty stats when no data', () => {
      const stats = collector.getLatencyStats();
      expect(stats.p50).toBeUndefined();
      expect(stats.p95).toBeUndefined();
      expect(stats.p99).toBeUndefined();
      expect(stats.mean).toBeUndefined();
      expect(stats.min).toBeUndefined();
      expect(stats.max).toBeUndefined();
      expect(stats.stddev).toBeUndefined();
      expect(stats.sampleCount).toBe(0);
    });

    it('computes stats for a single sample', () => {
      collector.record({
        timestamp: Date.now(),
        latencyMs: 100,
        success: true,
      });
      const stats = collector.getLatencyStats();
      expect(stats.p50).toBe(100);
      expect(stats.p95).toBe(100);
      expect(stats.p99).toBe(100);
      expect(stats.mean).toBe(100);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(100);
      expect(stats.stddev).toBeUndefined(); // need >= 2 samples
      expect(stats.sampleCount).toBe(1);
    });

    it('computes correct percentiles for multiple samples', () => {
      const now = Date.now();
      // Add 100 samples with latencies 1..100
      for (let i = 1; i <= 100; i++) {
        collector.record({
          timestamp: now,
          latencyMs: i,
          success: true,
        });
      }
      const stats = collector.getLatencyStats(now);
      expect(stats.sampleCount).toBe(100);
      expect(stats.p50).toBe(51); // floor(100 * 0.5) = 50, so index 50 => value 51
      expect(stats.p95).toBe(96); // floor(100 * 0.95) = 95, so index 95 => value 96
      expect(stats.p99).toBe(100); // floor(100 * 0.99) = 99, so index 99 => value 100
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.mean).toBeCloseTo(50.5, 1);
    });

    it('computes standard deviation', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 10, success: true });
      collector.record({ timestamp: now, latencyMs: 20, success: true });
      collector.record({ timestamp: now, latencyMs: 30, success: true });
      const stats = collector.getLatencyStats(now);
      expect(stats.stddev).toBeDefined();
      expect(stats.stddev).toBeCloseTo(10, 0);
    });

    it('excludes failed samples from latency stats', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({ timestamp: now, latencyMs: undefined, success: false });
      collector.record({ timestamp: now, latencyMs: 200, success: true });
      const stats = collector.getLatencyStats(now);
      expect(stats.sampleCount).toBe(2);
      expect(stats.mean).toBe(150);
    });

    it('respects sliding window', () => {
      const now = Date.now();
      // Old sample outside window
      collector.record({
        timestamp: now - WINDOW_MS - 1000,
        latencyMs: 9999,
        success: true,
      });
      // Recent sample inside window
      collector.record({
        timestamp: now,
        latencyMs: 100,
        success: true,
      });
      const stats = collector.getLatencyStats(now);
      expect(stats.sampleCount).toBe(1);
      expect(stats.mean).toBe(100);
    });

    it('handles all samples outside window', () => {
      const now = Date.now();
      collector.record({
        timestamp: now - WINDOW_MS - 1000,
        latencyMs: 100,
        success: true,
      });
      const stats = collector.getLatencyStats(now);
      expect(stats.sampleCount).toBe(0);
      expect(stats.p50).toBeUndefined();
    });
  });

  describe('ring buffer overflow', () => {
    it('evicts oldest entries when max samples exceeded', () => {
      const smallCollector = new MetricsCollector(5, WINDOW_MS);
      const now = Date.now();
      for (let i = 1; i <= 10; i++) {
        smallCollector.record({
          timestamp: now,
          latencyMs: i * 10,
          success: true,
        });
      }
      const stats = smallCollector.getLatencyStats(now);
      // Should only have last 5 entries: 60, 70, 80, 90, 100
      expect(stats.sampleCount).toBe(5);
      expect(stats.min).toBe(60);
      expect(stats.max).toBe(100);
    });
  });

  describe('getErrorRate', () => {
    it('returns undefined when no data', () => {
      expect(collector.getErrorRate()).toBeUndefined();
    });

    it('returns 0 when all samples succeed', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({ timestamp: now, latencyMs: 200, success: true });
      expect(collector.getErrorRate(now)).toBe(0);
    });

    it('returns 1 when all samples fail (transient)', () => {
      const now = Date.now();
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      expect(collector.getErrorRate(now)).toBe(1);
    });

    it('excludes permanent errors from error rate numerator', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'permanent',
      });
      // 1 success + 1 permanent error = 0 transient errors / 2 total = 0
      expect(collector.getErrorRate(now)).toBe(0);
    });

    it('computes correct error rate with mixed results', () => {
      const now = Date.now();
      // 7 successes, 3 transient failures
      for (let i = 0; i < 7; i++) {
        collector.record({ timestamp: now, latencyMs: 100, success: true });
      }
      for (let i = 0; i < 3; i++) {
        collector.record({
          timestamp: now,
          latencyMs: undefined,
          success: false,
          errorClassification: 'transient',
        });
      }
      expect(collector.getErrorRate(now)).toBeCloseTo(0.3, 5);
    });

    it('respects sliding window for error rate', () => {
      const now = Date.now();
      // Old failure outside window
      collector.record({
        timestamp: now - WINDOW_MS - 1000,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      // Recent success inside window
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      expect(collector.getErrorRate(now)).toBe(0);
    });
  });

  describe('getErrorCounts', () => {
    it('returns zero counts when no data', () => {
      const counts = collector.getErrorCounts();
      expect(counts.transient).toBe(0);
      expect(counts.permanent).toBe(0);
    });

    it('counts transient and permanent errors separately', () => {
      const now = Date.now();
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'transient',
      });
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'permanent',
      });
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      const counts = collector.getErrorCounts(now);
      expect(counts.transient).toBe(2);
      expect(counts.permanent).toBe(1);
    });
  });

  describe('getSampleCount', () => {
    it('returns 0 when no data', () => {
      expect(collector.getSampleCount()).toBe(0);
    });

    it('counts all samples in window', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({ timestamp: now, latencyMs: undefined, success: false });
      expect(collector.getSampleCount(now)).toBe(2);
    });

    it('excludes samples outside window', () => {
      const now = Date.now();
      collector.record({ timestamp: now - WINDOW_MS - 1, latencyMs: 100, success: true });
      collector.record({ timestamp: now, latencyMs: 200, success: true });
      expect(collector.getSampleCount(now)).toBe(1);
    });
  });

  describe('clear', () => {
    it('resets all data', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({ timestamp: now, latencyMs: undefined, success: false });
      collector.clear();
      expect(collector.getSampleCount()).toBe(0);
      expect(collector.getErrorRate()).toBeUndefined();
      expect(collector.getLatencyStats().sampleCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles samples with latencyMs 0', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 0, success: true });
      const stats = collector.getLatencyStats(now);
      expect(stats.p50).toBe(0);
      expect(stats.mean).toBe(0);
      expect(stats.min).toBe(0);
    });

    it('handles very large latency values', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 1_000_000, success: true });
      const stats = collector.getLatencyStats(now);
      expect(stats.p50).toBe(1_000_000);
    });

    it('handles mixed success and failure with error classification unknown', () => {
      const now = Date.now();
      collector.record({ timestamp: now, latencyMs: 100, success: true });
      collector.record({
        timestamp: now,
        latencyMs: undefined,
        success: false,
        errorClassification: 'unknown',
      });
      // 'unknown' errors count as transient in error rate
      expect(collector.getErrorRate(now)).toBe(0.5);
    });
  });
});
