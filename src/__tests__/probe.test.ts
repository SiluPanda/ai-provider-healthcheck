import { describe, it, expect } from 'vitest';
import { classifyError, classifyStatusCode } from '../probe.js';

describe('classifyError', () => {
  it('classifies 429 as transient', () => {
    expect(classifyError({ status: 429 })).toBe('transient');
  });

  it('classifies 502 as transient', () => {
    expect(classifyError({ status: 502 })).toBe('transient');
  });

  it('classifies 503 as transient', () => {
    expect(classifyError({ status: 503 })).toBe('transient');
  });

  it('classifies 504 as transient', () => {
    expect(classifyError({ status: 504 })).toBe('transient');
  });

  it('classifies 401 as permanent', () => {
    expect(classifyError({ status: 401 })).toBe('permanent');
  });

  it('classifies 403 as permanent', () => {
    expect(classifyError({ status: 403 })).toBe('permanent');
  });

  it('classifies 400 as permanent', () => {
    expect(classifyError({ status: 400 })).toBe('permanent');
  });

  it('classifies ETIMEDOUT as transient', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('transient');
  });

  it('classifies ECONNRESET as transient', () => {
    expect(classifyError({ code: 'ECONNRESET' })).toBe('transient');
  });

  it('classifies ECONNREFUSED as transient', () => {
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe('transient');
  });

  it('reads statusCode property', () => {
    expect(classifyError({ statusCode: 503 })).toBe('transient');
  });

  it('reads response.status property', () => {
    expect(classifyError({ response: { status: 429 } })).toBe('transient');
  });

  it('reads response.statusCode property', () => {
    expect(classifyError({ response: { statusCode: 401 } })).toBe('permanent');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyError({ message: 'something broke' })).toBe('unknown');
  });

  it('returns unknown for null', () => {
    expect(classifyError(null)).toBe('unknown');
  });

  it('returns unknown for undefined', () => {
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('classifies network timeout message as transient', () => {
    expect(classifyError({ message: 'Request timed out' })).toBe('transient');
  });

  it('classifies ECONNRESET message as transient', () => {
    expect(classifyError({ message: 'ECONNRESET happened' })).toBe('transient');
  });

  it('classifies 500 as unknown (not in known lists)', () => {
    expect(classifyError({ status: 500 })).toBe('unknown');
  });

  it('prefers status over code', () => {
    // status 401 (permanent) should win over code ETIMEDOUT (transient)
    expect(classifyError({ status: 401, code: 'ETIMEDOUT' })).toBe('permanent');
  });
});

describe('classifyStatusCode', () => {
  it('classifies undefined as unknown', () => {
    expect(classifyStatusCode(undefined)).toBe('unknown');
  });

  it('classifies 429 as transient', () => {
    expect(classifyStatusCode(429)).toBe('transient');
  });

  it('classifies 503 as transient', () => {
    expect(classifyStatusCode(503)).toBe('transient');
  });

  it('classifies 401 as permanent', () => {
    expect(classifyStatusCode(401)).toBe('permanent');
  });

  it('classifies 200 as unknown (success codes)', () => {
    expect(classifyStatusCode(200)).toBe('unknown');
  });
});
