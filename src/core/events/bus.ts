import { logger } from "@/core/logger";
import type { DomainEventMap, DomainEventName } from "./types";

type Handler<N extends DomainEventName> = (
  payload: DomainEventMap[N],
  meta: { name: N; occurredAt: Date }
) => void | Promise<void>;

const handlers = new Map<DomainEventName, Set<Handler<DomainEventName>>>();

const log = logger.child({ component: "event-bus" });

/**
 * In-process, typed domain event bus.
 *
 * Deliberately synchronous-dispatch / fire-and-forget: a subscriber's failure
 * is logged and never propagates back to the publisher, so a reporting or
 * notification side-effect can't fail a supplier write. When this monolith is
 * split, `publish` is the seam that becomes a real broker.
 */
export function subscribe<N extends DomainEventName>(name: N, handler: Handler<N>): () => void {
  const set = handlers.get(name) ?? new Set();
  set.add(handler as Handler<DomainEventName>);
  handlers.set(name, set);
  return () => set.delete(handler as Handler<DomainEventName>);
}

export async function publish<N extends DomainEventName>(
  name: N,
  payload: DomainEventMap[N]
): Promise<void> {
  const subscribers = handlers.get(name);
  log.debug("event published", { event: name, subscribers: subscribers?.size ?? 0 });
  if (!subscribers?.size) return;

  const occurredAt = new Date();
  await Promise.all(
    [...subscribers].map(async (h) => {
      try {
        await h(payload, { name, occurredAt });
      } catch (e) {
        log.error("event handler failed", {
          event: name,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })
  );
}

/** Test seam. */
export function clearSubscribers(): void {
  handlers.clear();
}
