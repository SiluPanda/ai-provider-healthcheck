import { EventEmitter } from 'node:events';
import type { MonitorConfig, ProviderHealth, ProbeResult, SuccessMetrics, HealthMonitor } from './types.js';
export declare class HealthMonitorImpl extends EventEmitter implements HealthMonitor {
    private readonly config;
    private readonly providers;
    private running;
    private isShutdown;
    constructor(monitorConfig: MonitorConfig);
    start(): void;
    stop(): void;
    shutdown(): void;
    getHealth(providerId: string): ProviderHealth;
    getAllHealth(): Record<string, ProviderHealth>;
    probe(providerId: string): Promise<ProbeResult>;
    reportSuccess(providerId: string, metrics: SuccessMetrics): void;
    reportError(providerId: string, error: unknown): void;
    private runProbe;
    private scheduleNextProbe;
    private evaluateState;
    private checkLatencySpike;
    private buildHealth;
    private getProviderState;
    private ensureNotShutdown;
    private resolveConfig;
    private validateConfig;
    private resolveProvider;
    private safeEmit;
}
//# sourceMappingURL=monitor.d.ts.map