/**
 * Settings-window UI pieces: the about/changelog pages, the macOS settings window shell, and
 * the custom select control they both use.
 *
 * This is a plain concatenation — none of the three fakes a module, and each describe builds
 * and tears down its own DOM.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/settings/settings-about-changelog-ui.test.js
 *   tests/settings/mac-settings-window.test.js
 *   tests/settings/select-menu.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modalLayer } from '../../scripts/platform/modal-layer.js';
import { closeSelectMenu, enhanceSelect, enhanceSelects } from '../../scripts/shared/select-menu.js';

// ===== from tests/settings/settings-about-changelog-ui.test.js =====
function createWindowStub() {
    const renderers = new Map();
    return {
        registerContentRenderer: vi.fn((key, renderer) => {
            renderers.set(key, renderer);
        }),
        getRenderer(key) {
            return renderers.get(key);
        },
        close: vi.fn()
    };
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('settings about/changelog UI', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        chrome.runtime.getManifest = vi.fn(() => ({
            name: 'Aura Tab',
            version: '9.9.9'
        }));
    });

    it('about page should render compact brand, shortcut, and resource sections', async () => {
        const { registerAboutContent } = await import('../../scripts/domains/settings/content-core.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerAboutContent(win);
        const renderer = win.getRenderer('about');

        expect(typeof renderer).toBe('function');
        renderer(container);
        await flushAsync();

        expect(container.querySelector('.mac-about-header')).toBeTruthy();
        expect(container.querySelector('.mac-about-header--hero')).toBeTruthy();
        expect(container.querySelector('.mac-about-description')).toBeTruthy();

        const links = Array.from(container.querySelectorAll('.mac-about-link-btn'));
        expect(links).toHaveLength(3);
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
            'https://github.com/nil-byte/aura-tab',
            'https://nil-byte.github.io/aura-tab/',
            'https://nil-byte.github.io/aura-tab-privacy-policy/'
        ]);
        expect(
            container.querySelector(
                'a[href="https://nil-byte.github.io/aura-tab/"] .mac-about-link-icon--homepage'
            )
        ).toBeTruthy();
        expect(
            container.querySelector(
                'a[href="https://nil-byte.github.io/aura-tab-privacy-policy/"] .mac-about-link-icon--privacy'
            )
        ).toBeTruthy();

        const resourceIcons = Array.from(container.querySelectorAll('.mac-about-link-icon'));
        expect(resourceIcons).toHaveLength(3);
        expect(
            resourceIcons.every(
                (icon) =>
                    icon.getAttribute('width') === '16' &&
                    icon.getAttribute('height') === '16'
            )
        ).toBe(true);

        const shortcutButtons = Array.from(
            container.querySelectorAll('.mac-shortcut-btn[data-shortcut-action]')
        );
        expect(shortcutButtons).toHaveLength(2);
        expect(shortcutButtons.every((button) => button.classList.contains('mac-keycap'))).toBe(true);

        const keycaps = Array.from(container.querySelectorAll('.mac-keycap'));
        expect(keycaps).toHaveLength(4);
    });

    it('changelog page should render the latest 20 versions only', async () => {
        const payload = Object.fromEntries(
            Array.from({ length: 25 }, (_, index) => {
                const version = `3.${index}`;
                return [version, { en: [`Change ${index}`] }];
            })
        );
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => payload
        }));

        const { registerChangelogContent } = await import('../../scripts/domains/settings/content-core.js');
        const win = createWindowStub();
        const container = document.createElement('div');

        registerChangelogContent(win);
        const renderer = win.getRenderer('changelog');

        expect(typeof renderer).toBe('function');
        await renderer(container);

        const cards = Array.from(container.querySelectorAll('.mac-changelog-card'));
        expect(cards).toHaveLength(20);
        expect(cards[0]?.querySelector('.mac-changelog-version')?.textContent).toContain('3.24');
        expect(cards.at(-1)?.querySelector('.mac-changelog-version')?.textContent).toContain('3.5');
    });
});

// ===== from tests/settings/mac-settings-window.test.js =====
function mountSettingsDom() {
    document.body.innerHTML = '';
    document.body.insertAdjacentHTML('beforeend', `
        <div class="mac-window-overlay" id="macSettingsOverlay" aria-hidden="true">
            <div class="mac-window" id="macSettingsWindow"></div>
        </div>
    `);
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

async function flushSettingsWindowAsync() {
    await Promise.resolve();
    await Promise.resolve();
}

async function createSettingsWindow() {
    vi.resetModules();
    mountSettingsDom();
    const { getMacSettingsWindow } = await import('../../scripts/domains/settings/window.js');
    return getMacSettingsWindow();
}

describe('MacSettingsWindow', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        modalLayer.destroy();
        chrome.runtime.getManifest = vi.fn(() => ({
            name: 'Aura Tab',
            version: '9.9.9'
        }));
    });

    afterEach(() => {
        modalLayer.destroy();
    });

    it('does not let a stale async tab render overwrite the current tab', async () => {
        const staleRender = createDeferred();
        const settingsWindow = await createSettingsWindow();

        settingsWindow.registerContentRenderer('general', (container) => {
            container.innerHTML = '<div id="general-pane">General</div>';
        });
        settingsWindow.registerContentRenderer('data', async (container) => {
            await staleRender.promise;
            container.innerHTML = '<div id="stale-data-pane">Stale data</div>';
        });

        settingsWindow.open();
        settingsWindow._selectMenu('data');
        settingsWindow._selectMenu('general');

        staleRender.resolve();
        await flushSettingsWindowAsync();

        expect(document.getElementById('general-pane')).toBeTruthy();
        expect(document.getElementById('stale-data-pane')).toBeNull();

        settingsWindow.destroy();
    });

    it('allows the current async tab render to commit', async () => {
        const currentRender = createDeferred();
        const settingsWindow = await createSettingsWindow();

        settingsWindow.registerContentRenderer('changelog', async (container) => {
            await currentRender.promise;
            container.innerHTML = '<div id="current-changelog-pane">Changelog</div>';
        });

        settingsWindow.open();
        settingsWindow._selectMenu('changelog');

        currentRender.resolve();
        await flushSettingsWindowAsync();

        expect(document.getElementById('current-changelog-pane')).toBeTruthy();

        settingsWindow.destroy();
    });
});

// ===== from tests/settings/select-menu.test.js =====
/**
 * The popup menu that stands in for the system's own `<select>` list.
 *
 * What is worth guarding here is the contract, not the pixels: every host in the app
 * still reads `select.value` and listens for `change`, so a menu that forgets to write
 * back — or a host that writes `.value` and sees a stale label — is a silent desync.
 */


function mount(html = '<select id="pick"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select>') {
    document.body.innerHTML = `<div class="mac-select">${html}</div>`;
    return document.getElementById('pick');
}

const trigger = () => document.querySelector('.select-menu-trigger');
const list = () => document.querySelector('.select-menu-list');
const items = () => [...document.querySelectorAll('.select-menu-item')];
const key = (el, name) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));

let mounted = [];

function enhance(select, options) {
    const controller = enhanceSelect(select, options);
    if (controller) mounted.push(controller);
    return controller;
}

beforeEach(() => {
    mounted = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    for (const controller of mounted) controller.destroy();
    mounted = [];
    document.body.innerHTML = '';
});

describe('select-menu', () => {
    it('hides the native select and shows its current option on the trigger', () => {
        const select = mount();
        enhance(select);
        expect(select.classList.contains('select-menu-native')).toBe(true);
        expect(select.getAttribute('aria-hidden')).toBe('true');
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Alpha');
    });

    it('writes a chosen item back to the select and fires one change', () => {
        const select = mount();
        enhance(select);
        let changes = 0;
        select.addEventListener('change', () => { changes += 1; });

        trigger().click();
        items()[2].dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

        expect(select.value).toBe('c');
        expect(changes).toBe(1);
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Gamma');
        expect(list().hidden).toBe(true);
    });

    it('follows a value written by the host, which fires no event', () => {
        const select = mount();
        enhance(select);
        // This is how the appearance section restores stored settings.
        select.value = 'b';
        expect(trigger().querySelector('.select-menu-label').textContent).toBe('Beta');
    });

    it('disables the trigger when the host disables the select', () => {
        const select = mount();
        enhance(select);
        select.disabled = true;
        expect(trigger().disabled).toBe(true);
        // A disabled row must not open: the Bing source pins the refresh interval this way.
        trigger().click();
        expect(list().hidden).toBe(true);
    });

    it('opens on ArrowDown, moves with arrows and commits with Enter', () => {
        const select = mount();
        enhance(select);

        key(trigger(), 'ArrowDown');
        expect(list().hidden).toBe(false);
        key(trigger(), 'ArrowDown');
        key(trigger(), 'Enter');
        expect(select.value).toBe('b');
        expect(list().hidden).toBe(true);
    });

    it('treats Escape as a cancel that leaves the value alone', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        key(trigger(), 'ArrowDown');
        key(trigger(), 'ArrowDown');
        key(trigger(), 'Escape');
        expect(select.value).toBe('a');
        expect(list().hidden).toBe(true);
    });

    it('closes when the pointer goes down somewhere else', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
        expect(list().hidden).toBe(true);
    });

    it('keeps only one menu open at a time', () => {
        document.body.innerHTML = `
            <div class="mac-select"><select id="one"><option>A</option></select></div>
            <div class="mac-select"><select id="two"><option>B</option></select></div>`;
        mounted.push(enhanceSelect(document.getElementById('one')));
        mounted.push(enhanceSelect(document.getElementById('two')));
        const [first, second] = [...document.querySelectorAll('.select-menu-trigger')];
        const [firstList, secondList] = [...document.querySelectorAll('.select-menu-list')];

        first.click();
        expect(firstList.hidden).toBe(false);

        second.click();
        expect(firstList.hidden).toBe(true);
        expect(secondList.hidden).toBe(false);
    });

    it('sweeps up the menu of a select that a re-render removed', () => {
        const select = mount();
        enhance(select);
        expect(document.querySelectorAll('.select-menu-list')).toHaveLength(1);

        // The settings window replaces its whole content subtree on every route change.
        document.body.innerHTML = '<div class="mac-select"><select id="pick"><option value="a">Alpha</option></select></div>';
        enhanceSelects(document.body);
        expect(document.querySelectorAll('.select-menu-list')).toHaveLength(1);
    });

    it('can force the dark palette for hosts whose glass is always dark', () => {
        const select = mount();
        enhance(select, { tone: 'dark' });
        expect(list().dataset.tone).toBe('dark');
    });

    it('closes everything on demand, for a window or modal that is going away', () => {
        const select = mount();
        enhance(select);
        trigger().click();
        closeSelectMenu();
        expect(list().hidden).toBe(true);
    });

    it('does nothing when handed something that is not a select', () => {
        document.body.innerHTML = '<input id="not-a-select">';
        expect(enhanceSelect(document.getElementById('not-a-select'))).toBeNull();
    });
});
