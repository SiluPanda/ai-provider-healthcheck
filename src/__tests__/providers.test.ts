import { describe, it, expect } from 'vitest';
import { BUILT_IN_PROVIDERS, isBuiltInProvider, createBuiltInProbeFn } from '../providers.js';

describe('providers', () => {
  describe('BUILT_IN_PROVIDERS', () => {
    it('has 5 built-in providers', () => {
      expect(Object.keys(BUILT_IN_PROVIDERS)).toHaveLength(5);
    });

    it('has openai config', () => {
      const p = BUILT_IN_PROVIDERS.openai;
      expect(p.id).toBe('openai');
      expect(p.name).toBe('OpenAI');
      expect(p.baseUrl).toBe('https://api.openai.com');
      expect(p.probePath).toBe('/v1/models');
      expect(p.probeMethod).toBe('GET');
    });

    it('has anthropic config', () => {
      const p = BUILT_IN_PROVIDERS.anthropic;
      expect(p.id).toBe('anthropic');
      expect(p.name).toBe('Anthropic');
      expect(p.baseUrl).toBe('https://api.anthropic.com');
      expect(p.probePath).toBe('/v1/messages');
      expect(p.probeMethod).toBe('POST');
      expect(p.probeBody).toBeDefined();
    });

    it('has google config', () => {
      const p = BUILT_IN_PROVIDERS.google;
      expect(p.id).toBe('google');
      expect(p.name).toBe('Google Gemini');
      expect(p.baseUrl).toBe('https://generativelanguage.googleapis.com');
      expect(p.probePath).toBe('/v1beta/models');
    });

    it('has cohere config', () => {
      const p = BUILT_IN_PROVIDERS.cohere;
      expect(p.id).toBe('cohere');
      expect(p.name).toBe('Cohere');
      expect(p.baseUrl).toBe('https://api.cohere.com');
      expect(p.probePath).toBe('/v1/models');
    });

    it('has mistral config', () => {
      const p = BUILT_IN_PROVIDERS.mistral;
      expect(p.id).toBe('mistral');
      expect(p.name).toBe('Mistral');
      expect(p.baseUrl).toBe('https://api.mistral.ai');
      expect(p.probePath).toBe('/v1/models');
    });
  });

  describe('isBuiltInProvider', () => {
    it('returns true for built-in providers', () => {
      expect(isBuiltInProvider('openai')).toBe(true);
      expect(isBuiltInProvider('anthropic')).toBe(true);
      expect(isBuiltInProvider('google')).toBe(true);
      expect(isBuiltInProvider('cohere')).toBe(true);
      expect(isBuiltInProvider('mistral')).toBe(true);
    });

    it('returns false for custom providers', () => {
      expect(isBuiltInProvider('my-custom')).toBe(false);
      expect(isBuiltInProvider('azure-openai')).toBe(false);
      expect(isBuiltInProvider('')).toBe(false);
    });
  });

  describe('buildHeaders', () => {
    it('builds openai auth header', () => {
      const headers = BUILT_IN_PROVIDERS.openai.buildHeaders('sk-test');
      expect(headers['Authorization']).toBe('Bearer sk-test');
    });

    it('builds anthropic auth header', () => {
      const headers = BUILT_IN_PROVIDERS.anthropic.buildHeaders('sk-ant-test');
      expect(headers['x-api-key']).toBe('sk-ant-test');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('builds google auth header', () => {
      const headers = BUILT_IN_PROVIDERS.google.buildHeaders('goog-key');
      expect(headers['x-goog-api-key']).toBe('goog-key');
    });

    it('builds cohere auth header', () => {
      const headers = BUILT_IN_PROVIDERS.cohere.buildHeaders('co-key');
      expect(headers['Authorization']).toBe('Bearer co-key');
    });

    it('builds mistral auth header', () => {
      const headers = BUILT_IN_PROVIDERS.mistral.buildHeaders('mis-key');
      expect(headers['Authorization']).toBe('Bearer mis-key');
    });
  });

  describe('createBuiltInProbeFn', () => {
    it('returns a function', () => {
      const fn = createBuiltInProbeFn(BUILT_IN_PROVIDERS.openai, 'test-key');
      expect(typeof fn).toBe('function');
    });

    it('uses custom baseUrl when provided', () => {
      const fn = createBuiltInProbeFn(
        BUILT_IN_PROVIDERS.openai,
        'test-key',
        'https://custom-proxy.com'
      );
      expect(typeof fn).toBe('function');
    });
  });

  describe('anthropic probe body', () => {
    it('contains expected fields', () => {
      const body = JSON.parse(BUILT_IN_PROVIDERS.anthropic.probeBody!);
      expect(body.model).toBe('claude-haiku-4-20250514');
      expect(body.max_tokens).toBe(1);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.messages[0].content).toBe('.');
    });
  });
});
