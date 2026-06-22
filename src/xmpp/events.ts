import type { ConnectionStatus } from '@/types';

type EventCallback = (...args: any[]) => void;

class EventBus {
  private listeners = new Map<string, Set<EventCallback>>();

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: any[]): void {
    const subscribers = this.listeners.get(event);
    if (!subscribers) return;
    // Snapshot so a listener that (un)subscribes during emit doesn't affect this pass,
    // and isolate failures so one throwing listener can't break the others.
    for (const cb of [...subscribers]) {
      try {
        cb(...args);
      } catch (err) {
        console.error(`[EventBus] listener for "${event}" threw:`, err);
      }
    }
  }
}

export const events = new EventBus();

// Event names
export const CONNECTION_STATUS_CHANGED = 'connection:status';
export const LOGGED_OUT = 'auth:logout';
export const PUSH_SERVER_NOT_FOUND = 'push:server-not-found';
