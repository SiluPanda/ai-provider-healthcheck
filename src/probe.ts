import * as http from 'node:http';
import * as https from 'node:https';
import type { ProbeResult } from './types.js';

export interface ProbeRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export function executeProbe(options: ProbeRequestOptions): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const parsed = new URL(options.url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs);
    // Don't let the timeout prevent process exit
    if (timeout.unref) {
      timeout.unref();
    }

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
      signal: controller.signal,
    };

    let ttfbMs: number | undefined;

    const req = transport.request(reqOptions, (res) => {
      ttfbMs = performance.now() - start;
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        clearTimeout(timeout);
        const latencyMs = performance.now() - start;
        const statusCode = res.statusCode ?? 0;
        const success = statusCode >= 200 && statusCode < 400;

        resolve({
          success,
          latencyMs,
          ttfbMs,
          statusCode,
          error: success ? undefined : `HTTP ${statusCode}`,
        });
      });
    });

    req.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timeout);
      const latencyMs = performance.now() - start;

      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        resolve({
          success: false,
          latencyMs,
          ttfbMs,
          error: 'PROBE_TIMEOUT',
        });
        return;
      }

      resolve({
        success: false,
        latencyMs,
        ttfbMs,
        error: err.code || err.message,
      });
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export type ErrorClassification = 'transient' | 'permanent' | 'unknown';

export function classifyError(error: unknown): ErrorClassification {
  const status = extractStatusCode(error);
  if (status !== undefined) {
    if (status === 429 || status === 502 || status === 503 || status === 504) return 'transient';
    if (status === 401 || status === 403 || status === 400) return 'permanent';
  }

  if (isNetworkError(error)) return 'transient';

  return 'unknown';
}

export function classifyStatusCode(statusCode: number | undefined): ErrorClassification {
  if (statusCode === undefined) return 'unknown';
  if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) return 'transient';
  if (statusCode === 401 || statusCode === 403 || statusCode === 400) return 'permanent';
  return 'unknown';
}

function extractStatusCode(error: unknown): number | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error === 'number') return error;

  const obj = error as Record<string, unknown>;
  if (typeof obj.status === 'number') return obj.status;
  if (typeof obj.statusCode === 'number') return obj.statusCode;

  const response = obj.response as Record<string, unknown> | undefined;
  if (response) {
    if (typeof response.status === 'number') return response.status;
    if (typeof response.statusCode === 'number') return response.statusCode;
  }

  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const obj = error as Record<string, unknown>;
  const code = obj.code;
  if (typeof code === 'string') {
    return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE'].includes(code);
  }
  const message = obj.message;
  if (typeof message === 'string') {
    return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|timed?\s*out/i.test(message);
  }
  return false;
}
