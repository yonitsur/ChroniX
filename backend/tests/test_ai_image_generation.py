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


@pytest.mark.asyncio
async def test_generate_event_image_free_key_routes_directly_to_pollinations(monkeypatch):
    """
    When a configured free-tier Gemini key is passed (where Google AI Studio image quota is limit: 0),
    generate_event_image_with_gemini should bypass futile Gemini image model calls (preventing 429
    cooldowns on the free text keys) and route directly to Pollinations Flux.
    """
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "paid-server-key")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "free-guest-key-1")

    img = Image.new("RGB", (64, 64), color=(80, 120, 160))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    fake_jpeg_bytes = buf.getvalue()

    gemini_calls = []

    async def fake_generate_with_retry(_client, **kwargs):
        gemini_calls.append(kwargs.get("model"))
        # Simulate free Gemini text model translating Hebrew title to English prompt
        return SimpleNamespace(
            candidates=[
                SimpleNamespace(
                    finish_reason="FinishReason.STOP",
                    content=SimpleNamespace(
                        parts=[
                            SimpleNamespace(
                                text="Apollo 11 astronauts stepping onto the lunar surface in 1969",
                                inline_data=None,
                            )
                        ]
                    ),
                )
            ]
        )

    class FakeHttpResponse:
        status_code = 200
        headers = {"content-type": "image/jpeg"}
        content = fake_jpeg_bytes

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            pass

        async def get(self, url):
            assert "image.pollinations.ai/prompt/" in url
            assert "Apollo%2011" in url
            return FakeHttpResponse()

    with patch("services.gemini_service.get_gemini_client", return_value=SimpleNamespace()), patch(
        "services.gemini_service._generate_with_retry", side_effect=fake_generate_with_retry
    ), patch("services.gemini_service.httpx.AsyncClient", FakeAsyncClient):
        res = await generate_event_image_with_gemini(
            title="נחיתה על הירח",
            year=1969,
            timeline_topic="חקר החלל",
            api_key="free-guest-key-1",
        )

    assert res["imageUrl"].startswith("data:image/jpeg;base64,")
    assert res["imageSource"] == "ai"
    assert res["model"] == "pollinations-flux"
    assert "Apollo 11" in res["promptUsed"]
    # Only the text model was called for Hebrew->English prompt translation; zero Gemini image model calls!
    assert len(gemini_calls) == 1
    assert "image" not in gemini_calls[0]


@pytest.mark.asyncio
async def test_generate_event_image_falls_back_to_pollinations_when_gemini_fails(monkeypatch):
    """
    When a paid/custom key is used and all Gemini image models fail (e.g. 429 quota or 503),
    generate_event_image_with_gemini should fall back to Pollinations Flux automatically.
    """
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_API_KEY", "paid-server-key")

    img = Image.new("RGB", (64, 64), color=(140, 90, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    fake_jpeg_bytes = buf.getvalue()

    async def fake_failing_gemini(_client, **kwargs):
        raise RuntimeError("429 RESOURCE_EXHAUSTED: Quota exceeded")

    class FakeHttpResponse:
        status_code = 200
        headers = {"content-type": "image/jpeg"}
        content = fake_jpeg_bytes

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            pass

        async def get(self, url):
            return FakeHttpResponse()

    with patch("services.gemini_service.get_gemini_client", return_value=SimpleNamespace()), patch(
        "services.gemini_service._generate_with_retry", side_effect=fake_failing_gemini
    ), patch("services.gemini_service.httpx.AsyncClient", FakeAsyncClient):
        res = await generate_event_image_with_gemini(
            title="Moon Landing",
            year=1969,
            timeline_topic="Space Exploration",
            api_key="paid-server-key",
        )

    assert res["imageUrl"].startswith("data:image/jpeg;base64,")
    assert res["imageSource"] == "ai"
    assert res["model"] == "pollinations-flux"


def test_model_specific_pricing_and_token_extraction():
    from types import SimpleNamespace
    from services.gemini_service import (
        calculate_token_cost_usd,
        extract_token_metrics,
        get_model_pricing_rates,
        log_token_usage_summary,
    )

    # 1. Text models: Flash vs Pro
    flash_cost = calculate_token_cost_usd(100_000, 50_000, 25_000, "gemini-3.8-flash")
    # 100k * $0.10/1M ($0.01) + (50k + 25k) * $0.40/1M ($0.03) = $0.04
    assert flash_cost == pytest.approx(0.04)

    pro_cost = calculate_token_cost_usd(100_000, 50_000, 25_000, "gemini-2.5-pro")
    # 100k * $1.25/1M ($0.125) + (50k + 25k) * $5.00/1M ($0.375) = $0.50
    assert pro_cost == pytest.approx(0.50)

    # 2. Image generation models
    r_img = get_model_pricing_rates("gemini-3.1-flash-image")
    assert (r_img["input_rate"], r_img["output_rate"], r_img["thinking_rate"]) == (0.10, 30.00, 0.40)
    r_lite_img = get_model_pricing_rates("gemini-3.1-flash-lite-image")
    assert (r_lite_img["input_rate"], r_lite_img["output_rate"], r_lite_img["thinking_rate"]) == (0.10, 15.50, 0.40)

    # 3. Audio/TTS models
    r_tts = get_model_pricing_rates("gemini-3.8-flash-tts")
    assert (r_tts["input_rate"], r_tts["output_rate"], r_tts["thinking_rate"]) == (0.50, 10.00, 0.40)
    r_tts_lite = get_model_pricing_rates("gemini-3.8-flash-lite-tts")
    assert (r_tts_lite["input_rate"], r_tts_lite["output_rate"]) == (0.10, 2.00)
    r_tts_pro = get_model_pricing_rates("gemini-2.5-pro-preview-tts")
    assert (r_tts_pro["input_rate"], r_tts_pro["output_rate"], r_tts_pro["thinking_rate"]) == (1.00, 20.00, 5.00)

    # 4. extract_token_metrics includes thoughts_token_count, tool_use_prompt_token_count, and cached_content_token_count
    resp = SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=1000,
            tool_use_prompt_token_count=200,
            candidates_token_count=400,
            thoughts_token_count=300,
            total_token_count=0,
        )
    )
    metrics = extract_token_metrics(resp)
    assert metrics == {
        "prompt_tokens": 1200,
        "cached_tokens": 0,
        "candidates_tokens": 400,
        "thoughts_tokens": 300,
        "total_tokens": 1900,
    }

    cached_resp = SimpleNamespace(
        usage_metadata=SimpleNamespace(
            prompt_token_count=4000,
            cached_content_token_count=3000,
            candidates_token_count=500,
            thoughts_token_count=0,
            total_token_count=4500,
        )
    )
    cached_metrics = extract_token_metrics(cached_resp)
    assert cached_metrics == {
        "prompt_tokens": 4000,
        "cached_tokens": 3000,
        "candidates_tokens": 500,
        "thoughts_tokens": 0,
        "total_tokens": 4500,
    }
    # 1000 uncached @ $0.10/1M ($0.0001) + 3000 cached @ $0.025/1M ($0.000075) + 500 output @ $0.40/1M ($0.0002) = $0.000375
    cached_summary = log_token_usage_summary("ChatCached", "gemini-3.8-flash", "Topic", cached_metrics)
    assert cached_summary["cachedTokens"] == 3000
    assert cached_summary["estimatedCostUsd"] == pytest.approx(0.000375)
    assert cached_summary["inputCostUsd"] == pytest.approx(0.000175)

    # 5. log_token_usage_summary prices grounding vs generation with their own models
    grounding_metrics = {"prompt_tokens": 100_000, "candidates_tokens": 10_000, "thoughts_tokens": 0, "total_tokens": 110_000}
    gen_metrics = {"prompt_tokens": 100_000, "candidates_tokens": 20_000, "thoughts_tokens": 10_000, "total_tokens": 130_000}
    summary = log_token_usage_summary(
        "TestDualModel",
        "gemini-2.5-pro",
        "TestTopic",
        gen_metrics,
        grounding_usage=grounding_metrics,
        grounding_model="gemini-3.8-flash",
    )
    expected_grounding = 0.1 * 0.10 + 0.01 * 0.40  # $0.014
    expected_gen = 0.1 * 1.25 + 0.03 * 5.00        # $0.275
    assert summary["estimatedCostUsd"] == pytest.approx(expected_grounding + expected_gen)


@pytest.mark.asyncio
async def test_image_generation_tracks_tokens_and_avoids_double_counting_rewrite_cost(monkeypatch):
    from types import SimpleNamespace
    from services import activity_log

    captured_rows = []
    monkeypatch.setattr(activity_log, "submit_row", lambda row: captured_rows.append(row))

    img = Image.new("RGB", (64, 64), color=(30, 60, 90))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    valid_png_bytes = buf.getvalue()

    blocked_resp = SimpleNamespace(
        prompt_feedback=None,
        usage_metadata=SimpleNamespace(prompt_token_count=80, candidates_token_count=0, thoughts_token_count=50, total_token_count=130),
        candidates=[SimpleNamespace(finish_reason="FinishReason.IMAGE_SAFETY", content=None)],
    )
    rewrite_resp = SimpleNamespace(
        prompt_feedback=None,
        usage_metadata=SimpleNamespace(prompt_token_count=200, candidates_token_count=40, thoughts_token_count=0, total_token_count=240),
        candidates=[
            SimpleNamespace(
                finish_reason="FinishReason.STOP",
                content=SimpleNamespace(parts=[SimpleNamespace(text="Symbolic quiet archival scene, no text", inline_data=None)]),
            )
        ],
    )
    success_image_resp = SimpleNamespace(
        prompt_feedback=None,
        usage_metadata=SimpleNamespace(prompt_token_count=90, candidates_token_count=1290, thoughts_token_count=100, total_token_count=1480),
        candidates=[
            SimpleNamespace(
                finish_reason="FinishReason.STOP",
                content=SimpleNamespace(
                    parts=[SimpleNamespace(text=None, inline_data=SimpleNamespace(data=valid_png_bytes, mime_type="image/png"))]
                ),
            )
        ],
    )

    calls = []

    async def fake_generate(_client, **kwargs):
        calls.append(kwargs.get("model"))
        if len(calls) == 1:
            return blocked_resp
        if len(calls) == 2:
            return rewrite_resp
        return success_image_resp

    user = {"id": "11111111-1111-1111-1111-111111111111", "is_anonymous": False, "is_admin": False}
    with patch("services.gemini_service.get_gemini_client", return_value=SimpleNamespace()), patch(
        "services.gemini_service._generate_with_retry", side_effect=fake_generate
    ):
        async with activity_log.track_ai_activity("generate_image", user, key_tier="paid") as act:
            res = await generate_event_image_with_gemini(
                title="Sensitive Historical Event",
                year=1933,
                timeline_topic="History",
                api_key="paid-key",
            )
            act["model"] = res["model"]

    assert len(captured_rows) == 1
    row = captured_rows[0]
    # Primary model remains the image model (not overwritten by auxiliary text rewrite model)
    assert row["model"] == "gemini-3.1-flash-image"
    # Tokens include both the rewrite call (200 in, 40 out, 0 think) and the two image attempts (80+90=170 in, 1290 out, 50+100=150 think)
    assert row["input_tokens"] == 200 + 170
    assert row["output_tokens"] == 40 + 1290
    assert row["thinking_tokens"] == 150
    # Cost equals image model cost + single rewrite cost (rewrite cost is NOT double-counted)
    expected_rewrite_cost = round((200 / 1e6) * 0.10 + (40 / 1e6) * 0.40, 6)
    assert row["cost_usd"] == pytest.approx(res["tokenUsage"]["estimatedCostUsd"] + expected_rewrite_cost, rel=1e-5)
    assert res["tokenUsage"]["thoughtsTokens"] == 150



