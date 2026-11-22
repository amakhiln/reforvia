from coach.suggest import clean, fallback

Q, A = "How has my lat pulldown progressed?", "Your top set went from 40 kg to 50 kg over three weeks."


def test_keeps_short_unique_chips_and_caps_at_three():
    raw = '["Show my weekly volume", "show my weekly volume", "What are my personal bests?", "Review my last workout", "How should I warm up?"]'
    assert clean(raw, Q, A) == ["Show my weekly volume", "What are my personal bests?", "Review my last workout"]


def test_drops_repeats_long_chips_and_invented_figures():
    raw = '["How has my lat pulldown progressed?", "Compare it with last 12 weeks of squats at 142 kg", "Show my weekly volume", "' + "x" * 60 + '"]'
    assert clean(raw, Q, A) == ["Show my weekly volume"]


def test_tolerates_code_fences_and_junk():
    assert clean('```json\n["Show my weekly volume"]\n```', Q, A) == ["Show my weekly volume"]
    assert clean("sure! here you go", Q, A) == [] and clean('{"a": 1}', Q, A) == [] and clean("[1, null]", Q, A) == []


def test_fallback_uses_the_last_known_tool_and_skips_the_question_itself():
    assert fallback(["find_exercise", "get_weekly_volume"], "x") == ["How did my last workout go?", "What are my personal bests?"]
    assert fallback(["get_weekly_volume"], "What are my personal bests?") == ["How did my last workout go?"]
    assert fallback([], "x") == []
