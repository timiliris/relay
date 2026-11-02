import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from './openrouter';

type Handler = (event: StreamEvent) => void;
const api = {
  channels: [] as { handler: Handler | null }[],
  invoke: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => api.invoke(...args),
  isTauri: () => false,
  Channel: class {
    handler: Handler | null = null;
    constructor() {
      api.channels.push(this);
    }
    set onmessage(handler: Handler) {
      this.handler = handler;
    }
  },
}));

const { openrouter } = await import('./openrouter');

const request = { model: 'm', messages: [] } as unknown as Parameters<
  typeof openrouter.streamChat
>[1];

describe('openrouter.streamChat', () => {
  beforeEach(() => {
    api.channels.length = 0;
    api.invoke.mockReset();
    vi.useRealTimers();
  });

  it("attend l'événement terminal même quand la commande Rust rend la main avant", async () => {
    api.invoke.mockResolvedValue(undefined);
    const seen: StreamEvent[] = [];
    let settled = false;
    const run = openrouter
      .streamChat('r1', request, (e) => seen.push(e))
      .then(() => {
        settled = true;
      });
    // La commande a répondu, mais le canal n'a encore rien livré.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    const channel = api.channels[0];
    channel?.handler?.({
      type: 'toolCalls',
      calls: [{ id: 'c', name: 'write_file', arguments: '{}' }],
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    channel?.handler?.({ type: 'done', finishReason: 'tool_calls' });
    await run;
    expect(settled).toBe(true);
    expect(seen.map((e) => e.type)).toEqual(['toolCalls', 'done']);
  });

  it("se résout aussi sur `error`, et après une garde si rien n'arrive", async () => {
    api.invoke.mockResolvedValue(undefined);
    const run = openrouter.streamChat('r2', request, () => {});
    api.channels[0]?.handler?.({ type: 'error', message: 'boom' });
    await expect(run).resolves.toBeUndefined();

    vi.useFakeTimers();
    api.invoke.mockResolvedValue(undefined);
    const stuck = openrouter.streamChat('r3', request, () => {});
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(stuck).resolves.toBeUndefined();
  });

  it('propage le rejet de la commande sans attendre', async () => {
    api.invoke.mockRejectedValue(new Error('réseau'));
    await expect(openrouter.streamChat('r4', request, () => {})).rejects.toThrow('réseau');
  });
});
