"""A per-user sliding-window limit, kept in this process's memory.

shortcut: the counts live in memory, so they reset when the service restarts and are not shared between instances.
That is fine for one Render instance; move the counts into the database if the service ever runs on several."""
from __future__ import annotations

import time
from collections import deque
from typing import Callable


class SlidingWindow:
    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> float:
        """Records a request and returns 0.0, or returns how many seconds to wait (and records nothing) if the key is over the limit."""
        if self.limit <= 0:  # 0 turns the limit off
            return 0.0
        now = self.clock()
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= self.window:
            q.popleft()
        if len(q) >= self.limit:
            return max(0.1, self.window - (now - q[0]))
        q.append(now)
        if len(self._hits) > 5000:  # drop users with no recent requests so the map cannot grow without bound
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window]:
                del self._hits[k]
        return 0.0
