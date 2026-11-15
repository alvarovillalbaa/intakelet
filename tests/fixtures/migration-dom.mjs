// T2 controlled nodes/events only. No layout, browser or custom-element engine.
export function migrationSurface() {
  const originals = new Map(), registry = new Map(); let document;
  class Node extends EventTarget {
    constructor(tag = 'custom-element') { super(); this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.ownText = ''; this.attrs = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.id = ''; }
    set textContent(value) { this.ownText = String(value); this.replaceChildren(); }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    prepend(...children) { for (const child of [...children].reverse()) { child.remove(); child.parentElement = this; this.children.unshift(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key); }
    focus() { document.activeElement = this; }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const walk = value => [value, ...value.children.flatMap(walk)];
  document = { body: new Node('body'), activeElement: null, defaultView: new Node('window'), createElement: tag => registry.has(tag) ? new (registry.get(tag))() : new Node(tag), getElementById: id => walk(document.body).find(value => value.id === id) ?? null };
  const customElements = { get: name => registry.get(name), define: (name, constructor) => registry.set(name, constructor) };
  for (const [name, value] of Object.entries({ document, customElements, HTMLElement: Node, CustomEvent: class extends Event { constructor(type, options) { super(type, options); this.detail = options?.detail; } } })) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
  return { document, customElements, walk, create(tag, id) { const value = document.createElement(tag); value.id = id ?? ''; document.body.append(value); value.connectedCallback?.(); return value; }, button(root, text) { return walk(root).find(value => value.tagName === 'BUTTON' && value.textContent === text); }, restore() { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } } };
}
export async function until(predicate) { const deadline = Date.now() + 2000; while (!await predicate()) { if (Date.now() > deadline) throw new Error('Controlled migration view did not reach the expected condition'); await new Promise(resolve => setImmediate(resolve)); } }
export function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
