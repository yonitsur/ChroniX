import io
from unittest.mock import patch
import pytest
from PIL import Image

from services.gemini_service import (
    is_ai_image_auto_fallback_enabled,
    get_gemini_image_models_to_try,
    build_event_image_prompt,
    _compress_image_bytes_to_data_url,
    enrich_missing_images_with_ai,
    generate_event_image_with_gemini,
)


def test_get_gemini_image_models_to_try_default_order(monkeypatch):
    monkeypatch.delenv("GEMINI_IMAGE_MODEL", raising=False)
    assert get_gemini_image_models_to_try() == [
        "gemini-3.1-flash-image",
        "gemini-3.1-flash-lite-image",
        "gemini-2.5-flash-image",
    ]


def test_is_ai_image_auto_fallback_enabled(monkeypatch):
    monkeypatch.delenv("ENABLE_AI_IMAGE_AUTO_FALLBACK", raising=False)
    monkeypatch.delenv("VITE_ENABLE_AI_IMAGE_AUTO_FALLBACK", raising=False)
    assert is_ai_image_auto_fallback_enabled(None) is False
    assert is_ai_image_auto_fallback_enabled(True) is True
    assert is_ai_image_auto_fallback_enabled(False) is False

    monkeypatch.setenv("ENABLE_AI_IMAGE_AUTO_FALLBACK", "true")
    assert is_ai_image_auto_fallback_enabled(None) is True
    assert is_ai_image_auto_fallback_enabled(False) is False


def test_build_event_image_prompt_historical_and_fictional():
    hist_prompt = build_event_image_prompt(
        title="Moon Landing",
        subtitle="Apollo 11 touches down on the Sea of Tranquility",
        year=1969,
        timeline_topic="Space Exploration",
        location_name="Moon",
        style="historical",
    )
    assert "Moon Landing" in hist_prompt
    assert "1969 CE" in hist_prompt
    assert "Do NOT include any text" in hist_prompt

    bce_prompt = build_event_image_prompt(
        title="Battle of Thermopylae",
        year=-480,
        style="painting",
    )
    assert "480 BCE" in bce_prompt
    assert "fine art" in bce_prompt

    fictional_prompt = build_event_image_prompt(
        title="Battle of the Pelennor Fields",
        is_fictional=True,
        custom_prompt="Riders of Rohan charging at dawn",
        style="auto",
    )
    assert "Riders of Rohan charging at dawn" in fictional_prompt
    assert "concept art" in fictional_prompt


def test_compress_image_bytes_to_data_url():
    img = Image.new("RGB", (1200, 800), color=(40, 90, 160))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    data_url = _compress_image_bytes_to_data_url(raw_bytes, mime_type="image/png", max_dim=512)
    assert data_url.startswith("data:image/jpeg;base64,")


@pytest.mark.asyncio
async def test_enrich_missing_images_with_ai_prioritizes_high_rank():
    events = [
        {"title": "Low Rank Event", "rank": 5, "from": {"year": 1900}},
        {"title": "Already Has Image", "rank": 10, "imageUrl": "https://upload.wikimedia.org/img.jpg"},
        {"title": "High Rank Missing 1", "rank": 9, "from": {"year": 1950}},
        {"title": "High Rank Missing 2", "rank": 8, "from": {"year": 1960}},
    ]

    with patch(
        "services.gemini_service.generate_event_image_with_gemini",
        return_value={
            "imageUrl": "data:image/jpeg;base64,FAKEIMAGE",
            "imageSource": "ai",
            "promptUsed": "test",
            "model": "gemini-3.1-flash-lite-image",
        },
    ) as mock_gen:
        await enrich_missing_images_with_ai(
            events,
            timeline_topic="20th Century",
            api_key="fake-key",
            max_images=2,
            min_rank=8,
        )

    assert mock_gen.call_count == 2
    assert events[0].get("imageUrl") is None
    assert events[1]["imageUrl"] == "https://upload.wikimedia.org/img.jpg"
    assert events[2]["imageUrl"] == "data:image/jpeg;base64,FAKEIMAGE"
    assert events[2]["imageSource"] == "ai"
    assert events[3]["imageUrl"] == "data:image/jpeg;base64,FAKEIMAGE"
    assert events[3]["imageSource"] == "ai"


@pytest.mark.asyncio
async def test_generate_event_image_safety_fallback_rewrites_prompt():
    """
    When the first image generation attempt returns no image bytes due to IMAGE_SAFETY,
    generate_event_image_with_gemini should rewrite the prompt into a safe symbolic scene
    and retry on the primary image model before falling back to other models.
    """
    from types import SimpleNamespace

    img = Image.new("RGB", (64, 64), color=(100, 110, 120))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    valid_png_bytes = buf.getvalue()

    blocked_resp = SimpleNamespace(
        prompt_feedback=None,
        candidates=[
            SimpleNamespace(
                finish_reason="FinishReason.IMAGE_SAFETY",
                content=SimpleNamespace(parts=[]),
            )
        ],
    )
    rewrite_resp = SimpleNamespace(
        candidates=[
            SimpleNamespace(
                finish_reason="FinishReason.STOP",
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(
                            text="A quiet 1930s cobblestone street in Berlin with shuttered vintage shopfronts under overcast morning light.",
                            inline_data=None,
                        )
                    ]
                ),
            )
        ]
    )
    success_image_resp = SimpleNamespace(
        prompt_feedback=None,
        candidates=[
            SimpleNamespace(
                finish_reason="FinishReason.STOP",
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(
                            text=None,
                            inline_data=SimpleNamespace(
                                data=valid_png_bytes,
                                mime_type="image/png",
                            ),
                        )
                    ]
                ),
            )
        ],
    )

    calls = []

    async def fake_generate_with_retry(_client, **kwargs):
        calls.append((kwargs.get("model"), kwargs.get("contents")))
        if len(calls) == 1:
            return blocked_resp
        if len(calls) == 2:
            return rewrite_resp
        return success_image_resp

    with patch("services.gemini_service.get_gemini_client", return_value=SimpleNamespace()), patch(
        "services.gemini_service._generate_with_retry", side_effect=fake_generate_with_retry
    ):
        res = await generate_event_image_with_gemini(
            title="יום החרם נגד בתי עסק יהודיים",
            year=1933,
            timeline_topic="השואה",
            api_key="fake-key",
        )

    assert res["imageUrl"].startswith("data:image/jpeg;base64,")
    assert res["imageSource"] == "ai"
    assert res["model"] == "gemini-3.1-flash-image"
    assert "shuttered vintage shopfronts" in res["promptUsed"]
    # 1st call: image model (blocked), 2nd call: text model (rewrite), 3rd call: same primary image model (succeeded)
    assert len(calls) == 3
    assert calls[0][0] == "gemini-3.1-flash-image"
    assert calls[2][0] == "gemini-3.1-flash-image"

