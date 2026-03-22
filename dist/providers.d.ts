import type { BuiltInProviderId, ProbeResult } from './types.js';
export interface BuiltInProviderDefinition {
    id: BuiltInProviderId;
    name: string;
    baseUrl: string;
    probePath: string;
    probeMethod: string;
    probeBody?: string;
    buildHeaders: (apiKey: string) => Record<string, string>;
}
export declare const BUILT_IN_PROVIDERS: Record<BuiltInProviderId, BuiltInProviderDefinition>;
export declare function isBuiltInProvider(id: string): id is BuiltInProviderId;
export declare function createBuiltInProbeFn(definition: BuiltInProviderDefinition, apiKey: string, baseUrl?: string, timeoutMs?: number): () => Promise<ProbeResult>;
//# sourceMappingURL=providers.d.ts.map