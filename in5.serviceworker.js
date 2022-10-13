let cacheName;
let assets = [];
let shouldUpdate;
let manifestContents;
let newCacheName;

function getHash(text) {
  var hash = 0,
    i,
    chr;
  for (i = 0; i < text.length; i++) {
    chr = text.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; /*Convert to 32bit int*/
  }
  return "c" + hash.toString();
}

function parseManifest(rawManifest) {
  const cache = ["/"];
  self.clients.matchAll({includeUncontrolled: true}).then(clients => {
    for (const client of clients) {
      const {pathname, search} = new URL(client.url);
      cache.push(`${pathname}${search}`)
    }
  });
  const trimmedLines = rawManifest.split(/\r|\n/).map(function (line) {
    return line.trim();
  });
  for (const line of trimmedLines) {
    if (line.startsWith("CACHE MANIFEST") || line.startsWith("#") || line === "") {
      continue;
    }
    if (line.endsWith(":")) {
      break;
    }
    cache.push("assets/" + line);
  }
  return cache;
}

const manifestUrl = new URL("assets/manifest.appcache", location.href).href;

async function getManifest() {
  const init = {
    cache: "reload", // always get uncached version of manifest
    credentials: "include",
    headers: [["X-Use-Fetch", "true"]],
  };
  const manifestRequest = new Request(manifestUrl, init);
  const manifestResponse = await fetch(manifestRequest);
  manifestContents = await manifestResponse.text();
  return manifestContents
}

async function needsUpdate() {
  const keys = await caches.keys();
  cacheName = keys[0];
  try {
    await getManifest();
    newCacheName = getHash(manifestUrl + manifestContents);
    return (newCacheName !== cacheName)
  } catch {
    return false
  }
}

async function cacheAssets() {
  cacheName = newCacheName;
  assets = parseManifest(manifestContents);
  return addCache(assets);
}

function addCache(cacheAssets) {
  return caches.open(cacheName).then(function (cache) {
    return Promise.all(
      cacheAssets.map(function (url) {
        return cache.add(url).catch(function (reason) {
            console.warn([url + "failed: " + String(reason)]);
        });
      })
    );
});
}

function removeCache() {
  return caches.keys().then(function (cacheNames) {
    return Promise.all(
      cacheNames.map(function (cache) {
        if (cache !== cacheName) {
          return caches.delete(cache);
        }
      })
    );
  });
}

self.addEventListener("install", function (e) {
  e.waitUntil(async function(){
    await needsUpdate();
    cacheAssets().then(function () {
      self.skipWaiting();
    })
  }());
});

self.addEventListener("activate", function (e) {
  e.waitUntil(removeCache());
});

self.addEventListener("fetch", e => {
  e.respondWith(
    needsUpdate().then(shouldUpdate => {
      if (shouldUpdate) {
        cacheAssets().then(function () {
          removeCache();
        });
        return fetch(e.request);
      }
      return caches.match(e.request).then(response => {
        if (response) return response;
        return fetch(e.request).catch(() => {});
      })
    })
  );
});