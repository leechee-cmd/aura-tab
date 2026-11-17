/**
 * The shared text helpers: HTML escaping and quick-link URL validation.
 *
 * Both files used to be their own suite for four assertions in total, each paying a full
 * jsdom environment to call two pure functions.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/shared/escape-html.test.js
 *   tests/shared/text-quicklink-url.test.js
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, isValidQuicklinkUrl } from '../../scripts/shared/text.js';

describe('escapeHtml', () => {
    it('escapes characters unsafe in HTML text and attributes', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
            '&lt;img src=x onerror=alert(1)&gt;'
        );
        expect(escapeHtml('a&b')).toBe('a&amp;b');
        expect(escapeHtml(`"'`)).toBe('&quot;&#039;');
    });

    it('returns empty string for falsy input', () => {
        expect(escapeHtml('')).toBe('');
        expect(escapeHtml(null)).toBe('');
    });
});

describe('isValidQuicklinkUrl', () => {
    it('accepts normalized https hostnames', () => {
        expect(isValidQuicklinkUrl('example.com')).toBe(true);
        expect(isValidQuicklinkUrl('https://example.com/path')).toBe(true);
    });

    it('rejects empty and non-URLs', () => {
        expect(isValidQuicklinkUrl('')).toBe(false);
        expect(isValidQuicklinkUrl('   ')).toBe(false);
        expect(isValidQuicklinkUrl('not a url :::')).toBe(false);
    });
});
