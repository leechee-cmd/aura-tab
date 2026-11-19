
import { modalLayer } from '../platform/modal-layer.js';
import { DisposableComponent } from '../platform/lifecycle.js';
import { launchpad } from './quicklinks/launchpad.js';
import { getSyncSettings, SYNC_SETTINGS_DEFAULTS } from '../platform/settings-contract.js';
import { isTimeoutError, logWithDedup } from '../shared/error-utils.js';
import {
    SHORTCUT_SETTING_KEYS,
    matchesShortcutEvent,
    resolveShortcutSettings
} from '../platform/shortcut-manager.js';

export class LayoutManager extends DisposableComponent {
    constructor({ backgroundSystem } = {}) {
        super();

        this.backgroundSystem = backgroundSystem || null;

        this.layoutContainer = document.querySelector('.layout-container');
        this.searchContainer = document.getElementById('searchContainer');
        this.searchToggleBtn = document.getElementById('searchToggleBtn');
        this.searchInput = document.getElementById('searchInput');
        this.refreshBgBtn = document.getElementById('refreshBgBtn');
        this.isSearchActive = false;

        this.cornerTopLeft = document.getElementById('cornerTopLeft');
        this.cornerTopRight = document.getElementById('cornerTopRight');
        this.cornerBottomLeft = document.getElementById('cornerBottomLeft');
        this.cornerBottomRight = document.getElementById('cornerBottomRight');

        this.photoInfo = document.getElementById('photoInfo');
        this.photoAuthor = document.getElementById('photoAuthor');
        this.authorName = document.getElementById('authorName');
        this.downloadBgBtn = document.getElementById('downloadBgBtn');
        this.favoriteBgBtn = document.getElementById('favoriteBgBtn');
        this.favoriteIconEmpty = this.favoriteBgBtn?.querySelector('.favorite-icon-empty');
        this.favoriteIconFilled = this.favoriteBgBtn?.querySelector('.favorite-icon-filled');

        this._isDownloading = false;
        this._isFavoriting = false;
        this._photoInfoUpdateGeneration = 0;
        this._storageChangeHandler = null;
        this._shortcuts = resolveShortcutSettings({
            [SHORTCUT_SETTING_KEYS.focusSearch]: SYNC_SETTINGS_DEFAULTS[SHORTCUT_SETTING_KEYS.focusSearch],
            [SHORTCUT_SETTING_KEYS.openLaunchpad]: SYNC_SETTINGS_DEFAULTS[SHORTCUT_SETTING_KEYS.openLaunchpad]
        });

    }

    async init() {
        if (this.isDestroyed || this.isInitialized) return;

        if (!this.layoutContainer || !this.searchContainer || !this.searchInput) {
            return;
        }

        if (this.searchToggleBtn) {
            this._events.add(this.searchToggleBtn, 'click', () => this.toggleSearch(undefined, { focus: true }));
        }

        // The resting state is a 2px light line inside this container: clicking anywhere on it
        // (its hit band is wider than the line) opens the box. Runs before the search module's
        // own container listener, so the input is already visible when that one focuses it.
        this._events.add(this.searchContainer, 'click', () => {
            if (!this.isSearchActive) {
                this.toggleSearch(true, { focus: true });
            }
        });

        if (this.refreshBgBtn) {
            this._events.add(this.refreshBgBtn, 'click', () => this.refreshBackground());
        }

        if (this.downloadBgBtn) {
            this._events.add(this.downloadBgBtn, 'click', () => this._handleDownloadBackground());
        }

        if (this.favoriteBgBtn) {
            this._events.add(this.favoriteBgBtn, 'click', () => this._handleToggleFavorite());
        }

        this._events.add(document, 'keydown', (e) => this._handleKeydown(e));

        this._events.add(window, 'background:applied', (event) => {
            void this._updatePhotoInfo(event.detail?.background);
        });

        await this._initSearchUi();

        await this.initAllVisibilitySettings();

        this._storageChangeHandler = (changes, areaName) => {
            if (areaName === 'local' && changes.libraryItems) {
                const currentBg = this.backgroundSystem?.getCurrentBackground?.();
                if (currentBg?.id) {
                    void this._updateFavoriteButtonState(currentBg);
                }
                return;
            }

            if (areaName !== 'sync') return;

            if (changes.showCornerSearch) {
                this._showCornerSearch = changes.showCornerSearch.newValue === true;
                this._applyCornerSearch(this._showCornerSearch);
            }

            if (changes.searchAlwaysVisible) {
                this._alwaysShowSearch = changes.searchAlwaysVisible.newValue === true;
                this._persistSearchMirror(this._alwaysShowSearch);
                this.toggleSearch(this._alwaysShowSearch);
            }

            if (changes.showSettingsBtn && this.cornerBottomLeft) {
                const alwaysVisible = changes.showSettingsBtn.newValue;
                this.cornerBottomLeft.classList.toggle('always-visible', alwaysVisible);
            }

            if (changes.launchpadShowNames !== undefined) {
                this._applyLaunchpadShowNames(changes.launchpadShowNames.newValue);
            }

            if (changes[SHORTCUT_SETTING_KEYS.focusSearch] || changes[SHORTCUT_SETTING_KEYS.openLaunchpad]) {
                this._applyShortcutSettings({
                    [SHORTCUT_SETTING_KEYS.focusSearch]: changes[SHORTCUT_SETTING_KEYS.focusSearch]?.newValue,
                    [SHORTCUT_SETTING_KEYS.openLaunchpad]: changes[SHORTCUT_SETTING_KEYS.openLaunchpad]?.newValue
                });
            }

            if (changes.backgroundSettings) {
                const bgSettings = changes.backgroundSettings.newValue || {};
                this._applyBackgroundVisibilitySettings(bgSettings);
            }
        };
        chrome.storage.onChanged.addListener(this._storageChangeHandler);
        this._addDisposable(() => {
            if (!this._storageChangeHandler) return;
            chrome.storage.onChanged.removeListener(this._storageChangeHandler);
            this._storageChangeHandler = null;
        });

        this._markInitialized();
    }

    _handleKeydown(e) {
        const activeElement = document.activeElement;
        const isInputActive = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        );

        if (e.key === '/' && !isInputActive) {
            if (this.checkOpenModals()) return;

            e.preventDefault();
            // With "always show" on, the box is already open and unfocused: focus it rather
            // than toggling it shut.
            this.toggleSearch(this.isSearchActive ? true : undefined, { focus: true });
            return;
        }

        if (e.key === ' ' && !isInputActive) {
            if (this.checkOpenModals()) return;

            e.preventDefault();
            const settingsBtn = document.getElementById('settingsBtn');
            settingsBtn?.click();
            return;
        }

        if (matchesShortcutEvent(e, this._shortcuts.openLaunchpad)) {
            e.preventDefault();
            launchpad.toggle({ focusSearch: true });
            return;
        }

        if (matchesShortcutEvent(e, this._shortcuts.focusSearch)) {
            e.preventDefault();
            this.toggleSearch(true, { focus: true });
            return;
        }

        if (e.key === 'Escape' && this.isSearchActive) {
            const hasOpenModal = this.checkOpenModals();
            if (!hasOpenModal) {
                this.toggleSearch(false);
            }
        }
    }

    async initAllVisibilitySettings() {
        const settings = await getSyncSettings({
            showSettingsBtn: undefined,
            launchpadShowNames: undefined,
            [SHORTCUT_SETTING_KEYS.focusSearch]: undefined,
            [SHORTCUT_SETTING_KEYS.openLaunchpad]: undefined,
            backgroundSettings: undefined
        });

        const bgSettings = settings.backgroundSettings || {};

        if (this.cornerBottomLeft) {
            this.cornerBottomLeft.classList.toggle('always-visible', settings.showSettingsBtn);
        }

        this._applyLaunchpadShowNames(settings.launchpadShowNames);
        this._applyShortcutSettings(settings);

        this._applyBackgroundVisibilitySettings(bgSettings);
    }

    _applyShortcutSettings(settings = {}) {
        const next = resolveShortcutSettings({
            [SHORTCUT_SETTING_KEYS.focusSearch]:
                settings[SHORTCUT_SETTING_KEYS.focusSearch] ?? this._shortcuts.focusSearch,
            [SHORTCUT_SETTING_KEYS.openLaunchpad]:
                settings[SHORTCUT_SETTING_KEYS.openLaunchpad] ?? this._shortcuts.openLaunchpad
        });
        this._shortcuts = next;
    }

    _applyLaunchpadShowNames(show) {
        document.documentElement.dataset.launchpadShowNames = show ? '1' : '0';
    }

    _applyBackgroundVisibilitySettings(bgSettings) {
        if (this.cornerTopLeft) {
            this.cornerTopLeft.classList.toggle('always-visible', !!bgSettings.showRefreshButton);
        }

        if (this.cornerTopRight) {
            this.cornerTopRight.classList.toggle('always-visible', !!bgSettings.showPhotoInfo);
            this.cornerTopRight.classList.remove('disabled');
        }

        void this._updatePhotoInfo();
    }

    async _updatePhotoInfo(appliedBackground) {
        if (!this.backgroundSystem) return;
        const generation = ++this._photoInfoUpdateGeneration;

        try {
            if (typeof this.backgroundSystem.whenReady === 'function') {
                await this.backgroundSystem.whenReady(5000);
            }
            if (generation !== this._photoInfoUpdateGeneration) return;

            const currentBg = appliedBackground !== undefined
                ? appliedBackground
                : this.backgroundSystem.getCurrentBackground?.();

            if (currentBg?.username && this.authorName && this.photoAuthor) {
                this.authorName.textContent = currentBg.username;
                const page = typeof currentBg.page === 'string' ? currentBg.page.trim() : '';
                if (page) {
                    this.photoAuthor.setAttribute('href', page);
                    this.photoAuthor.removeAttribute('aria-disabled');
                } else {
                    this.photoAuthor.removeAttribute('href');
                    this.photoAuthor.setAttribute('aria-disabled', 'true');
                }
                this.photoInfo?.classList.remove('hidden');

                await this._updateFavoriteButtonState(currentBg, generation);
            } else {
                if (this.authorName) this.authorName.textContent = '';
                this.photoInfo?.classList.add('hidden');
            }
        } catch (error) {
            if (isTimeoutError(error)) {
                return;
            }
            logWithDedup('warn', '[LayoutManager] Failed to update photo info:', error, {
                dedupeKey: 'layout.photo-info.update'
            });
        }
    }

    async _updateFavoriteButtonState(currentBg, generation = this._photoInfoUpdateGeneration) {
        if (!this.favoriteBgBtn || !this.favoriteIconEmpty || !this.favoriteIconFilled) {
            return;
        }

        try {
            const { libraryStore } = await import('./backgrounds/library-store.js');
            await libraryStore.init();
            if (generation !== this._photoInfoUpdateGeneration) return;

            const isFavorited = currentBg?.id && libraryStore.has(currentBg.id);

            if (isFavorited) {
                this.favoriteIconEmpty.classList.add('hidden');
                this.favoriteIconFilled.classList.remove('hidden');
                this.favoriteBgBtn.classList.add('is-favorited');
            } else {
                this.favoriteIconEmpty.classList.remove('hidden');
                this.favoriteIconFilled.classList.add('hidden');
                this.favoriteBgBtn.classList.remove('is-favorited');
            }
        } catch (error) {
            console.warn('[LayoutManager] Failed to update favorite state:', error);
        }
    }

    async _handleDownloadBackground() {
        if (!this.downloadBgBtn || this._isDownloading) return;

        this._isDownloading = true;
        this.downloadBgBtn.classList.add('downloading');

        try {
            if (!this.backgroundSystem) {
                throw new Error('No background system');
            }

            if (typeof this.backgroundSystem.whenReady === 'function') {
                await Promise.race([
                    this.backgroundSystem.whenReady(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                ]);
            }

            const currentBg = this.backgroundSystem.getCurrentBackground?.();
            if (!currentBg) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload'));
                return;
            }

            const imageUrl = currentBg.downloadUrl || currentBg.urls?.full;
            if (!imageUrl) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload'));
                return;
            }

            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error('Download failed');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const ext = blob.type.split('/')[1] || 'jpg';
            const filename = `background-${currentBg.id || Date.now()}.${ext}`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => URL.revokeObjectURL(url), 1200);

            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('downloadStarted'));
        } catch (error) {
            console.error('[LayoutManager] Download failed:', error);
            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('downloadFailed'));
        } finally {
            this._isDownloading = false;
            this.downloadBgBtn?.classList.remove('downloading');
        }
    }

    async _handleToggleFavorite() {
        if (!this.favoriteBgBtn || this._isFavoriting) return;

        this._isFavoriting = true;
        this.favoriteBgBtn.classList.add('favoriting');

        try {
            if (!this.backgroundSystem) {
                throw new Error('No background system');
            }

            if (typeof this.backgroundSystem.whenReady === 'function') {
                await Promise.race([
                    this.backgroundSystem.whenReady(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                ]);
            }

            const currentBg = this.backgroundSystem.getCurrentBackground?.();
            if (!currentBg?.id) {
                const { toast } = await import('../shared/toast.js');
                const { t } = await import('../platform/i18n.js');
                toast(t('noImagesDownload')); // Reuse "no images" toast message
                return;
            }

            const { libraryStore } = await import('./backgrounds/library-store.js');
            await libraryStore.init();

            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');

            const isFavorited = libraryStore.has(currentBg.id);

            if (isFavorited) {
                const snapshot = libraryStore.get(currentBg.id);
                await libraryStore.remove(currentBg.id);
                toast(t('photosUnfavorited'), {
                    action: {
                        label: t('photosUndo') || 'Undo',
                        onClick: async () => {
                            if (!snapshot) return;
                            const ok = await libraryStore.upsert(snapshot);
                            if (ok && snapshot?.kind === 'remote' && snapshot?.downloadState === 'pending') {
                                await libraryStore.enqueueDownload(snapshot.id);
                            }

                            const stillCurrent = this.backgroundSystem?.getCurrentBackground?.();
                            if (stillCurrent?.id === currentBg.id) {
                                await this._updateFavoriteButtonState(stillCurrent);
                            }

                            toast(t('photosFavorited'));
                        }
                    }
                });
            } else {
                if (libraryStore.count() >= 5000) {
                    toast(t('photosFavoriteMaxReached'));
                    return;
                }

                const bgSettings = await getSyncSettings({ backgroundSettings: undefined });
                const provider = bgSettings.backgroundSettings?.type || 'files';

                const thumbParamsByProvider = {
                    unsplash: '?w=300&q=70&auto=format',
                    pexels: '?auto=compress&cs=tinysrgb&fit=max&w=600&q=85&fm=webp'
                };
                const thumbParams = thumbParamsByProvider[provider] || '';

                const isFiles = provider === 'files' || currentBg.file || String(currentBg.urls?.full || '').startsWith('blob:');
                const success = isFiles
                    ? await libraryStore.addLocalFavoriteFromBackground(currentBg)
                    : await libraryStore.addRemoteFavoriteFromBackground(currentBg, { provider, thumbParams });

                if (success) toast(t('photosFavorited'));
            }

            await this._updateFavoriteButtonState(currentBg);

        } catch (error) {
            console.error('[LayoutManager] Toggle favorite failed:', error);
            const { toast } = await import('../shared/toast.js');
            const { t } = await import('../platform/i18n.js');
            toast(t('unknownError'));
        } finally {
            this._isFavoriting = false;
            this.favoriteBgBtn?.classList.remove('favoriting');
        }
    }

    toggleSearch(force, { focus = false } = {}) {
        this.isSearchActive = typeof force === 'boolean' ? force : !this.isSearchActive;

        // <html data-search-open> is the single source of the open/closed shape: the
        // first-paint script sets it before the first frame so the initial state costs
        // no animation, and CSS keys both the box and the clock shift off it.
        document.documentElement.dataset.searchOpen = this.isSearchActive ? '1' : '0';

        if (this.isSearchActive && focus && this.searchInput && !this.checkOpenModals()) {
            requestAnimationFrame(() => {
                if (!this.isSearchActive || !this.searchInput) return;
                if (this.checkOpenModals()) return;
                this.searchInput.focus();
            });
        }
    }

    /**
     * Which state a freshly opened tab starts in. The old `searchActive` key persisted
     * "search box shown" across every tab, so hiding it once stranded every later new tab
     * behind the corner icon. The resting state is now the light line; only an explicit
     * `searchAlwaysVisible` keeps the box open.
     */
    async _initSearchUi() {
        let stored;
        try {
            stored = await chrome.storage.sync.get([
                'searchAlwaysVisible',
                'searchActive',
                'showCornerSearch'
            ]);
        } catch (error) {
            console.warn('[LayoutManager] Failed to read search UI settings:', error);
            return;
        }

        this._alwaysShowSearch = typeof stored.searchAlwaysVisible === 'boolean'
            ? stored.searchAlwaysVisible
            : stored.searchActive === true;

        // The corner icon is optional and secondary to the light line: either it is always
        // there, or it is not there at all. There is no in-between — the reveal-on-hover
        // behaviour belongs to the corner zone as a whole, so "sometimes" would have meant
        // "hidden until the pointer wanders into the corner", which is exactly the
        // discoverability problem the light line exists to remove.
        this._showCornerSearch = stored.showCornerSearch === true;

        try {
            if (typeof stored.searchAlwaysVisible !== 'boolean') {
                await chrome.storage.sync.set({ searchAlwaysVisible: this._alwaysShowSearch });
            }
            if (typeof stored.showCornerSearch !== 'boolean') {
                await chrome.storage.sync.set({ showCornerSearch: this._showCornerSearch });
            }
            if (Object.hasOwn(stored, 'searchActive')) {
                await chrome.storage.sync.remove('searchActive');
            }
        } catch (error) {
            console.warn('[LayoutManager] Failed to persist search UI settings:', error);
        }

        this._persistSearchMirror(this._alwaysShowSearch);
        this._applyCornerSearch(this._showCornerSearch);

        if (this._alwaysShowSearch) {
            this.toggleSearch(true);
        }
    }

    /** Mirror the setting into localStorage so the first-paint script can read it synchronously. */
    _persistSearchMirror(alwaysVisible) {
        const api = globalThis.__AURA_FIRST_PAINT__;
        if (api && typeof api.persistSearchState === 'function') {
            api.persistSearchState(Boolean(alwaysVisible));
            return;
        }

        try {
            localStorage.setItem('lychee:searchAlwaysVisible', alwaysVisible ? '1' : '0');
        } catch {
            // ignore: the mirror only affects the first frame
        }
    }

    _applyCornerSearch(visible) {
        if (!this.cornerBottomRight) return;

        // `disabled` takes the whole corner zone out of the layout, so a hidden search
        // button does not reappear when the pointer passes over the corner.
        this.cornerBottomRight.classList.toggle('disabled', !visible);
        this.cornerBottomRight.classList.toggle('always-visible', Boolean(visible));
    }

    checkOpenModals() {
        if (modalLayer.getTopLevel() > modalLayer.constructor.LEVEL.BASE) {
            return true;
        }

        return Boolean(document.querySelector('[data-modal="true"].active'));
    }

    async refreshBackground() {
        if (!this.backgroundSystem?.refresh) return;

        if (this.refreshBgBtn) {
            this.refreshBgBtn.classList.add('refreshing');
        }

        try {
            await this.backgroundSystem.refresh();
        } catch (error) {
            console.error('Failed to refresh background:', error);
        } finally {
            this._timers.setTimeout('refreshCooldown', () => {
                this.refreshBgBtn?.classList.remove('refreshing');
            }, 500);
        }
    }

}

export function initLayout({ backgroundSystem } = {}) {
    const manager = new LayoutManager({ backgroundSystem });
    void manager.init();
    return manager;
}
