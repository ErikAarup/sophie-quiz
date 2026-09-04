// WO-083 A9: the wake-up decision. `kick()` runs on visibilitychange / pageshow / online; this is
// the predicate it asks before it decides between "ping this socket" and "this socket is dead".
import { describe, expect, it } from 'vitest';
import { PING_EVERY_MS, socketIsStale } from '../../src/client/ws.ts';

describe('socketIsStale', () => {
  const now = 1_700_000_000_000;

  it('is false while the socket has been heard from inside two ping intervals', () => {
    expect(socketIsStale(now, now)).toBe(false);
    expect(socketIsStale(now - PING_EVERY_MS, now)).toBe(false);
    expect(socketIsStale(now - 2 * PING_EVERY_MS, now)).toBe(false); // exactly two: still alive
  });

  it('is true past two ping intervals — a phone that woke with a socket the OS had killed', () => {
    expect(socketIsStale(now - 2 * PING_EVERY_MS - 1, now)).toBe(true);
    expect(socketIsStale(now - 30_000, now)).toBe(true);
  });

  it('trips well before the 8 s watchdog, which is the whole point', () => {
    // The watchdog only fires on the ping tick after 8 s of silence, then the reconnect waits out a
    // backoff: about eleven seconds of "Återansluter…" in the room. This says "dead" at six.
    expect(2 * PING_EVERY_MS).toBeLessThan(8_000);
    expect(socketIsStale(now - 6_001, now)).toBe(true);
    expect(socketIsStale(now - 5_999, now)).toBe(false);
  });
});
