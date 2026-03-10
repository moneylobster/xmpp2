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
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }
}

export const events = new EventBus();

// Event names
export const CONNECTION_STATUS_CHANGED = 'connection:status';
export const LOGGED_OUT = 'auth:logout';
export const PUSH_SERVER_NOT_FOUND = 'push:server-not-found';
