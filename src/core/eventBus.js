class EventBus {
  constructor() { this._listeners = new Map(); }
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }
  off(eventName, handler) {
    if (!this._listeners.has(eventName)) return;
    this._listeners.get(eventName).delete(handler);
  }
  removeAllListeners(eventName) {
    if (eventName) this._listeners.delete(eventName);
    else this._listeners.clear();
  }
  emit(eventName, payload) {
    if (!this._listeners.has(eventName)) return;
    for (const handler of this._listeners.get(eventName)) {
      try { handler(payload); } catch (err) {
        console.error(`[eventBus] listener for "${eventName}" threw:`, err);
      }
    }
  }
}
module.exports = new EventBus();
