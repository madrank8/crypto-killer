/**
 * ck.js — CryptoKiller first-party analytics tracker (~1 KB gzipped).
 *
 * Hosted on Vercel (https://crypto-killer.vercel.app/ck.js) so updates
 * ship without touching the Replit production site. Install:
 *   <script defer src="https://crypto-killer.vercel.app/ck.js"></script>
 *
 * Sends: pageviews (incl. SPA navigations) + outbound link clicks.
 * No cookies. Per-tab session id in sessionStorage only.
 */
;(function () {
  if (typeof window === 'undefined') return
  // Skip local dev and iframes
  if (/^localhost$|^127\./.test(location.hostname)) return
  if (window.top !== window.self) return
  // Honor common opt-outs
  if (navigator.webdriver) return

  var ENDPOINT = 'https://crypto-killer.vercel.app/api/track'

  var sid = null
  try {
    sid = sessionStorage.getItem('_ck_sid')
    if (!sid) {
      sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
      sessionStorage.setItem('_ck_sid', sid)
    }
  } catch (e) { /* storage blocked — track sessionless */ }

  function send(payload) {
    payload.sid = sid
    var body = JSON.stringify(payload)
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return
    } catch (e) { /* fall through */ }
    try {
      fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
    } catch (e) { /* never break the page */ }
  }

  var lastPath = null
  function pageview() {
    var path = location.pathname
    if (path === lastPath) return
    lastPath = path
    var q = new URLSearchParams(location.search)
    var m = path.match(/^\/([a-z]{2})(\/|$)/)
    send({
      event_type: 'pageview',
      path: path,
      locale: m ? m[1] : 'en',
      referrer: document.referrer || null,
      utm_source: q.get('utm_source'),
      utm_medium: q.get('utm_medium'),
      utm_campaign: q.get('utm_campaign'),
    })
  }

  // SPA navigation support (Next/React routers use pushState)
  var push = history.pushState
  history.pushState = function () {
    push.apply(this, arguments)
    setTimeout(pageview, 0)
  }
  window.addEventListener('popstate', function () { setTimeout(pageview, 0) })

  // Outbound link clicks (CTA / affiliate performance)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]')
    if (!a) return
    var href = a.href || ''
    if (!/^https?:/.test(href)) return
    try {
      var host = new URL(href).hostname
      if (host === location.hostname) return
      send({ event_type: 'click', path: location.pathname, target: href })
    } catch (err) { /* ignore malformed hrefs */ }
  }, { capture: true, passive: true })

  pageview()
})()
