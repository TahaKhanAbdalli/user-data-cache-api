import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';

describe('loadConfig trustProxy', () => {
  it('defaults to loopback when unset', () => {
    expect(loadConfig({}).trustProxy).toBe('loopback');
  });

  it('parses boolean values', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('parses a numeric hop count', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });

  it('passes through a named value', () => {
    expect(loadConfig({ TRUST_PROXY: 'uniquelocal' }).trustProxy).toBe('uniquelocal');
  });
});
