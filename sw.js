/* Service Worker（§7.4 离线：缓存应用壳 + 内容包）。
   无网时除「问 AI」「Gist 同步」外全部功能可用。
   策略：
   - 导航请求：network-first，失败回落缓存的 index.html；
   - 内容包 content/*.json：cache-first（内容包随版本更新，SW 版本号变更时整体刷新）；
   - 静态资源（js/css/字体）：stale-while-revalidate。 */

const VERSION = 'zsb-v1'
const SHELL_CACHE = `${VERSION}-shell`
const CONTENT_CACHE = `${VERSION}-content`
const RUNTIME_CACHE = `${VERSION}-runtime`

const SHELL_ASSETS = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(SHELL_ASSETS).catch(() => undefined)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

function isContent(url) {
  return /\/content\//.test(url.pathname) || /content\/.*\.json$/.test(url.pathname)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // 只处理同源请求（API 调用交给网络层）
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('./index.html', res.clone()).catch(() => undefined)
          return res
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('离线且没有缓存', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
          )
        }
      })(),
    )
    return
  }

  if (isContent(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CONTENT_CACHE)
        const hit = await cache.match(req)
        if (hit) {
          // 后台更新
          fetch(req)
            .then((res) => res.ok && cache.put(req, res.clone()))
            .catch(() => undefined)
          return hit
        }
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone()).catch(() => undefined)
          return res
        } catch {
          return new Response('{}', { status: 504, headers: { 'Content-Type': 'application/json' } })
        }
      })(),
    )
    return
  }

  // 其余静态资源
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE)
      const hit = await cache.match(req)
      const fetching = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => undefined)
          return res
        })
        .catch(() => undefined)
      return hit || (await fetching) || new Response('', { status: 504 })
    })(),
  )
})
