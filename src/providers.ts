import type { BuiltInProviderId, ProbeResult } from './types.js';
import { executeProbe } from './probe.js';

export interface BuiltInProviderDefinition {
  id: BuiltInProviderId;
  name: string;
  baseUrl: string;
  probePath: string;
  probeMethod: string;
  probeBody?: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
}

export const BUILT_IN_PROVIDERS: Record<BuiltInProviderId, BuiltInProviderDefinition> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    probePath: '/v1/models',
    probeMethod: 'GET',
    buildHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
    }),
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    probePath: '/v1/messages',
    probeMethod: 'POST',
    probeBody: JSON.stringify({
      model: 'claude-haiku-4-20250514',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    }),
    buildHeaders: (apiKey: string) => ({
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }),
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    probePath: '/v1beta/models',
    probeMethod: 'GET',
    buildHeaders: (apiKey: string) => ({
      'x-goog-api-key': apiKey,
    }),
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com',
    probePath: '/v1/models',
    probeMethod: 'GET',
    buildHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
    }),
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai',
    probePath: '/v1/models',
    probeMethod: 'GET',
    buildHeaders: (apiKey: string) => ({
      'Authorization': `Bearer ${apiKey}`,
    }),
  },
};

export function isBuiltInProvider(id: string): id is BuiltInProviderId {
  return id in BUILT_IN_PROVIDERS;
}

export function createBuiltInProbeFn(
  definition: BuiltInProviderDefinition,
  apiKey: string,
  baseUrl?: string,
  timeoutMs: number = 10000
): () => Promise<ProbeResult> {
  const url = (baseUrl ?? definition.baseUrl) + definition.probePath;
  const headers = definition.buildHeaders(apiKey);
  const method = definition.probeMethod;
  const body = definition.probeBody;

  return () =>
    executeProbe({
      url,
      method,
      headers,
      body,
      timeoutMs,
    });
}
