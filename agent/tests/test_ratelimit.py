from coach.ratelimit import SlidingWindow


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_allows_up_to_the_limit_then_says_how_long_to_wait():
    clock = Clock()
    w = SlidingWindow(3, 60, clock)
    assert [w.hit("u1") for _ in range(3)] == [0.0, 0.0, 0.0]
    clock.t += 20
    wait = w.hit("u1")
    assert 39 < wait <= 40  # the oldest request leaves the window 40 s from now


def test_a_refused_request_is_not_counted_and_the_window_slides():
    clock = Clock()
    w = SlidingWindow(2, 60, clock)
    w.hit("u1"), w.hit("u1")
    assert w.hit("u1") > 0 and w.hit("u1") > 0  # repeated refusals do not extend the wait
    clock.t += 60
    assert w.hit("u1") == 0.0


def test_users_are_independent_and_zero_turns_it_off():
    w = SlidingWindow(1, 60, Clock())
    assert w.hit("a") == 0.0 and w.hit("b") == 0.0 and w.hit("a") > 0
    off = SlidingWindow(0, 60, Clock())
    assert all(off.hit("a") == 0.0 for _ in range(100))
