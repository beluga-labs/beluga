/**
 * What runs inside a preview's frame besides the component (served by preview/server.ts): it
 * draws the component with the props the chat sends, in an error boundary, tells the chat how tall
 * it is and which callbacks fired, and swaps in a new build when the file changes, keeping the
 * props. Plain browser JavaScript, as text.
 *
 * Messages, all `{ beluga: … }`, only to and from the page that framed it:
 * - in:  { beluga: 'props', props, variants?: { name, values } }
 * - out: { beluga: 'ready' } · { beluga: 'size', height } · { beluga: 'event', name, detail }
 *        { beluga: 'drawn' } · { beluga: 'error', message, stack } · { beluga: 'rebuilt', v }
 *        { beluga: 'stale', problem } · { beluga: 'lost' }
 */

export const RUNTIME_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; background: transparent; }
body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; color: #2e2a3d; }
#stage { box-sizing: border-box; padding: 20px; min-height: 0; display: flow-root; }
#stage[data-variants] { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.beluga-cell { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.beluga-cell > .beluga-tag { font: 500 11px/1 -apple-system, system-ui, sans-serif; color: #8a84a3; letter-spacing: .01em; }
`;

export const RUNTIME_JS = String.raw`(function () {
  'use strict';
  var MARK = '$beluga';
  var parentWin = window.parent;
  var stage = document.getElementById('stage');
  var state = { api: null, root: null, props: {}, variants: null, key: 0, failed: false };
  // Libraries that read process.env (NODE_ENV) in a browser.
  if (typeof window.process === 'undefined') window.process = { env: { NODE_ENV: 'development' } };

  function post(msg) {
    msg.beluga = msg.beluga || 'note';
    try { parentWin.postMessage(msg, '*'); } catch (e) { /* the chat went away */ }
  }

  function summarize(value, depth) {
    depth = depth || 0;
    if (value === null || value === undefined) return String(value);
    var t = typeof value;
    if (t === 'string') return value.length > 60 ? JSON.stringify(value.slice(0, 57) + '…') : JSON.stringify(value);
    if (t === 'number' || t === 'boolean') return String(value);
    if (t === 'function') return 'a function';
    // A React or DOM event: its kind is what's worth saying.
    if (value && (value.nativeEvent || (typeof Event !== 'undefined' && value instanceof Event))) {
      var target = value.target && value.target.value !== undefined && value.target.value !== '' ? ' “' + String(value.target.value).slice(0, 40) + '”' : '';
      return (value.type || 'event') + target;
    }
    if (Array.isArray(value)) return depth > 0 ? '[' + value.length + ']' : '[' + value.slice(0, 3).map(function (v) { return summarize(v, depth + 1); }).join(', ') + (value.length > 3 ? ', …' : '') + ']';
    if (t === 'object') {
      var keys = Object.keys(value);
      if (depth > 0) return '{…}';
      return '{ ' + keys.slice(0, 3).map(function (k) { return k + ': ' + summarize(value[k], depth + 1); }).join(', ') + (keys.length > 3 ? ', …' : '') + ' }';
    }
    return t;
  }

  function revive(value) {
    if (Array.isArray(value)) return value.map(revive);
    if (value && typeof value === 'object') {
      if (value[MARK] === 'fn') {
        var name = value.name;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          post({ beluga: 'event', name: name, detail: args.map(function (a) { return summarize(a); }).join(', ') });
        };
      }
      if (value[MARK] === 'date') return new Date(value.iso);
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = revive(value[k]); });
      return out;
    }
    return value;
  }

  function pickComponent(mod, pick) {
    if (pick && pick !== 'default' && mod[pick]) return mod[pick];
    if (mod.default) return mod.default;
    var names = Object.keys(mod).filter(function (k) { return /^[A-Z]/.test(k) && (typeof mod[k] === 'function' || (mod[k] && typeof mod[k] === 'object' && mod[k].$$typeof)); });
    return names.length ? mod[names[0]] : null;
  }

  function makeBoundary(React) {
    function Boundary(props) {
      React.Component.call(this, props);
      this.state = { failed: false };
    }
    Boundary.prototype = Object.create(React.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.getDerivedStateFromError = function () { return { failed: true }; };
    Boundary.prototype.componentDidCatch = function (error, info) {
      state.failed = true;
      post({ beluga: 'error', message: String((error && error.message) || error), stack: String((error && error.stack) || '') + (info && info.componentStack ? '\n' + info.componentStack : '') });
    };
    Boundary.prototype.componentDidMount = function () { post({ beluga: 'drawn' }); };
    Boundary.prototype.componentDidUpdate = function () { if (!this.state.failed) post({ beluga: 'drawn' }); };
    Boundary.prototype.render = function () { return this.state.failed ? null : this.props.children; };
    return Boundary;
  }

  function draw() {
    var api = state.api;
    if (!api) return;
    var React = api.React;
    var Component = pickComponent(api.Mod, api.pick);
    if (!Component) {
      post({ beluga: 'error', message: 'No component to draw', stack: '' });
      return;
    }
    var Boundary = api.Boundary || (api.Boundary = makeBoundary(React));
    var props = revive(state.props);
    var tree;
    if (state.variants && state.variants.values && state.variants.values.length) {
      stage.setAttribute('data-variants', '');
      var name = state.variants.name;
      tree = state.variants.values.map(function (v, i) {
        var p = Object.assign({}, props);
        p[name] = v;
        return React.createElement('div', { className: 'beluga-cell', key: i },
          React.createElement('span', { className: 'beluga-tag' }, name + ': ' + String(v)),
          React.createElement(Component, p));
      });
      tree = React.createElement(React.Fragment, null, tree);
    } else {
      stage.removeAttribute('data-variants');
      tree = React.createElement(Component, props);
    }
    if (!state.root) state.root = api.ReactDOM.createRoot(document.getElementById('root'));
    state.root.render(React.createElement(Boundary, { key: state.key }, tree));
  }

  var lastHeight = -1;
  function measure() {
    var h = Math.ceil(stage.getBoundingClientRect().height);
    if (h !== lastHeight) {
      lastHeight = h;
      post({ beluga: 'size', height: h });
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(stage);

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin || !e.data || typeof e.data !== 'object') return;
    var msg = e.data;
    if (msg.beluga === 'props') {
      state.props = msg.props || {};
      state.variants = msg.variants || null;
      // Props change in place (the component keeps its state); after a failure the boundary starts over.
      if (state.failed) { state.failed = false; state.key++; }
      draw();
    }
  });

  window.addEventListener('error', function (e) {
    post({ beluga: 'error', message: String(e.message || 'Script error'), stack: e.error && e.error.stack ? String(e.error.stack) : '' });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    post({ beluga: 'error', message: String((r && r.message) || r), stack: String((r && r.stack) || '') });
  });

  try {
    var initial = document.getElementById('beluga-props');
    if (initial) state.props = JSON.parse(initial.textContent || '{}');
  } catch (e) { /* the chat sends them too */ }

  window.__belugaPreview = {
    mount: function (api) {
      // A new build: the old tree goes, the same props draw the new one.
      if (state.root && state.api && state.api.ReactDOM !== api.ReactDOM) {
        try { state.root.unmount(); } catch (e) { /* gone already */ }
        state.root = null;
      }
      state.api = api;
      state.failed = false;
      state.key++;
      draw();
    }
  };

  var version = Number(document.documentElement.getAttribute('data-v') || '1');
  function swap(v) {
    var css = document.getElementById('bundle-css');
    if (css) css.setAttribute('href', 'bundle.css?v=' + v);
    var script = document.createElement('script');
    script.src = 'bundle.js?v=' + v;
    script.onload = function () { post({ beluga: 'rebuilt', v: v }); script.remove(); };
    document.body.appendChild(script);
  }
  if (typeof EventSource !== 'undefined') {
    var events = new EventSource('events');
    events.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.problem) { post({ beluga: 'stale', problem: msg.problem }); return; }
      if (msg.v && msg.v !== version) { version = msg.v; swap(msg.v); }
    };
    // Closed for good (the preview was let go while nobody looked): the chat opens it again.
    events.onerror = function () { if (events.readyState === 2) post({ beluga: 'lost' }); };
  }
  post({ beluga: 'ready' });
})();`;

/** For a web page (an .html file): reload when its files change, and say how it's going. */
export const RELOAD_JS = String.raw`(function () {
  if (typeof EventSource === 'undefined') return;
  var version = null;
  var events = new EventSource(document.currentScript.getAttribute('data-events'));
  events.onmessage = function (e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (version !== null && msg.v !== version) location.reload();
    version = msg.v;
  };
})();`;
