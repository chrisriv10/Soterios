/**
 * In-process event bus used to decouple scanners, UI progress updates,
 * tray summaries, and background engines.
 */
class EventBus {
  /** @type {Map<string, Set<Function>>} */
  constructor() { this._listeners = new Map(); }

  /**
   * Subscribe to an event.
   * @param {string} eventName
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function.
   */
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  /**
   * Subscribe to an event once.
   * @param {string} eventName
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function.
   */
  once(eventName, handler) {
    /**
     * One-shot wrapper that unsubscribes itself after the first invocation.
     *
     * @param {*} payload - Event payload.
     * @returns {*} Handler return value.
     */
    const wrapper = (payload) => {
      this.off(eventName, wrapper);
      return handler(payload);
    };
    this.on(eventName, wrapper);
    return () => this.off(eventName, wrapper);
  }

  /**
   * Unsubscribe a handler from an event.
   * @param {string} eventName
   * @param {Function} handler
   */
  off(eventName, handler) {
    if (!this._listeners.has(eventName)) return;
    this._listeners.get(eventName).delete(handler);
  }

  /**
   * Remove all listeners for an event, or all events if no name is given.
   * @param {string} [eventName]
   */
  removeAllListeners(eventName) {
    if (eventName) this._listeners.delete(eventName);
    else this._listeners.clear();
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} eventName
   * @param {*} payload
   */
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
