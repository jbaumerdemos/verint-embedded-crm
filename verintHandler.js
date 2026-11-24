// verint-iframe: full-page iframe for Verint, driven by WxCC flow (CAD) variables passed as layout attributes.
//
// Behavior
//  - Until something has been shown, loads idleUrl (e.g. the Verint home page).
//  - A new call only changes the page when the flow variable popNewCallsOnWidget is true
//    AND all the required variables are set. Otherwise the call is ignored and the agent
//    stays on whatever page is open (so they can take a call and come back to their work).
//  - Each call id is popped at most once, so attribute re-renders never create duplicates.
//  - The page is never reset when a call ends.
//
// Keep-alive (attribute keepAlive, ON by default; set keepAlive="false" to turn it off)
//  WxCC removes this component when the agent clicks to another tab and builds a new one when they
//  come back, and moving/re-creating an <iframe> reloads it. With keep-alive on, the iframe lives in a
//  fixed layer: it is positioned over the visible component and only hidden when no component is
//  visible, so the agent returns to exactly the page they left. With keepAlive="false" the iframe lives
//  inside the component and the page reloads each time the tab is opened.
//  WxCC can create more than one copy of the component (one may be hidden); only a copy that is
//  actually visible (non-zero size) is allowed to position the shared iframe.
//  Debug: run __verintDebug() in the browser console.
//
// URL built when popping:
//   callType == MUNI : {base}?channel=..&source_id=..&external_ref=..
//   anything else    : {base}?channel=..&context=reporter&phone=..&source_id=..&external_ref=..

// State that must survive the component being removed and re-created
const KEEP = window.__verintKeep || (window.__verintKeep = { popped: new Set(), frame: null, layer: null, owner: null, instances: new Set() });
KEEP.instances = KEEP.instances || new Set();
KEEP.owner = KEEP.owner || null;

const sizeOf = (el) => { const r = el.getBoundingClientRect(); return { r, ok: r.width > 0 && r.height > 0 }; };

window.__verintDebug = () => {
  const f = KEEP.frame, fr = f && f.getBoundingClientRect();
  const cx = f ? fr.left + fr.width / 2 : 0, cy = f ? fr.top + fr.height / 2 : 0;
  const top = f && fr.width > 0 ? document.elementFromPoint(cx, cy) : null;
  return JSON.stringify({
    keepAliveFailed: !!KEEP.failed,
    frameIsOnTopAtCenter: top === f,
    topElementAtCenter: top ? top.nodeName + (top.id ? '#' + top.id : '') : null,
    frame: f ? { src: f.getAttribute('src'), display: f.style.display, rect: [fr.left, fr.top, fr.width, fr.height].map(Math.round) } : null,
    layerParent: KEEP.layer && KEEP.layer.parentNode && (KEEP.layer.parentNode.id || KEEP.layer.parentNode.nodeName),
    owner: KEEP.owner ? [...KEEP.instances].indexOf(KEEP.owner) : null,
    instances: [...KEEP.instances].map((e) => {
      const s = e._slot && e._slot.isConnected ? e._slot.getBoundingClientRect() : null;
      return { connected: e.isConnected, slot: s ? [s.left, s.top, s.width, s.height].map(Math.round) : null, tracking: !!e._tracking };
    }),
  }, null, 1);
};

class VerintIframe extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastSrc = null;       // used when keep-alive is off
    this._popped = new Set();   // used when keep-alive is off
    this._slot = null;
    this._tracking = false;
  }

  static get observedAttributes() {
    return ['baseurl', 'idleurl', 'popnewcallsonwidget', 'calltype', 'munivalue',
            'channelkey', 'flexibleid', 'ciscocallid', 'customerphone', 'keepalive'];
  }

  connectedCallback() {
    KEEP.instances.add(this);
    // Re-show the kept page straight away so there is no flash, then evaluate normally
    if (this.keep() && KEEP.frame && KEEP.frame.getAttribute('src')) this.attachKept(KEEP.frame.getAttribute('src'));
    this.schedule();
  }
  disconnectedCallback() {
    clearTimeout(this._timer);
    this.detachKept();
    KEEP.instances.delete(this);
  }
  attributeChangedCallback(n, o, v) { if (o !== v) this.schedule(); }

  // WxCC updates attributes one at a time when a new call arrives, so for a moment the new call id
  // can sit next to the previous call's other variables. Wait for the burst to settle before deciding.
  schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.render(), 300);
  }

  // Attribute value, or '' while it is unset / still an unresolved $STORE path / null-ish
  val(name) {
    const v = (this.getAttribute(name) || '').trim();
    if (!v || v === 'null' || v === 'undefined' || v.startsWith('$STORE')) return '';
    return v;
  }

  // keepAlive is on unless explicitly turned off, or unless the shared iframe failed to line up with the
  // widget area (see place()), in which case we fall back to the plain in-widget iframe
  keep() { return !KEEP.failed && !['false', '0', 'no', 'off'].includes(this.val('keepalive').toLowerCase()); }
  popped() { return this.keep() ? KEEP.popped : this._popped; }
  current() { return this.keep() ? (KEEP.frame ? KEEP.frame.getAttribute('src') : null) : (this._lastSrc || this._fallbackSrc || null); }

  // ---- keep-alive plumbing ----
  // Nearest ancestor (crossing shadow roots) that forms its own stacking context, so the kept iframe
  // paints below the Desktop's popups and never covers call alerts.
  findStackingParent() {
    let n = this;
    while (n) {
      n = n.assignedSlot || n.parentElement || (n.getRootNode() && n.getRootNode().host) || null;
      if (!n || n === document.body || n === document.documentElement) break;
      const c = getComputedStyle(n);
      const ctx = c.isolation === 'isolate'
        || (c.position !== 'static' && c.zIndex !== 'auto')
        || c.transform !== 'none' || c.filter !== 'none'
        || parseFloat(c.opacity) < 1
        || /paint|layout/.test(c.contain);
      if (ctx) return n.shadowRoot || n;
    }
    return document.body;
  }

  keepLayer() {
    if (!KEEP.layer || !KEEP.layer.isConnected) {
      const layer = document.createElement('div');
      layer.id = 'verint-keepalive-layer';
      layer.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:0;';
      this.findStackingParent().appendChild(layer);
      KEEP.layer = layer;
    }
    return KEEP.layer;
  }

  attachKept(src) {
    const layer = this.keepLayer();
    let iframe = KEEP.frame;
    if (!iframe || !iframe.isConnected) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('allow', 'camera;microphone');
      iframe.style.cssText = 'position:fixed;border:none;display:none;background:#fff;';
      layer.appendChild(iframe);
      KEEP.frame = iframe;
    }
    if (iframe.getAttribute('src') !== src) {
      console.log('[verint-iframe] loading', src);
      iframe.setAttribute('src', src);
    }

    this.shadowRoot.innerHTML = '<div style="width:100%;height:100%;min-height:400px;"></div>';
    this._slot = this.shadowRoot.firstElementChild;
    this.startTracking();
  }

  // Each copy of the component runs a small loop; the visible one positions the shared iframe over itself
  startTracking() {
    if (this._tracking) return;
    this._tracking = true;
    const loop = () => {
      if (!this._tracking) return;
      this.place();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stopTracking() {
    this._tracking = false;
    if (KEEP.owner === this) {
      KEEP.owner = null;
      if (KEEP.frame) KEEP.frame.style.display = 'none';
    }
  }

  detachKept() { this.stopTracking(); }

  place() {
    const frame = KEEP.frame;
    if (!frame || !this._slot) return;
    const { r, ok } = this._slot.isConnected ? sizeOf(this._slot) : { r: null, ok: false };

    if (!this.isConnected || !ok) {
      // This copy is hidden or has no size: give up control and hide the iframe if we were driving it
      if (KEEP.owner === this) { KEEP.owner = null; frame.style.display = 'none'; }
      return;
    }
    if (KEEP.owner !== this) {
      const ow = KEEP.owner;
      const ownerVisible = ow && ow.isConnected && ow._slot && ow._slot.isConnected && sizeOf(ow._slot).ok;
      if (ownerVisible) return;       // another visible copy already controls the iframe
      KEEP.owner = this;
    }

    // position:fixed is measured from the nearest ancestor with a transform/filter/contain, not the
    // window, so subtract where the layer (top:0; left:0) actually ended up
    const o = KEEP.layer.getBoundingClientRect();
    frame.style.display = 'block';
    frame.style.left = (r.left - o.left) + 'px';
    frame.style.top = (r.top - o.top) + 'px';
    frame.style.width = r.width + 'px';
    frame.style.height = r.height + 'px';
    this.verify(frame, r);
  }

  // Safety net: if the iframe does not end up where we put it (something overrides its size or position),
  // switch to the plain in-widget iframe so the agent still sees the page instead of a blank area.
  verify(frame, r) {
    const f = frame.getBoundingClientRect();
    const off = Math.abs(f.left - r.left) > 2 || Math.abs(f.top - r.top) > 2 ||
                Math.abs(f.width - r.width) > 2 || Math.abs(f.height - r.height) > 2;
    if (!off) { this._badSince = 0; return; }
    const now = Date.now();
    if (!this._badSince) { this._badSince = now; return; }
    if (now - this._badSince < 1500) return;
    console.warn('[verint-iframe] keep-alive iframe does not line up with the widget area; falling back to the in-widget iframe',
      { wanted: [r.left, r.top, r.width, r.height].map(Math.round), got: [f.left, f.top, f.width, f.height].map(Math.round) });
    const src = frame.getAttribute('src');
    KEEP.failed = true;
    KEEP.owner = null;
    frame.style.display = 'none';
    for (const e of KEEP.instances) {
      e._tracking = false;
      e._popped = new Set(KEEP.popped);   // remember which calls were already shown
      e._lastSrc = null;
      e._fallbackSrc = src;
      e.render();
    }
  }

  // ---- display ----
  empty(msg) {
    this.detachKept();
    this._lastSrc = null;
    this.shadowRoot.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:200px;' +
      'font-family:sans-serif;color:#6b7280;padding:16px;text-align:center;">' + msg + '</div>';
  }

  load(src) {
    if (this.keep()) return this.attachKept(src);
    this.detachKept();
    if (src === this._lastSrc) return;
    this._lastSrc = src;
    console.log('[verint-iframe] loading', src);
    this.shadowRoot.innerHTML =
      '<style>:host{display:block;width:100%;height:100%;min-height:400px;}' +
      'iframe{width:100%;height:100%;min-height:400px;border:none;background:#fff;}</style>' +
      '<iframe src="' + src.replace(/"/g, '%22') + '" allow="camera;microphone"></iframe>';
  }

  render() {
    const base = this.val('baseurl');
    if (!/^https:\/\//i.test(base)) return this.empty('Verint baseUrl is invalid');

    // Anything that does not look like a real id ('', '{}', '""', '[object Object]') counts as "no call"
    const rawId = this.val('ciscocallid');
    const callId = /^[A-Za-z0-9._:-]{6,}$/.test(rawId) ? rawId : '';
    const pop = ['true', '1', 'yes'].includes(this.val('popnewcallsonwidget').toLowerCase());
    const popped = this.popped();
    console.log('[verint-iframe] render', { callId, popNewCallsOnWidget: this.getAttribute('popnewcallsonwidget'), pop, keepAlive: this.keep() });

    if (callId && pop && !popped.has(callId)) {
      const muniValue = (this.val('munivalue') || 'MUNI').toUpperCase();
      const isMuni = this.val('calltype').toUpperCase() === muniValue;
      const channel = this.val('channelkey');
      const sourceId = this.val('flexibleid');
      const phone = this.val('customerphone');

      const missing = [];
      if (!channel) missing.push('Channel_Key');
      if (!sourceId) missing.push('Flexible_Id');
      if (!isMuni && !phone) missing.push('Customer_Phone');

      if (missing.length === 0) {
        const p = new URLSearchParams();
        p.set('channel', channel);
        if (!isMuni) {
          p.set('context', 'reporter');
          p.set('phone', phone);
        }
        p.set('source_id', sourceId);
        p.set('external_ref', callId);
        popped.add(callId);
        return this.load(base + (base.includes('?') ? '&' : '?') + p.toString());
      }
      // Variables can arrive one at a time, so keep waiting and re-check on the next attribute change
      console.log('[verint-iframe] waiting for variables:', missing.join(', '));
    } else if (callId && !pop) {
      console.log('[verint-iframe] call ignored: popNewCallsOnWidget is not true; staying on current page');
    }

    // Nothing popped: keep showing the current page. Show the idle page only if none has been shown yet.
    const cur = this.current();
    if (cur) return this.load(cur);
    const idle = this.val('idleurl');
    if (/^https:\/\//i.test(idle)) return this.load(idle);
    return this.empty('Waiting for an active call…');
  }
}

if (!customElements.get('verint-iframe')) customElements.define('verint-iframe', VerintIframe);
