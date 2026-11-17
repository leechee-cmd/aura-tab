/**
 * Static asset guards.
 *
 * These tests never boot a runtime: they read source files as text and assert on the
 * contract that text carries (no inline event handlers anywhere, CSS tokens and rules
 * that a refactor would silently drop, markup ids the editors bind to). Kept in one
 * file because each of them is a handful of `toContain` assertions — as separate files
 * they paid a full jsdom environment apiece for a `readFileSync`.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/csp-inline-event-handlers.test.js
 *   tests/launchpad-search-style-stability.test.js
 *   tests/settings-stepper-style.test.js
 *   tests/photos-style-spacing.test.js
 *   tests/quicklink-editor-dock-polish.test.js
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';

// ========== Repo-wide: CSP hardening ==========

const INLINE_EVENT_ATTR_RE = /\bon[a-z]+\s*=\s*['"]/gi;

async function listFilesRecursively(rootDir) {
    /** @type {string[]} */
    const results = [];

    /** @type {string[]} */
    const stack = [rootDir];

    while (stack.length) {
        const current = stack.pop();
        const entries = await fs.readdir(current, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                // Hidden directories too: .git is not source, and neither is local scratch
                // like .thinkrail, which can hold a 20MB browser profile and made this
                // whole-tree read slow enough to time out on a busy machine.
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === 'dist') {
                    continue;
                }
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile()) {
                results.push(fullPath);
            }
        }
    }

    return results;
}

function findInlineEventAttributes(sourceText) {
    /** @type {{ index: number, match: string }[]} */
    const hits = [];
    INLINE_EVENT_ATTR_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_EVENT_ATTR_RE.exec(sourceText)) !== null) {
        hits.push({ index: m.index, match: m[0] });
    }
    return hits;
}

function indexToLineCol(text, index) {
    const prefix = text.slice(0, index);
    const lines = prefix.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    return { line, col };
}

describe('CSP hardening', () => {
    it('does not contain inline event handler attributes', async () => {
        const projectRoot = process.cwd();
        const allFiles = await listFilesRecursively(projectRoot);

        const candidates = allFiles.filter((filePath) => {
            const rel = path.relative(projectRoot, filePath);
            if (rel.startsWith('node_modules' + path.sep)) return false;
            if (rel.startsWith('coverage' + path.sep)) return false;
            if (rel.startsWith('dist' + path.sep)) return false;
            if (rel.startsWith('scripts' + path.sep + 'libs' + path.sep)) return false;
            const ext = path.extname(filePath).toLowerCase();
            return ext === '.html' || ext === '.js';
        });

        /** @type {string[]} */
        const violations = [];

        for (const filePath of candidates) {
            const text = await fs.readFile(filePath, 'utf8');
            const hits = findInlineEventAttributes(text);
            for (const hit of hits) {
                const { line, col } = indexToLineCol(text, hit.index);
                const rel = path.relative(projectRoot, filePath);
                violations.push(`${rel}:${line}:${col} ${hit.match.trim()}`);
            }
        }

        expect(violations).toEqual([]);
    });
});

// ========== CSS / markup contracts ==========

// The bundle that holds every hand-written rule; the photos window has its own sheet.
const css = readFileSync('styles/bundle.css', 'utf8');
const photosCss = readFileSync('styles/photos.css', 'utf8');
const html = readFileSync('newtab.html', 'utf8');
const dockSource = readFileSync('scripts/domains/quicklinks/dock.js', 'utf8');
const settingsSource = readFileSync('scripts/domains/settings/content-dock.js', 'utf8');

function readCssRule(selector) {
    const bundle = readFileSync(resolve(process.cwd(), 'styles/bundle.css'), 'utf8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchored to the start of a selector line: `.mac-stepper` also appears inside longer
    // selectors (`.mac-stepper-group-item .mac-stepper`), and an unanchored match read that
    // one instead of the rule this test is about.
    const match = bundle.match(new RegExp(`^\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match?.[1] || '';
}

describe('Launchpad search style stability', () => {
    it('should define dedicated stable tokens and pre-settled style rule', () => {
        expect(css).toContain('--launchpad-search-bg-rest');
        expect(css).toContain('--launchpad-search-bg-focus');
        expect(css).toContain('--launchpad-search-border-rest');
        expect(css).toContain('--launchpad-search-border-focus');

        expect(css).toContain('.launchpad-overlay.active:not(.settled) .launchpad-search-input');
        expect(css).toContain('.launchpad-overlay.active:not(.settled) .launchpad-search-input:focus');
    });
});

describe('settings stepper style', () => {
    it('keeps decrement, value, and increment columns visually centered', () => {
        const stepperRule = readCssRule('.mac-stepper');
        const buttonRule = readCssRule('.mac-stepper-btn');
        const valueRule = readCssRule('.mac-stepper-value');

        expect(stepperRule).toContain('display: grid');
        expect(stepperRule).toContain('grid-template-columns: var(--mac-stepper-button-width) minmax(0, 1fr) var(--mac-stepper-button-width)');
        expect(buttonRule).toContain('width: 100%');
        expect(valueRule).toContain('width: 100%');
        expect(valueRule).toContain('justify-content: center');
    });
});

describe('photos style spacing', () => {
    it('adds bottom spacing safeguards for gallery scroll area', () => {
        expect(photosCss).toContain('.photos-content-body');
        expect(photosCss).toContain('scroll-padding-bottom');
        expect(photosCss).toContain('display: block');
        expect(photosCss).toContain('--photos-scroll-bottom-safe-gap');
        expect(photosCss).toContain('--photos-scroll-bottom-safe-gap: calc(var(--space-2) + 6px);');

        const galleryRule = photosCss.match(/\.photos-gallery\s*\{[\s\S]*?\}/);
        expect(galleryRule).toBeTruthy();
        expect(galleryRule?.[0]).not.toMatch(/flex:\s*1/);
        expect(galleryRule?.[0]).toMatch(/flex:\s*0\s+0\s+auto/);
        expect(galleryRule?.[0]).toMatch(/padding-bottom:\s*6px/);
    });
});

describe('quicklink editor and top Dock polish contracts', () => {
    it('uses a compact identity editor with a grounded icon preview', () => {
        expect(css).toContain('width: min(660px, calc(100vw - 48px))');
        expect(css).toContain('grid-template-columns: 84px minmax(0, 1fr)');
        expect(html).toContain('class="quicklink-identity-editor"');
        expect(html).toContain('class="quicklink-identity-main"');
        expect(css).toMatch(/\.quicklink-preview-icon\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.07\);/s);
    });

    it('uses a single color well backed by the native color input', () => {
        expect(html).toContain('id="quicklinkColorWell"');
        expect(html).toContain('id="quicklinkCustomColorInput"');
        expect(html).not.toContain('quicklinkColorPalette');
        expect(css).toContain('.quicklink-color-well');
        expect(css).not.toContain('.quicklink-color-palette');
    });

    it('keeps all icon modes in a fixed-height configuration slot', () => {
        expect(html).toContain('class="quicklink-mode-slot"');
        expect(css).toMatch(/\.quicklink-mode-slot,\s*\.quicklink-icon-options\s*\{[^}]*height:\s*40px;/s);
        expect(css).toMatch(/\.quicklink-appearance-row\s*\{[^}]*grid-template-columns:\s*var\(--quicklink-url-column\) var\(--quicklink-title-column\);/s);
        expect(css).toMatch(/\.quicklink-icon-mode button\s*\{[^}]*font:\s*500 var\(--text-sm\)/s);
    });

    it('keeps form DOM order aligned with the visual grid order', () => {
        expect(html.indexOf('id="quicklinkUrlInput"')).toBeLessThan(html.indexOf('id="quicklinkTitleInput"'));
        expect(html.indexOf('class="quicklink-mode-slot"')).toBeLessThan(html.indexOf('id="quicklinkIconMode"'));
        expect(css).not.toMatch(/\.quicklink-icon-mode\s*\{\s*order:/);
        expect(css).not.toMatch(/\.quicklink-mode-slot,\s*\.quicklink-icon-options\s*\{\s*order:/);
    });

    it('groups the primary fields and secondary controls without old layout overrides', () => {
        expect(css).toMatch(/\.quicklink-primary-fields\s*\{[^}]*display:\s*grid;/s);
        expect(css).toContain('--quicklink-url-column: minmax(0, 7fr)');
        expect(css).toContain('--quicklink-title-column: minmax(148px, 3fr)');
        expect(css).toMatch(/\.quicklink-primary-fields\s*\{[^}]*grid-template-columns:\s*var\(--quicklink-url-column\) var\(--quicklink-title-column\);/s);
        expect(html).toContain('class="quicklink-secondary-fields"');
        expect(css).not.toContain('.quicklink-dialog-icon-editor');
        expect(css).not.toContain('.quicklink-icon-controls');
        expect(css).not.toContain('grid-template-columns: 260px minmax(0, 1fr)');
    });

    it('centers the preview across both field rows with a subtle optical offset', () => {
        expect(css).toMatch(/\.quicklink-identity-editor\s*\{[^}]*align-items:\s*stretch;/s);
        expect(css).toMatch(/\.quicklink-dialog-preview\s*\{[^}]*align-items:\s*center;[^}]*transform:\s*translateY\(4px\);/s);
    });

    it('keeps the close control visually unframed with a keyboard focus indicator', () => {
        expect(css).toMatch(/\.quicklink-dialog-close\s*\{[^}]*background:\s*transparent;[^}]*border:\s*none;[^}]*border-radius:\s*0;/s);
        expect(css).toContain('.quicklink-dialog-close:focus-visible');
        expect(css).not.toMatch(/\.quicklink-dialog-close:hover\s*\{[^}]*background/s);
    });

    it('provides an explicit cancel action in the editor footer', () => {
        expect(html).toContain('id="quicklinkCancelBtn"');
        expect(html).toContain('data-i18n="cancel"');
    });

    it('does not run a top-specific magnifier and disables the slider for top position', () => {
        expect(dockSource).not.toContain('_updateTopMagnifier');
        expect(dockSource).toContain("if (this.container?.dataset.position === 'top') return;");
        expect(settingsSource).toContain('slider.disabled = isTop');
        expect(settingsSource).toContain('settingsQuicklinksMagnifyBottomOnly');
    });
});
