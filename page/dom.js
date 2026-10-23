// Tiny DOM builder: h("div", {class: "x", onclick}, child, [children], "text").
// Props: class, text, html (trusted constant markup only — icons), dataset,
// style (object), value/checked/disabled/selected/readOnly (set as
// properties), on<event> handlers; anything else becomes an attribute.
// null/false props and children are skipped.

const PROPS = new Set(["checked", "disabled", "selected", "readOnly", "multiple"]);

export function h(tag, props, ...children) {
  const n = document.createElement(tag);
  let value;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "value") value = v;
      else if (k === "dataset") Object.assign(n.dataset, v);
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (PROPS.has(k)) n[k] = !!v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(n, children);
  // A <select>'s value only sticks once its options exist.
  if (value !== undefined) n.value = value;
  return n;
}

function append(n, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(n, c);
    else if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
}

export function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}
