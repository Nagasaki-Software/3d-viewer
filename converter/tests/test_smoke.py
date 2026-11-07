def test_fixture_created(fixture_step):
    assert fixture_step.exists()
    assert fixture_step.stat().st_size > 0
