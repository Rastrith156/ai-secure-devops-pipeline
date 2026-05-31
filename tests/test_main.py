"""Unit tests for app.main module."""

from __future__ import annotations

import pytest

from app.main import hello


class TestHello:
    """Validate the hello() greeting function."""

    def test_returns_expected_greeting(self) -> None:
        assert hello() == "Hello DevOps"

    def test_return_type_is_str(self) -> None:
        assert isinstance(hello(), str)

    def test_greeting_is_not_empty(self) -> None:
        assert len(hello()) > 0

    def test_no_leading_or_trailing_whitespace(self) -> None:
        result = hello()
        assert result == result.strip()

    def test_does_not_raise(self) -> None:
        try:
            hello()
        except Exception as exc:
            pytest.fail(f"hello() raised an unexpected exception: {exc}")
