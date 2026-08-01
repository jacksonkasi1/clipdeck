// ** import lib
import { describe, expect, it } from 'vitest';

import { hasScheme, looksLikeDomain, normaliseUrl, tryParseScheme } from './url';

describe('url helpers', () => {
  describe('hasScheme', () => {
    it('accepts literal schemes', () => {
      expect(hasScheme('https://example.com')).toBe(true);
      expect(hasScheme('mailto:user@example.com')).toBe(true);
    });

    it('rejects bare domains and protocol-relative paths', () => {
      expect(hasScheme('example.com')).toBe(false);
      expect(hasScheme('//cdn.example.com/x')).toBe(false);
    });
  });

  describe('looksLikeDomain', () => {
    it('accepts dotted domains with paths', () => {
      expect(looksLikeDomain('example.com')).toBe(true);
      expect(looksLikeDomain('sub.example.co.uk/path?x=1')).toBe(true);
    });

    it('accepts IPv4 with port and path', () => {
      expect(looksLikeDomain('192.168.1.1:8080/api')).toBe(true);
    });

    it('accepts localhost with optional port', () => {
      expect(looksLikeDomain('localhost')).toBe(true);
      expect(looksLikeDomain('localhost:3000')).toBe(true);
      expect(looksLikeDomain('localhost:3000/health')).toBe(true);
    });

    it('rejects junk strings', () => {
      expect(looksLikeDomain('hello world')).toBe(false);
      expect(looksLikeDomain('')).toBe(false);
    });
  });

  describe('tryParseScheme', () => {
    it('classifies http(s) and mailto', () => {
      expect(tryParseScheme('https://example.com')).toBe('https');
      expect(tryParseScheme('http://example.com')).toBe('http');
      expect(tryParseScheme('user@example.com')).toBe('mailto');
    });

    it('falls back to https for bare domains', () => {
      expect(tryParseScheme('example.com')).toBe('https');
      expect(tryParseScheme('localhost:3000')).toBe('https');
    });

    it('rejects dangerous schemes', () => {
      expect(tryParseScheme('javascript:alert(1)')).toBeNull();
      expect(tryParseScheme('file:///etc/passwd')).toBeNull();
      expect(tryParseScheme('data:text/plain,hi')).toBeNull();
      expect(tryParseScheme('ftp://example.com/file')).toBeNull();
    });

    it('returns null for nonsense', () => {
      expect(tryParseScheme('hello world')).toBeNull();
      expect(tryParseScheme('')).toBeNull();
    });
  });

  describe('normaliseUrl', () => {
    it('returns the input untouched when already scheme-qualified', () => {
      expect(normaliseUrl('https://example.com/path')).toBe('https://example.com/path');
      expect(normaliseUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    });

    it('prepends https for bare domains', () => {
      expect(normaliseUrl('example.com')).toBe('https://example.com');
      expect(normaliseUrl('localhost:3000')).toBe('http://localhost:3000');
    });

    it('strips a stray mailto prefix before re-prepending', () => {
      expect(normaliseUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    });
  });
});
