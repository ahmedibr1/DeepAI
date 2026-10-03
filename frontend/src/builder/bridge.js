/* postMessage bridge between the embedded DeepDive Builder and the portal page that hosts it.
 * Messages are accepted only from the same origin and only from the parent window.
 *
 * builder → portal: dd:ready, dd:changed {data, errorCount, errors}, dd:state {data, errorCount, errors}
 * portal → builder: dd:load {data, readOnly, context}, dd:request-state, dd:goto-review
 */
export function createBridge() {
  const params = new URLSearchParams(location.search);
  const embedded = (params.has("embed") || window.__DD_EMBED__ === true) && window.parent !== window;
  const handlers = { load: [], request: [], review: [] };

  // A file:// page has an opaque origin ("null"), which no postMessage target matches. The real guard
  // is that messages must come from (and go to) the parent window that embedded this builder.
  const opaque = !location.origin || location.origin === "null";
  const target = opaque ? "*" : location.origin;
  const trusted = (event) => event.source === window.parent && (opaque || event.origin === location.origin);

  const post = (type, payload = {}) => {
    if (embedded) window.parent.postMessage({ type, ...payload }, target);
  };
  const summarize = (errors) => ({
    errorCount: errors.length,
    errors: errors.slice(0, 50).map((e) => ({ step: e.step, label: e.label, msg: e.msg })),
  });

  if (embedded) {
    window.addEventListener("message", (event) => {
      if (!trusted(event)) return;
      const msg = event.data || {};
      if (msg.type === "dd:load") handlers.load.forEach((h) => h(msg));
      else if (msg.type === "dd:request-state") handlers.request.forEach((h) => h());
      else if (msg.type === "dd:goto-review") handlers.review.forEach((h) => h());
    });
  }

  return {
    embedded,
    ready: () => post("dd:ready"),
    changed: (data, errors) => post("dd:changed", { data: JSON.parse(JSON.stringify(data)), ...summarize(errors) }),
    state: (data, errors) => post("dd:state", { data: JSON.parse(JSON.stringify(data)), ...summarize(errors) }),
    onLoad: (h) => handlers.load.push(h),
    onRequestState: (h) => handlers.request.push(h),
    onGotoReview: (h) => handlers.review.push(h),
  };
}
