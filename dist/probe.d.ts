import type { ProbeResult } from './types.js';
export interface ProbeRequestOptions {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
}
export declare function executeProbe(options: ProbeRequestOptions): Promise<ProbeResult>;
export type ErrorClassification = 'transient' | 'permanent' | 'unknown';
export declare function classifyError(error: unknown): ErrorClassification;
export declare function classifyStatusCode(statusCode: number | undefined): ErrorClassification;
//# sourceMappingURL=probe.d.ts.map