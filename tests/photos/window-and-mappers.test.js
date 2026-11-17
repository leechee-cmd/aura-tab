/**
 * The photos window: its grid and tabs, favorites ordering, the photo-info panel, and the
 * mappers that turn a library entry or a local file into a wallpaper item.
 *
 * The window-categories and favorites-ordering suites carried copy-paste copies of the same
 * DOM harness and of the `libraryItems` / `localFiles` / requestIdleCallback doubles. They
 * were renamed per section rather than shared: sharing would put one suite's fixtures in
 * front of the other's assertions, which is exactly the drift that merging is supposed to
 * stop hiding.
 *
 * Sources merged here (git history of the individual files is gone, this list is the
 * replacement for `git log --follow`):
 *   tests/photos/photos.test.js
 *   tests/photos/photos-window-categories.test.js
 *   tests/photos/photos-favorites-order.test.js
 *   tests/photos/photos-mapper-bing-thumb.test.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutManager } from '../../scripts/domains/layout.js';
import { PhotosWindow } from '../../scripts/domains/photos/window.js';
import { libraryStore } from '../../scripts/domains/backgrounds/library-store.js';
import { localFilesManager } from '../../scripts/domains/backgrounds/source-local.js';
import { favoriteToWallpaperItem, libraryRemoteToWallpaperItem } from '../../scripts/domains/photos/mappers.js';

// ===== from tests/photos/photos.test.js =====
function mountPhotosDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="mac-window photos-window" id="photosWindow"></div>
        </div>
    `;
}

function setupPhotoInfoDom() {
    document.body.innerHTML = `
        <div class="corner-zone corner-top-right" id="cornerTopRight">
            <div class="photo-info hidden" id="photoInfo">
                <a class="photo-author" id="photoAuthor" href="#">
                    <span class="author-prefix"></span><span class="author-name" id="authorName"></span>
                </a>
                <button id="favoriteBgBtn"><svg class="favorite-icon-empty"></svg><svg class="favorite-icon-filled hidden"></svg></button>
                <button id="downloadBgBtn"></button>
            </div>
        </div>
        <div class="corner-zone corner-top-left" id="cornerTopLeft"></div>
    `;
}

describe('photos domain', () => {
    const helpers = {
        isAppendableRemoteUrl: (url) => /^https?:\/\//.test(url),
        buildUrlWithParams: (url, params) => {
            const qs = new URLSearchParams(params);
            return `${url}?${qs.toString()}`;
        }
    };

    it('favoriteToWallpaperItem builds provider thumbnail defaults', () => {
        const item = favoriteToWallpaperItem({
            id: 'u1',
            provider: 'unsplash',
            urls: { raw: 'https://images.unsplash.com/photo-x' },
            username: 'Aura'
        }, helpers);

        expect(item.id).toBe('u1');
        expect(item.thumbnail).toContain('w=360');
        expect(item.isFavorited).toBe(true);
    });

    it('libraryRemoteToWallpaperItem maps remote record via favorite pipeline', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'lib1',
            provider: 'pexels',
            remote: {
                rawUrl: 'https://images.pexels.com/abc',
                thumbParams: '?w=280&q=50'
            },
            username: 'tester'
        }, helpers);

        expect(item.id).toBe('lib1');
        expect(item.provider).toBe('pexels');
        expect(item.thumbnail).toContain('w=360');
    });

    it('libraryRemoteToWallpaperItem prefers downloadUrl as full source', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'lib2',
            provider: 'unsplash',
            remote: {
                rawUrl: 'https://images.unsplash.com/cropped?w=1280&h=720&fit=crop',
                downloadUrl: 'https://images.unsplash.com/photo-original',
                thumbParams: '?w=280&q=50'
            },
            username: 'tester'
        }, helpers);

        expect(item.fullImage).toBe('https://images.unsplash.com/photo-original');
    });

    it('does not throw when PhotosWindow opens from fresh state', async () => {
        mountPhotosDom();
        const { photosWindow } = await import('../../scripts/domains/photos/window.js');

        try {
            expect(() => photosWindow.open()).not.toThrow();

            const overlay = document.getElementById('photosOverlay');
            expect(overlay).toBeTruthy();
            expect(overlay.classList.contains('visible')).toBe(true);
            expect(overlay.getAttribute('aria-hidden')).toBe('false');
        } finally {
            photosWindow.close();
        }
    });

    it('cancels deferred window work when closed', async () => {
        vi.useFakeTimers();
        mountPhotosDom();
        const { getPhotosWindow } = await import('../../scripts/domains/photos/window.js');
        const instance = getPhotosWindow();
        const statsSpy = vi.spyOn(instance, '_updateStorageStats').mockResolvedValue(undefined);

        try {
            instance.open();
            instance.close();
            await vi.runAllTimersAsync();
            expect(statsSpy).not.toHaveBeenCalled();
        } finally {
            statsSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    describe('photo info visibility', () => {
        beforeEach(() => {
            setupPhotoInfoDom();
        });

        it('does not disable top-right corner based on backgroundSettings.type', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ username: 'Alice', page: 'https://example.com' })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'files', showPhotoInfo: true });

            const cornerTopRight = document.getElementById('cornerTopRight');
            expect(cornerTopRight?.classList.contains('disabled')).toBe(false);
            expect(cornerTopRight?.classList.contains('always-visible')).toBe(true);

            await layout._updatePhotoInfo();

            const authorName = document.getElementById('authorName');
            const photoAuthor = document.getElementById('photoAuthor');
            const photoInfo = document.getElementById('photoInfo');

            expect(authorName?.textContent).toBe('Alice');
            expect(photoAuthor?.getAttribute('href')).toBe('https://example.com');
            expect(photoInfo?.classList.contains('hidden')).toBe(false);
        });

        it('uses the newly applied background instead of stale controller state', async () => {
            document.body.insertAdjacentHTML('afterbegin', `
                <div class="layout-container"></div>
                <div id="searchContainer"></div>
                <input id="searchInput">
            `);
            const previous = { id: 'favorite-old', username: 'Old author', page: 'https://old.example' };
            const applied = { id: 'fresh-new', username: 'New author', page: 'https://new.example' };
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => previous
            };
            const layout = new LayoutManager({ backgroundSystem });
            const favoriteSpy = vi.spyOn(layout, '_updateFavoriteButtonState').mockResolvedValue(undefined);

            try {
                await layout.init();
                favoriteSpy.mockClear();

                window.dispatchEvent(new CustomEvent('background:applied', {
                    detail: { background: applied }
                }));

                await vi.waitFor(() => {
                    expect(favoriteSpy).toHaveBeenCalledWith(applied, expect.any(Number));
                });
                expect(document.getElementById('authorName').textContent).toBe('New author');
            } finally {
                layout.destroy();
                favoriteSpy.mockRestore();
            }
        });

        it('does not let an older photo-info update overwrite a newer background', async () => {
            let releaseOlder;
            const olderReady = new Promise((resolve) => {
                releaseOlder = resolve;
            });
            const backgroundSystem = {
                whenReady: vi.fn()
                    .mockReturnValueOnce(olderReady)
                    .mockResolvedValueOnce(undefined),
                getCurrentBackground: vi.fn()
            };
            const layout = new LayoutManager({ backgroundSystem });
            const favoriteSpy = vi.spyOn(layout, '_updateFavoriteButtonState').mockResolvedValue(undefined);
            const older = { id: 'older', username: 'Older', page: 'https://older.example' };
            const newer = { id: 'newer', username: 'Newer', page: 'https://newer.example' };

            try {
                const olderUpdate = layout._updatePhotoInfo(older);
                const newerUpdate = layout._updatePhotoInfo(newer);
                await newerUpdate;
                releaseOlder();
                await olderUpdate;

                expect(document.getElementById('authorName').textContent).toBe('Newer');
                expect(favoriteSpy).toHaveBeenLastCalledWith(newer, expect.any(Number));
            } finally {
                favoriteSpy.mockRestore();
            }
        });

        it('removes author link href when no page URL is provided', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ username: 'Bob', page: '' })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'unsplash', showPhotoInfo: true });
            await layout._updatePhotoInfo();

            const photoAuthor = document.getElementById('photoAuthor');
            const photoInfo = document.getElementById('photoInfo');

            expect(photoAuthor?.hasAttribute('href')).toBe(false);
            expect(photoAuthor?.getAttribute('aria-disabled')).toBe('true');
            expect(photoInfo?.classList.contains('hidden')).toBe(false);
        });

        it('hides photo info when current background has no author metadata', async () => {
            const backgroundSystem = {
                whenReady: () => Promise.resolve(),
                getCurrentBackground: () => ({ id: 'local-1', file: { name: 'x.jpg' } })
            };
            const layout = new LayoutManager({ backgroundSystem });

            layout._applyBackgroundVisibilitySettings({ type: 'unsplash', showPhotoInfo: true });
            await layout._updatePhotoInfo();

            const authorName = document.getElementById('authorName');
            const photoInfo = document.getElementById('photoInfo');

            expect(authorName?.textContent).toBe('');
            expect(photoInfo?.classList.contains('hidden')).toBe(true);
        });
    });
});

// ===== from tests/photos/photos-window-categories.test.js =====
let categoryLibraryItems = [];
let categoryLocalFiles = [];
let categoryOriginalRIC;
let categoryOriginalCIC;

function mountCategoriesDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="mac-window photos-window" id="photosWindow"></div>
        </div>
    `;
}

describe('photos window categories', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        categoryLibraryItems = [];
        categoryLocalFiles = [];
        mountCategoriesDom();
        categoryOriginalRIC = global.requestIdleCallback;
        categoryOriginalCIC = global.cancelIdleCallback;
        global.IntersectionObserver = class {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
        global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
        global.cancelIdleCallback = (id) => clearTimeout(id);
        vi.spyOn(libraryStore, 'init').mockResolvedValue();
        vi.spyOn(libraryStore, 'getAll').mockImplementation(({ provider } = {}) => {
            if (provider) {
                return categoryLibraryItems.filter((item) => item.provider === provider);
            }
            return [...categoryLibraryItems];
        });
        vi.spyOn(localFilesManager, 'init').mockResolvedValue();
        vi.spyOn(localFilesManager, 'getAllFiles').mockImplementation(async () => [...categoryLocalFiles]);
        vi.spyOn(localFilesManager, 'getAllFileIds').mockImplementation(async () => categoryLocalFiles.map((file) => file.id));
        vi.spyOn(localFilesManager, 'getFile').mockImplementation(async (id) => categoryLocalFiles.find((file) => file.id === id) || null);
        vi.spyOn(localFilesManager, 'selectFile').mockResolvedValue();
        vi.spyOn(localFilesManager, 'getSelectedFile').mockResolvedValue(null);
    });

    afterEach(() => {
        global.requestIdleCallback = categoryOriginalRIC;
        global.cancelIdleCallback = categoryOriginalCIC;
    });

    it('renders bing tab and count slot', async () => {
        categoryLibraryItems = [
            {
                id: 'bing-1',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            }
        ];

        const photosWindow = new PhotosWindow();
        await photosWindow._updateAllCounts();

        expect(document.querySelector('[data-category="bing"]')).toBeTruthy();
        expect(document.getElementById('count-bing')).toBeTruthy();
        expect(document.getElementById('count-bing')?.textContent).toBe('1');
        expect(document.querySelector('[data-category="bing"] .mac-menu-item-icon--bing')).toBeTruthy();
    });

    it('renders compact storage status with used size and clear action', () => {
        const photosWindow = new PhotosWindow();
        void photosWindow;

        expect(document.querySelector('.photos-storage-stats')).toBeTruthy();
        expect(document.querySelector('.photos-storage-meta')).toBeTruthy();
        expect(document.querySelector('.photos-storage-used')).toBeTruthy();
        expect(document.querySelector('.photos-storage-clear')).toBeTruthy();
        expect(document.querySelector('.photos-storage-bar')).toBeFalsy();
        expect(document.querySelector('#photosStorageTotal')).toBeFalsy();
    });

    it('renders empty state icon that matches the selected category', async () => {
        const photosWindow = new PhotosWindow();
        await photosWindow._renderCategory('bing');

        const emptyIcon = document.querySelector('.photos-empty-icon svg');
        expect(emptyIcon?.getAttribute('viewBox')).toBe('0 0 1024 1024');
    });

    it('filters bing category to bing favorites only', async () => {
        categoryLibraryItems = [
            {
                id: 'bing-1',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Bing_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Bing_1920x1080.jpg&pid=hp',
                    smallUrl: 'https://www.bing.com/th?id=OHR.Bing_1366x768.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            },
            {
                id: 'unsplash-1',
                kind: 'remote',
                provider: 'unsplash',
                remote: {
                    rawUrl: 'https://images.unsplash.com/photo-1',
                    downloadUrl: 'https://images.unsplash.com/photo-1'
                },
                favoritedAt: '2026-02-26T10:00:00.000Z'
            }
        ];

        const photosWindow = new PhotosWindow();
        await photosWindow._renderCategory('bing');

        const ids = Array.from(document.querySelectorAll('.photos-card'))
            .map((card) => card.getAttribute('data-wallpaper-id'));
        expect(ids).toEqual(['bing-1']);
    });

    it('defers external library refresh while a local mutation is in flight', async () => {
        const photosWindow = new PhotosWindow();
        photosWindow._isOpen = true;
        photosWindow._hotReloadInFlight = 1;
        const refreshSpy = vi.spyOn(photosWindow, '_refreshAfterStateChange').mockResolvedValue();

        photosWindow._handleLibraryItemsStorageChange();

        expect(photosWindow._pendingExternalRefresh).toBe(true);
        expect(refreshSpy).not.toHaveBeenCalled();

        photosWindow._finishHotReload();
        await vi.waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
        expect(refreshSpy).toHaveBeenCalledWith({ context: 'external' });
        expect(photosWindow._pendingExternalRefresh).toBe(false);
    });
});

// ===== from tests/photos/photos-favorites-order.test.js =====
let favoriteLibraryItems = [];
let favoriteLocalFiles = [];
let favoriteOriginalRIC;
let favoriteOriginalCIC;

function mountFavoritesDom() {
    document.body.innerHTML = `
        <div class="mac-window-overlay" id="photosOverlay" data-modal="true" role="dialog" aria-modal="true" aria-hidden="true">
            <div class="mac-window photos-window" id="photosWindow"></div>
        </div>
    `;
}

describe('photos favorites ordering', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        favoriteLibraryItems = [];
        favoriteLocalFiles = [];
        mountFavoritesDom();
        favoriteOriginalRIC = global.requestIdleCallback;
        favoriteOriginalCIC = global.cancelIdleCallback;
        global.IntersectionObserver = class {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
        global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
        global.cancelIdleCallback = (id) => clearTimeout(id);
        vi.spyOn(libraryStore, 'init').mockResolvedValue();
        vi.spyOn(libraryStore, 'getAll').mockImplementation(({ provider } = {}) => {
            if (provider) {
                return favoriteLibraryItems.filter((item) => item.provider === provider);
            }
            return [...favoriteLibraryItems];
        });
        vi.spyOn(localFilesManager, 'init').mockResolvedValue();
        vi.spyOn(localFilesManager, 'getAllFiles').mockImplementation(async () => [...favoriteLocalFiles]);
        vi.spyOn(localFilesManager, 'getAllFileIds').mockImplementation(async () => favoriteLocalFiles.map((file) => file.id));
    });

    afterEach(() => {
        global.requestIdleCallback = favoriteOriginalRIC;
        global.cancelIdleCallback = favoriteOriginalCIC;
    });

    it('orders favorites by favoritedAt desc across remote and local', async () => {
        favoriteLibraryItems = [
            {
                id: 'old-unsplash',
                kind: 'remote',
                provider: 'unsplash',
                remote: {
                    rawUrl: 'https://images.unsplash.com/photo-old',
                    downloadUrl: 'https://images.unsplash.com/photo-old'
                },
                favoritedAt: '2026-02-20T10:00:00.000Z'
            },
            {
                id: 'local-fav',
                kind: 'local',
                provider: 'files',
                localFileId: 'local-1',
                favoritedAt: '2026-02-26T10:00:00.000Z'
            },
            {
                id: 'new-bing',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.New_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.New_1920x1080.jpg&pid=hp',
                    smallUrl: 'https://www.bing.com/th?id=OHR.New_1366x768.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            }
        ];

        favoriteLocalFiles = [
            {
                id: 'local-1',
                urls: { small: 'blob:local-1-small', full: 'blob:local-1-full' }
            }
        ];

        const photosWindow = new PhotosWindow();
        const allFavorites = await photosWindow._getFavoriteItems();

        expect(allFavorites.map((item) => item.id)).toEqual(['new-bing', 'local-1', 'old-unsplash']);

        const bingOnly = await photosWindow._getFavoriteItems('bing');
        expect(bingOnly.map((item) => item.id)).toEqual(['new-bing']);
    });

    it('pushes invalid favoritedAt records to the end', async () => {
        favoriteLibraryItems = [
            {
                id: 'good-new',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Good_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Good_1920x1080.jpg&pid=hp'
                },
                favoritedAt: '2026-02-27T10:00:00.000Z'
            },
            {
                id: 'bad-date',
                kind: 'remote',
                provider: 'bing',
                remote: {
                    rawUrl: 'https://www.bing.com/th?id=OHR.Bad_1920x1080.jpg&pid=hp',
                    downloadUrl: 'https://www.bing.com/th?id=OHR.Bad_1920x1080.jpg&pid=hp'
                },
                favoritedAt: 'not-a-valid-date'
            }
        ];

        const photosWindow = new PhotosWindow();
        const items = await photosWindow._getFavoriteItems('bing');

        expect(items.map((item) => item.id)).toEqual(['good-new', 'bad-date']);
    });
});

// ===== from tests/photos/photos-mapper-bing-thumb.test.js =====
const helpers = {
    isAppendableRemoteUrl: (url) => /^https?:\/\//.test(url),
    buildUrlWithParams: (url, params) => {
        const u = new URL(url);
        for (const [key, value] of Object.entries(params || {})) {
            u.searchParams.set(key, String(value));
        }
        return u.toString();
    }
};

describe('photos mapper bing thumbnail', () => {
    it('prefers stored smallUrl for bing thumbnail', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'bing-small',
            provider: 'bing',
            remote: {
                rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                smallUrl: 'https://www.bing.com/th?id=OHR.Test_1366x768.jpg&pid=hp',
                thumbParams: '?w=300&q=70&auto=format'
            }
        }, helpers);

        expect(item.thumbnail).toBe('https://www.bing.com/th?id=OHR.Test_1366x768.jpg&pid=hp');
    });

    it('appends thumb params safely when bing has no smallUrl', () => {
        const item = libraryRemoteToWallpaperItem({
            id: 'bing-fallback',
            provider: 'bing',
            remote: {
                rawUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                downloadUrl: 'https://www.bing.com/th?id=OHR.Test_1920x1080.jpg&pid=hp',
                thumbParams: '?w=300&q=70&auto=format'
            }
        }, helpers);

        const url = new URL(item.thumbnail);
        expect(url.searchParams.get('pid')).toBe('hp');
        expect(url.searchParams.get('w')).toBe('300');
        expect(url.searchParams.get('q')).toBe('70');
        expect(url.searchParams.get('auto')).toBe('format');
        expect(item.thumbnail).not.toContain('??');
    });
});
