import type { SampleEntry, LatencyStats } from './types.js';
export declare class MetricsCollector {
    private readonly samples;
    private readonly maxSamples;
    private readonly windowMs;
    private writeIndex;
    private count;
    constructor(maxSamples: number, windowMs: number);
    record(entry: SampleEntry): void;
    private getWindowSamples;
    getLatencyStats(now?: number): LatencyStats;
    getErrorRate(now?: number): number | undefined;
    getErrorCounts(now?: number): {
        transient: number;
        permanent: number;
    };
    getSampleCount(now?: number): number;
    clear(): void;
}
//# sourceMappingURL=metrics.d.ts.map