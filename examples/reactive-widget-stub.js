// Minimal stub for reactive-widget-helper (peer dep, not installed in dev)
export default function ReactiveWidget(el, { value, showValue } = {}) {
  Object.defineProperty(el, "value", {
    get() { return this._rwValue; },
    set(v) { this._rwValue = v; showValue && showValue(); },
  });
  el._rwValue = value;
  el.setValue = (v) => { el.value = v; };
  return el;
}
