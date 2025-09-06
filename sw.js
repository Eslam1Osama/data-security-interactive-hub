const CACHE_NAME = 'data-security-hub-v1.0.0';
const STATIC_CACHE_NAME = 'data-security-static-v1.0.0';
const IMAGE_CACHE_NAME = 'data-security-images-v1.0.0';
const API_CACHE_NAME = 'data-security-api-v1.0.0';

// Cache size limits
const MAX_CACHE_SIZE = 50; // Maximum number of items per cache
const MAX_IMAGE_CACHE_SIZE = 20; // Maximum images to cache

const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/logo.svg',
  '/offline.html',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
];

const IMAGE_FILES = [
  '/media/Basic_Concepts.png',
  '/media/Block_Cipher_Modes.png',
  '/media/Digital_Signatures.png',
  '/media/Firewalls_IDS.png'
];

// Cache cleanup utility
async function cleanCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxItems) {
      // Remove oldest entries (simple FIFO)
      const entriesToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(entriesToDelete.map(request => cache.delete(request)));
      console.log(`[SW] Cleaned ${entriesToDelete.length} old entries from ${cacheName}`);
    }
  } catch (error) {
    console.warn(`[SW] Failed to clean cache ${cacheName}:`, error);
  }
}

// Enhanced error handling with null checks and chrome-extension filtering
function isValidRequest(request) {
  try {
    // Filter out chrome-extension URLs that cause cache errors
    if (request.url.startsWith('chrome-extension://')) {
      return false;
    }

    // Check if request is valid
    if (!request || !request.url) {
      return false;
    }

    // Ensure accept header exists before accessing it
    const accept = request.headers ? request.headers.get('accept') : null;
    if (accept && accept.includes('text/html')) {
      return true;
    }

    return true;
  } catch (error) {
    console.warn('Error validating request:', error);
    return false;
  }
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_FILES);
      }),
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        console.log('[SW] Caching image files');
        return cache.addAll(IMAGE_FILES);
      })
    ]).then(() => {
      console.log('[SW] All caches populated');
      return self.skipWaiting();
    }).catch((error) => {
      console.error('[SW] Cache installation failed:', error);
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME &&
              cacheName !== STATIC_CACHE_NAME &&
              cacheName !== IMAGE_CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Cache cleanup complete');
      return self.clients.claim();
    })
  );
});

// Fetch event with enhanced error handling
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Validate request
  if (!isValidRequest(event.request)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response for caching
            const responseToCache = response.clone();

            // Determine which cache to use based on content type
            let cacheName = CACHE_NAME;
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('image/')) {
              cacheName = IMAGE_CACHE_NAME;
            } else if (STATIC_FILES.some(staticFile =>
              event.request.url.includes(staticFile))) {
              cacheName = STATIC_CACHE_NAME;
            }

            caches.open(cacheName)
              .then((cache) => {
                cache.put(event.request, responseToCache);
                // Clean cache after adding new item
                const maxSize = cacheName === IMAGE_CACHE_NAME ? MAX_IMAGE_CACHE_SIZE : MAX_CACHE_SIZE;
                return cleanCache(cacheName, maxSize);
              })
              .catch((error) => {
                console.warn('[SW] Failed to cache response:', error);
              });

            return response;
          })
          .catch((error) => {
            console.warn('[SW] Fetch failed:', error);

            // Return offline fallback for HTML requests
            if (event.request.headers.get('accept') &&
                event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/offline.html');
            }

            // For other requests, return a minimal error response
            return new Response('Offline content not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
      .catch((error) => {
        console.error('[SW] Cache match failed:', error);
        return fetch(event.request);
      })
  );
});

// Message event for cache updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
