/**
 * Copy coverage for the settings page.
 *
 * A missing key does not throw: `t(key)` returns the key itself, so the row renders the
 * literal "settingsLaunchpadGridSize" in the middle of a Chinese label and nobody notices
 * until someone looks at a screenshot. That happened once while grouping the general page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
    createSettingsBuilder: vi.fn()
}));

vi.mock('../scripts/domains/settings/builder.js', () => ({
    createSettingsBuilder: mocks.createSettingsBuilder
}));

import { registerGeneralContent } from '../scripts/domains/settings/content-core.js';

const LOCALES = ['en', 'zh_CN', 'zh_TW'];

function loadLocale(name) {
    return JSON.parse(readFileSync(resolve(process.cwd(), `scripts/platform/locales/${name}.json`), 'utf8'));
}

function createWindowStub() {
    const renderers = new Map();
    return {
        registerContentRenderer: vi.fn((key, renderer) => renderers.set(key, renderer)),
        getRenderer: (key) => renderers.get(key)
    };
}

/** Every key the general page needs to print something a person can read. */
function keysUsedByGeneralPage() {
    const win = createWindowStub();
    registerGeneralContent(win);
    const renderer = win.getRenderer('general');
    const container = document.createElement('div');
    renderer(container);

    const [, config] = mocks.createSettingsBuilder.mock.calls[0];
    const keys = new Set();

    const add = (...candidates) => {
        for (const key of candidates) {
            if (typeof key === 'string' && key) keys.add(key);
        }
    };

    for (const section of config.sections || []) {
        add(section.titleKey, section.noteKey);
        for (const row of section.rows || []) {
            add(row.labelKey, row.descKey);
            for (const item of row.items || []) add(item.chipLabelKey, item.labelKey, item.descKey);
            for (const option of row.options || []) add(option.labelKey);
        }
    }

    // The density steppers live inside the stepper row builder, so their two labels are not
    // visible in the section config.
    add('settingsLaunchpadColumns', 'settingsLaunchpadRows');

    return keys;
}

describe('locales', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mocks.createSettingsBuilder.mockReset();
        mocks.createSettingsBuilder.mockImplementation(() => ({
            init: vi.fn(async () => {}),
            getById: vi.fn(() => null)
        }));
    });

    it('keeps the three locale files on the same key set', () => {
        const sets = LOCALES.map((name) => ({ name, keys: Object.keys(loadLocale(name)).sort() }));
        const [reference, ...rest] = sets;

        for (const other of rest) {
            expect({ missing: reference.keys.filter((k) => !other.keys.includes(k)) })
                .toEqual({ missing: [] });
            expect({ extra: other.keys.filter((k) => !reference.keys.includes(k)) })
                .toEqual({ extra: [] });
        }
    });

    it('has copy for every key the general settings page asks for', () => {
        const keys = keysUsedByGeneralPage();
        expect(keys.size).toBeGreaterThan(10);

        for (const name of LOCALES) {
            const locale = loadLocale(name);
            const missing = [...keys].filter((key) => typeof locale[key] !== 'string' || !locale[key].trim());
            expect({ locale: name, missing }).toEqual({ locale: name, missing: [] });
        }
    });
});
