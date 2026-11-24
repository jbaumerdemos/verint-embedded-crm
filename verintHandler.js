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
//  fixed layer on <body>: it is positioned over the component while on screen and only hidden when the
//  component is removed, so the agent returns to exactly the page they left. With keepAlive="false" the
//  iframe lives inside the component and the page reloads each time the tab is opened.
//
// URL built when popping:
//   callType == MUNI : {base}?channel=..&source_id=..&external_ref=..
//   anything else    : {base}?channel=..&context=reporter&phone=..&source_id=..&external_ref=..

// State that must survive the component being removed and re-created
const KEEP = window.__verintKeep || (window.__verintKeep = { popped: new Set(), frame: null, layer: null });

class VerintIframe extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastSrc = null;       // used when keep-alive is off
    this._popped = new Set();   // used when keep-alive is off
  }

  static get observedAttributes() {
    return ['baseurl', 'idleurl', 'popnewcallsonwidget', 'calltype', 'munivalue',
            'channelkey', 'flexibleid', 'ciscocallid', 'customerphone', 'keepalive'];
  }

  connectedCallback() {
    // Re-show the kept page straight away so there is no flash, then evaluate normally
    if (this.keep() && KEEP.frame && KEEP.frame.getAttribute('src')) this.attachKept(KEEP.frame.getAttribute('src'));
    this.schedule();
  }
  disconnectedCallback() { clearTimeout(this._timer); this.detachKept(); }
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

  // keepAlive is on unless explicitly turned off
  keep() { return !['false', '0', 'no', 'off'].includes(this.val('keepalive').toLowerCase()); }
  popped() { return this.keep() ? KEEP.popped : this._popped; }
  current() { return this.keep() ? (KEEP.frame ? KEEP.frame.getAttribute('src') : null) : this._lastSrc; }

  // ---- keep-alive plumbing (same approach as iframeHandler.js) ----
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
    const slot = this.shadowRoot.firstElementChild;
    this._kept = iframe;
    iframe.style.display = 'block';

    this._stopTracking && this._stopTracking();
    let alive = true;
    let last = '';
    const track = () => {
      if (!alive) return;
      const r = slot.getBoundingClientRect();
      // position:fixed is measured from the nearest ancestor with a transform/filter/contain, not the
      // window, so subtract where the layer (top:0; left:0) actually ended up
      const o = KEEP.layer.getBoundingClientRect();
      const sig = r.left + ',' + r.top + ',' + r.width + ',' + r.height + ',' + o.left + ',' + o.top;
      if (sig !== last) {
        last = sig;
        iframe.style.left = (r.left - o.left) + 'px';
        iframe.style.top = (r.top - o.top) + 'px';
        iframe.style.width = r.width + 'px';
        iframe.style.height = r.height + 'px';
      }
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
    this._stopTracking = () => { alive = false; };
  }

  detachKept() {
    if (this._stopTracking) { this._stopTracking(); this._stopTracking = null; }
    if (this._kept) { this._kept.style.display = 'none'; this._kept = null; }
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
