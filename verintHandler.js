// verintHandler.js: <verint-iframe>, a copy of iframeHandler.js (<iframe-component>) adjusted for Verint.
// Every change from iframeHandler.js is marked "VERINT:". Everything else is unchanged.
//
// VERINT: what this adds
//  - idleUrl: the page shown when the tab opens (iframeHandler's frameURL).
//  - Screen pop: when the flow variable popNewCallsOnWidget is true AND the required variables are set,
//    a new call opens {baseUrl}?channel=..[&context=reporter&phone=..]&source_id=..&external_ref=..
//    (context and phone are left out when callType equals muniValue, default MUNI).
//    Otherwise the call is ignored and the open page is left alone.
//  - Each call is popped once (remembered for the whole Desktop session), so returning to the tab or
//    attribute updates never create a duplicate interaction.
//  - keepAlive: opt-in exactly like iframeHandler (keepAlive="true").

class VerintIframeComponent extends HTMLElement {                      // VERINT: own class name (both scripts can load together)
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);                                         // VERINT
    this.detachKept();
  }

  // VERINT: watch the call variables too (iframeHandler only watches frameurl)
  static get observedAttributes() {
    return ['idleurl', 'baseurl', 'popnewcallsonwidget', 'calltype', 'munivalue',
            'channelkey', 'flexibleid', 'ciscocallid', 'customerphone'];
  }

  // ── Keep-alive mode (opt-in with the attribute keepAlive="true") ─────────
  // Moving or re-creating an <iframe> reloads it, so a kept iframe lives
  // permanently in a fixed layer on <body>. While this component is on screen
  // the iframe is positioned over the component; when WxCC detaches the
  // component (user navigates to another page) the iframe is only hidden, so
  // its page state survives and nothing reloads on return.
  isKeepAlive() {
    const v = (this.getAttribute('keepAlive') || '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  // Nearest ancestor (crossing shadow roots) that forms its own stacking
  // context. Everything inside it paints below the Desktop's popups, which sit
  // outside it, so the kept iframe never covers the wrap-up list or call alerts.
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

  keepAliveStore() {
    // VERINT: own store and layer id, so it never shares state with iframe-component
    const s = window.__verintKeepAlive || (window.__verintKeepAlive = { frames: new Map(), layer: null });
    if (!s.layer || !s.layer.isConnected) {
      const layer = document.createElement('div');
      layer.id = 'verint-keepalive-layer';
      layer.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:0;';
      this.findStackingParent().appendChild(layer);
      s.layer = layer;
    }
    return s;
  }

  attachKept(finalURL, key) {
    const store = this.keepAliveStore();
    // Optional per-page override: keepAliveZ="5" (z-index inside the layer's context)
    const z = (this.getAttribute('keepAliveZ') || '').trim();
    if (/^-?\d+$/.test(z)) store.layer.style.zIndex = z;
    let iframe = store.frames.get(key);
    if (!iframe || !iframe.isConnected) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('allow', 'camera;microphone');
      iframe.style.cssText = 'position:fixed;border:none;display:none;background:#fff;';
      store.layer.appendChild(iframe);
      store.frames.set(key, iframe);
    }
    // Only reload when the target actually changed (e.g. a different ANI)
    if (iframe.getAttribute('src') !== finalURL) {
      iframe.setAttribute('src', finalURL);
    }

    this.shadowRoot.innerHTML = '<div style="width:100%;height:100%;"></div>';
    const slot = this.shadowRoot.firstElementChild;
    this._keptFrame = iframe;
    // VERINT: no "display = block" here; the tracker shows the iframe once this copy has a real size

    this._stopTracking && this._stopTracking();
    let alive = true;
    let last = '';
    const track = () => {
      if (!alive) return;
      const r = slot.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // VERINT: only a copy that is actually on screen positions the shared iframe. The Desktop can
        // create a second, hidden copy (0 x 0); before this change it shrank the iframe to 0 x 0.
        // VERINT: position:fixed is measured from the nearest ancestor with a transform, not the
        // window, so subtract where the layer (top:0; left:0) really is.
        const o = store.layer.getBoundingClientRect();
        const sig = r.left + ',' + r.top + ',' + r.width + ',' + r.height + ',' + o.left + ',' + o.top;
        iframe._placer = this;
        iframe.style.display = 'block';
        if (sig !== last) {
          last = sig;
          iframe.style.left = (r.left - o.left) + 'px';
          iframe.style.top = (r.top - o.top) + 'px';
          iframe.style.width = r.width + 'px';
          iframe.style.height = r.height + 'px';
        }
      } else if (iframe._placer === this) {
        // VERINT: this copy was showing the iframe and has gone off screen: hide it
        iframe.style.display = 'none';
        iframe._placer = null;
        last = '';
      }
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
    this._stopTracking = () => { alive = false; };
  }

  detachKept() {
    if (this._stopTracking) { this._stopTracking(); this._stopTracking = null; }
    if (this._keptFrame) {
      // VERINT: only the copy that is showing the iframe hides it (a hidden copy going away must not)
      if (this._keptFrame._placer === this) { this._keptFrame.style.display = 'none'; this._keptFrame._placer = null; }
      this._keptFrame = null;
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue) {
      // VERINT: wait briefly. When a call arrives the Desktop updates the variables one at a time, so for
      // a moment the new call id can sit next to the previous call's other values.
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.render(), 300);
    }
  }

  isValidUrl(value) {
    if (!value) return false;
    const v = value.trim();
    if (v === '') return false;
    if (v === 'null' || v === 'undefined') return false;
    if (v.startsWith('$STORE')) return false;
    return /^https?:\/\//i.test(v);
  }

  // VERINT: attribute value, or '' while unset / an unresolved $STORE path / null-ish
  val(name) {
    const v = (this.getAttribute(name) || '').trim();
    if (!v || v === 'null' || v === 'undefined' || v.startsWith('$STORE')) return '';
    return v;
  }

  // VERINT: replaces iframeHandler's "frameURL + every attribute as a query parameter".
  // Returns the page to show: a new pop, else the page already open, else idleUrl.
  targetURL() {
    const popped = window.__verintPopped || (window.__verintPopped = new Set());
    const rawId = this.val('ciscoCallId');
    const callId = /^[A-Za-z0-9._:-]{6,}$/.test(rawId) ? rawId : '';   // ignore '', '{}', '[object Object]'
    const pop = ['true', '1', 'yes'].includes(this.val('popNewCallsOnWidget').toLowerCase());

    if (callId && pop && !popped.has(callId)) {
      const base = this.val('baseUrl');
      const isMuni = this.val('callType').toUpperCase() === (this.val('muniValue') || 'MUNI').toUpperCase();
      const channel = this.val('channelKey');
      const sourceId = this.val('flexibleId');
      const phone = this.val('customerPhone');
      const missing = [];
      if (!this.isValidUrl(base)) missing.push('baseUrl');
      if (!channel) missing.push('Channel_Key');
      if (!sourceId) missing.push('Flexible_Id');
      if (!isMuni && !phone) missing.push('Customer_Phone');
      if (missing.length === 0) {
        const p = new URLSearchParams();
        p.set('channel', channel);
        if (!isMuni) { p.set('context', 'reporter'); p.set('phone', phone); }
        p.set('source_id', sourceId);
        p.set('external_ref', callId);
        popped.add(callId);
        console.log('[verint-iframe] pop for call', callId);
        return base.trim() + (base.includes('?') ? '&' : '?') + p.toString();
      }
      console.log('[verint-iframe] pop is on but waiting for:', missing.join(', '));
    } else if (callId && !pop) {
      console.log('[verint-iframe] call', callId, 'ignored (popNewCallsOnWidget is not true); keeping the open page');
    }

    // No pop: keep what is open (kept iframe, or this copy's page), otherwise the idle page
    if (this.isKeepAlive()) {
      const kept = window.__verintKeepAlive && window.__verintKeepAlive.frames.get('verint');
      if (kept && kept.getAttribute('src')) return kept.getAttribute('src');
    } else if (this._shown) {
      return this._shown;
    }
    const idle = this.getAttribute('idleUrl');
    return this.isValidUrl(idle) ? idle.trim() : null;
  }

  renderEmptyState(message) {
    this.shadowRoot.innerHTML = `
      <style>
        .empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          font-family: sans-serif;
          color: #6b7280;
          padding: 16px;
          text-align: center;
        }
      </style>
      <div class="empty">${message}</div>
    `;
  }

  render() {
    const target = this.targetURL();                                  // VERINT

    if (!target) {
      console.warn('[verint-iframe] idleUrl not ready or invalid:', this.getAttribute('idleUrl'));
      this.renderEmptyState('Waiting for an active call…');
      return;
    }

    let safeURL;
    try {
      safeURL = new URL(target).href;
    } catch (e) {
      console.error('[verint-iframe] Malformed final URL:', target, e);
      this.renderEmptyState('iframeURL is invalid');
      return;
    }

    // VERINT: iframeHandler rebuilds the iframe on every render. This widget re-renders on every call
    // update, so only touch the iframe when the page actually changes (otherwise the agent's work reloads).
    if (safeURL === this._shown && (this.isKeepAlive() ? this._keptFrame : this.shadowRoot.querySelector('iframe'))) return;
    this._shown = safeURL;

    console.log('[verint-iframe] Loading:', safeURL);

    // VERINT: no encodeURI() here. new URL().href is already encoded, and encoding it again turns
    // "+1480..." (%2B) into %252B, so Verint would receive the wrong phone number.
    if (this.isKeepAlive()) {
      this.attachKept(safeURL, 'verint');                              // VERINT: one kept page for Verint
      return;
    }
    this.detachKept();

    this.shadowRoot.innerHTML = `
      <style>
        iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
      </style>
      <iframe src="${safeURL.replace(/"/g, '%22')}" allow="camera;microphone"></iframe>
    `;
  }
}

if (!customElements.get('verint-iframe')) {
  customElements.define('verint-iframe', VerintIframeComponent);
}
