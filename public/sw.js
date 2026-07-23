const OFFLINE_AUDIO_CACHE = "music-locker-audio-v1";
const OFFLINE_AUDIO_PREFIX = "/offline-audio/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("music-locker-shell-"))
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );

  self.clients.claim();
});

function parseSingleByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return null;
  }

  let start;
  let end;

  if (!startText) {
    const suffixLength = Number(endText);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

async function offlineAudioResponse(request) {
  const cache = await caches.open(OFFLINE_AUDIO_CACHE);
  const cachedResponse = await cache.match(request.url);

  if (!cachedResponse) {
    return new Response("Offline track not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const rangeHeader = request.headers.get("Range");

  if (!rangeHeader) {
    return cachedResponse;
  }

  const audioBlob = await cachedResponse.blob();
  const range = parseSingleByteRange(rangeHeader, audioBlob.size);

  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${audioBlob.size}`,
      },
    });
  }

  const body = audioBlob.slice(range.start, range.end + 1, audioBlob.type);
  const headers = new Headers(cachedResponse.headers);
  headers.delete("Content-Encoding");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(body.size));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${audioBlob.size}`);

  if (audioBlob.type) {
    headers.set("Content-Type", audioBlob.type);
  }

  return new Response(body, {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname.startsWith(OFFLINE_AUDIO_PREFIX)
  ) {
    event.respondWith(offlineAudioResponse(event.request));
  }
});
