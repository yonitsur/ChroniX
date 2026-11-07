"""
Batch 4A-2: AI edge cases.
B-07 refine id hijack / duplicate ids, B-09 job-based file routes, B-16 cancel-refund lock,
B-17 exact chat targets, B-18 empty / oversized timelines, B-19 TimelineData caps,
B-20 media fields, B-23 Library catalog cache, B-04 follow-up (generation version).
"""
import asyncio
import copy
import json
import threading
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

import main
from models import (
    GeminiEventItem,
    GeminiTimelineOutput,
    TimelineChatOutput,
    TimelineData,
)
from services import gemini_service, storage
from services.auth_service import get_current_user_optional, get_current_user_required

OWNER = {"id": "owner-4a2", "email": "owner4a2@example.com", "is_anonymous": False}


# --------------------------------------------------------------------------------------------
# Fixtures and helpers
# --------------------------------------------------------------------------------------------

@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    local_file = tmp_path / "timelines.json"
    local_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()
    return local_file


@pytest.fixture
def api(local_store):
    main.app.dependency_overrides[get_current_user_optional] = lambda: OWNER
    main.app.dependency_overrides[get_current_user_required] = lambda: OWNER
    for limiter in (main.timeline_save_rate_limiter, main.timeline_rate_limiter, main.file_upload_rate_limiter):
        limiter.records.clear()
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        main.app.dependency_overrides.clear()


@pytest.fixture
def no_activity(monkeypatch):
    @asynccontextmanager
    async def fake_activity(*args, **kwargs):
        yield {"details": {}}

    monkeypatch.setattr(main, "track_ai_activity", fake_activity)
    monkeypatch.setattr(main, "apply_timeline_result", lambda *a, **k: None)


def _rows(local_file) -> Dict[str, dict]:
    return {r["id"]: r for r in json.loads(local_file.read_text(encoding="utf-8"))}


def _seed(local_file, row: Dict[str, Any]) -> None:
    rows = json.loads(local_file.read_text(encoding="utf-8"))
    rows.append(row)
    local_file.write_text(json.dumps(rows), encoding="utf-8")
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None


def _owned(tid: str, version: str = "v1", articles=None, **extra) -> Dict[str, Any]:
    return {
        "id": tid,
        "title": "Stored",
        "articles": articles or [
            {"id": "evt-1", "title": "Sputnik", "from": {"year": 1957}},
            {"id": "evt-2", "title": "Apollo 11", "from": {"year": 1969}},
        ],
        "user_id": OWNER["id"],
        "updatedAt": version,
        **extra,
    }


def _articles(n: int) -> List[Dict[str, Any]]:
    return [{"id": f"a{i}", "title": f"Event {i}", "from": {"year": 1000 + i}} for i in range(n)]


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("1.2.3.4", 1234)})


class _ModelStub:
    """Stands in for the Gemini model: returns `outputs` in order and records each call."""

    def __init__(self, monkeypatch, *outputs, models=("m1",)):
        self.outputs = list(outputs)
        self.calls = 0
        self.enrich_inputs: List[List[dict]] = []
        self.hook_calls_before_enrich: List[int] = []
        self.hook_calls = 0
        self.enrich_update: Dict[str, Any] = {}
        monkeypatch.setattr(gemini_service, "get_gemini_client", lambda key=None: SimpleNamespace())
        monkeypatch.setattr(gemini_service, "get_gemini_models_to_try", lambda: list(models))
        monkeypatch.setattr(gemini_service, "log_token_usage_summary", lambda **kw: {"model": "m1"})

        async def fake_generate(client, **kwargs):
            self.calls += 1
            out = self.outputs[min(self.calls - 1, len(self.outputs) - 1)]
            return SimpleNamespace(parsed=out, candidates=None, usage_metadata=None)

        async def fake_enrich(events, **kwargs):
            self.hook_calls_before_enrich.append(self.hook_calls)
            self.enrich_inputs.append([dict(e) for e in events])
            return [{**e, **self.enrich_update} for e in events]

        monkeypatch.setattr(gemini_service, "_generate_with_retry", fake_generate)
        monkeypatch.setattr(gemini_service, "enrich_events_with_wikipedia", fake_enrich)

    def count_hook(self):
        self.hook_calls += 1


def _output(events: List[Dict[str, Any]], **extra) -> GeminiTimelineOutput:
    return GeminiTimelineOutput(
        title=extra.pop("title", "Treaties"),
        description="d",
        overview="o",
        events=[GeminiEventItem(**e) for e in events],
        **extra,
    )


def _treaty_timeline() -> TimelineData:
    return TimelineData.model_validate({
        "id": "tl-treaty",
        "title": "Treaties",
        "lanes": [{"id": "main", "title": "Main"}],
        "articles": [
            {
                "id": "e1", "title": "Treaty of Paris", "from": {"year": 1783}, "lane": "main",
                "imageUrl": "https://upload.wikimedia.org/1783.jpg", "wikiUrl": "https://en.wikipedia.org/wiki/Treaty_of_Paris_(1783)",
                "extract": "Ended the American Revolutionary War.",
            },
            {"id": "e2", "title": "Congress of Vienna", "from": {"year": 1815}, "lane": "main"},
        ],
    })


async def _refine(timeline, instruction="edit", **kwargs):
    return await gemini_service.refine_timeline_with_gemini(timeline, instruction, api_key="k", **kwargs)


# --------------------------------------------------------------------------------------------
# B-07: refine never duplicates ids or lets a new event take an existing one's id and media
# --------------------------------------------------------------------------------------------

def _assert_treaty_case(result: TimelineData) -> None:
    ids = [a.id for a in result.articles]
    assert len(ids) == len(set(ids)), ids
    by_year = {a.from_.year: a for a in result.articles}
    assert set(by_year) == {1763, 1783, 1815}
    old, new = by_year[1783], by_year[1763]
    assert old.id == "e1" and old.imageUrl and old.wikiUrl and old.extract
    assert new.id != "e1"
    assert new.imageUrl is None and new.wikiUrl is None and new.extract is None


def test_b07_repeated_existing_id_becomes_a_new_event(monkeypatch):
    stub = _ModelStub(monkeypatch, _output([
        {"id": "e1", "title": "Treaty of Paris", "from_year": 1783},
        {"id": "e1", "title": "Treaty of Paris", "from_year": 1763},
        {"id": "e2", "title": "Congress of Vienna", "from_year": 1815},
    ]))
    result = asyncio.run(_refine(_treaty_timeline(), "add the 1763 Treaty of Paris"))
    _assert_treaty_case(result)
    assert [e["title"] for e in stub.enrich_inputs[0]] == ["Treaty of Paris"]


def test_b07_same_title_with_its_own_id_is_new(monkeypatch):
    _ModelStub(monkeypatch, _output([
        {"id": "new_1", "title": "Treaty of Paris", "from_year": 1763},
        {"id": "e1", "title": "Treaty of Paris", "from_year": 1783},
        {"id": "e2", "title": "Congress of Vienna", "from_year": 1815},
    ]))
    result = asyncio.run(_refine(_treaty_timeline(), "add the 1763 Treaty of Paris"))
    _assert_treaty_case(result)
    assert any(a.id == "new_1" for a in result.articles)


def test_b07_id_less_same_title_listed_first_does_not_take_the_existing_event(monkeypatch):
    _ModelStub(monkeypatch, _output([
        {"title": "Treaty of Paris", "from_year": 1763},
        {"id": "e1", "title": "Treaty of Paris", "from_year": 1783},
        {"id": "e2", "title": "Congress of Vienna", "from_year": 1815},
    ]))
    _assert_treaty_case(asyncio.run(_refine(_treaty_timeline(), "add the 1763 Treaty of Paris")))


def test_b07_title_match_still_works_when_the_model_gave_no_id(monkeypatch):
    _ModelStub(monkeypatch, _output([
        {"title": "treaty of paris ", "from_year": 1783, "subtitle": "Rewritten."},
    ], keep_unmentioned_events=True))
    result = asyncio.run(_refine(_treaty_timeline()))
    e1 = next(a for a in result.articles if a.id == "e1")
    assert e1.subtitle == "Rewritten." and e1.imageUrl  # matched, kept its media
    assert len(result.articles) == 2


def test_b07_final_dedupe_pass_reassigns_colliding_ids():
    arts = [
        TimelineData.model_validate({"id": "t", "title": "T", "articles": [{"id": "x", "title": "A", "from": {"year": 1}}]}).articles[0],
    ]
    dupes = gemini_service.dedupe_article_ids([arts[0], arts[0].model_copy(update={"title": "B"})])
    assert dupes[0].id == "x" and dupes[1].id != "x" and dupes[1].title == "B"


# --------------------------------------------------------------------------------------------
# B-18: empty / oversized AI results
# --------------------------------------------------------------------------------------------

def test_b18_refine_that_empties_the_timeline_raises_without_trying_another_model(monkeypatch):
    stub = _ModelStub(monkeypatch, _output([], keep_unmentioned_events=False), models=("m1", "m2"))
    timeline = _treaty_timeline()
    with pytest.raises(gemini_service.EmptyRefineResultError) as exc:
        asyncio.run(_refine(timeline, "remove everything"))
    assert isinstance(exc.value, ValueError)
    assert stub.calls == 1
    assert [a.id for a in timeline.articles] == ["e1", "e2"]  # the caller's timeline is untouched


def test_b18_refine_on_a_full_timeline_refuses_new_events(monkeypatch):
    full = TimelineData.model_validate({"id": "tl-full", "title": "Full", "articles": _articles(600)})
    _ModelStub(monkeypatch, _output([{"id": "new_1", "title": "One more", "from_year": 2000}], keep_unmentioned_events=True))
    with pytest.raises(gemini_service.TimelineTooLargeError):
        asyncio.run(_refine(full, "add one more"))


def test_b18_refine_trims_new_events_to_the_room_left(monkeypatch):
    almost = TimelineData.model_validate({"id": "tl-almost", "title": "Almost", "articles": _articles(598)})
    _ModelStub(monkeypatch, _output([
        {"id": f"new_{i}", "title": f"New {i}", "from_year": 2000 + i, "importance_rank": rank}
        for i, rank in enumerate([3, 9, 8, 1])
    ], keep_unmentioned_events=True))
    result = asyncio.run(_refine(almost, "add four"))
    assert len(result.articles) == 600
    kept_new = {a.title for a in result.articles if a.title.startswith("New")}
    assert kept_new == {"New 1", "New 2"}  # the two highest-ranked
    TimelineData.model_validate(result.model_dump(by_alias=True))


def test_b18_persist_ai_timeline_refuses_empty_and_oversized(local_store):
    with pytest.raises(gemini_service.EmptyRefineResultError):
        asyncio.run(main._persist_ai_timeline({"id": "x", "title": "T", "articles": []}, OWNER, OWNER["id"], None, None))
    with pytest.raises(gemini_service.TimelineTooLargeError):
        asyncio.run(main._persist_ai_timeline({"id": "x", "title": "T", "articles": _articles(601)}, OWNER, OWNER["id"], None, None))
    assert _rows(local_store) == {}


def test_b18_chat_add_on_a_full_timeline_raises_before_enrichment(monkeypatch):
    enriched = []

    async def fake_enrich(*a, **k):
        enriched.append(1)
        return []

    monkeypatch.setattr(main, "enrich_events_with_wikipedia", fake_enrich)
    full = TimelineData.model_validate({"id": "tl-full", "title": "Full", "articles": _articles(600)})
    chat_result = TimelineChatOutput.model_validate({
        "reply": "Added.", "action": "edit", "edit_type": "event_add",
        "new_event": {"title": "One more", "from_year": 2001},
    })
    with pytest.raises(gemini_service.TimelineTooLargeError):
        asyncio.run(main._apply_chat_edit(chat_result, full, None, "paid", OWNER))
    assert enriched == [] and len(full.articles) == 600


def test_b18_empty_save_is_422_empty_timeline(api, local_store):
    _seed(local_store, _owned("tl-e"))
    before = copy.deepcopy(_rows(local_store)["tl-e"])
    res = api.post("/api/timelines", json={"id": "tl-e", "title": "Stored", "articles": []})
    assert res.status_code == 422
    assert res.json()["code"] == "empty_timeline" and res.json()["detail"]
    assert _rows(local_store)["tl-e"] == before


def test_b18_job_value_error_is_refunded_and_keeps_its_code(monkeypatch):
    refunds = []
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: refunds.append(job.get("user_id")))

    async def run():
        job_id = main._create_ai_job(OWNER, incremented_quota=True)

        async def op():
            raise gemini_service.EmptyRefineResultError()

        await main._run_ai_job(job_id, op, OWNER, "refine")
        return main._AI_JOBS.pop(job_id)

    job = asyncio.run(run())
    assert job["status"] == "error" and job["status_code"] == 400
    assert job["code"] == "empty_refine_result"
    assert refunds == [OWNER["id"]]


# --------------------------------------------------------------------------------------------
# B-17: chat surgical delete / edit match exactly
# --------------------------------------------------------------------------------------------

def _wars() -> TimelineData:
    return TimelineData.model_validate({
        "id": "tl-wars", "title": "Wars",
        "lanes": [{"id": "main", "title": "Main"}],
        "articles": [
            {"id": "w1", "title": "World War I", "from": {"year": 1914}, "lane": "main"},
            {"id": "w2", "title": "World War II", "from": {"year": 1939}, "lane": "main"},
            {"id": "w3", "title": "Cold War", "from": {"year": 1947}, "lane": "main"},
        ],
    })


@pytest.fixture
def chat_env(monkeypatch):
    persisted = []
    deep_refines = []

    async def fake_persist(tl_dict, user, target_owner, existing_meta, base_updated_at):
        persisted.append([a["id"] for a in tl_dict["articles"]])
        return {"persisted": True, "conflict": False, "updatedAt": "v2"}

    async def fake_failover(fn, api_key, key_tier, label=""):
        deep_refines.append(label)
        return _wars()

    monkeypatch.setattr(main, "_persist_ai_timeline", fake_persist)
    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    return SimpleNamespace(persisted=persisted, deep_refines=deep_refines)


def _chat(edit_type: str, **fields) -> TimelineChatOutput:
    return TimelineChatOutput.model_validate({
        "reply": "Done.", "action": "edit", "edit_type": edit_type, "edit_instruction": "do it", **fields,
    })


def test_b17_delete_by_title_hits_only_the_exact_event(chat_env):
    updated = asyncio.run(main._apply_chat_edit(_chat("event_delete", target_event_id="World War II"), _wars(), None, "paid", OWNER))
    assert [a.id for a in updated.articles] == ["w1", "w3"]
    assert chat_env.deep_refines == []


def test_b17_delete_by_exact_id(chat_env):
    updated = asyncio.run(main._apply_chat_edit(_chat("event_delete", target_event_ids=["w1"]), _wars(), None, "paid", OWNER))
    assert [a.id for a in updated.articles] == ["w2", "w3"]


@pytest.mark.parametrize("target", ["World War", "War", "", "   "])
def test_b17_partial_or_empty_title_never_deletes_surgically(chat_env, target):
    timeline = _wars()
    asyncio.run(main._apply_chat_edit(_chat("event_delete", target_event_id=target), timeline, None, "paid", OWNER))
    # Nothing was removed by the surgical path; deep refine (which sees every event) decided instead.
    assert chat_env.deep_refines == ["chat edit"]
    assert all(ids == ["w1", "w2", "w3"] for ids in chat_env.persisted)


def test_b17_ambiguous_titles_fall_through(chat_env):
    timeline = _wars()
    timeline.articles.append(timeline.articles[1].model_copy(update={"id": "w2b"}))
    asyncio.run(main._apply_chat_edit(_chat("event_delete", target_event_id="World War II"), timeline, None, "paid", OWNER))
    assert chat_env.deep_refines == ["chat edit"]


def test_b17_edit_targets_the_exact_title_case_insensitively(chat_env):
    updated = asyncio.run(main._apply_chat_edit(
        _chat("event_edit", target_event_id="  world war i ", event_edits={"title": "The Great War"}),
        _wars(), None, "paid", OWNER,
    ))
    titles = {a.id: a.title for a in updated.articles}
    assert titles == {"w1": "The Great War", "w2": "World War II", "w3": "Cold War"}


def test_b17_edit_with_a_partial_title_does_not_edit_the_first_substring_match(chat_env):
    asyncio.run(main._apply_chat_edit(
        _chat("event_edit", target_event_id="World War", event_edits={"title": "Renamed"}),
        _wars(), None, "paid", OWNER,
    ))
    assert chat_env.deep_refines == ["chat edit"]


# --------------------------------------------------------------------------------------------
# B-19 / B-20: generation results always fit TimelineData, and keep enrichment media fields
# --------------------------------------------------------------------------------------------

def _huge_output(n_events=650) -> GeminiTimelineOutput:
    return GeminiTimelineOutput(
        title="Huge", description="d", overview="o",
        lanes=[{"id": f"l{i}", "title": f"Lane {i}"} for i in range(50)],
        time_bands=[{"title": f"Band {i}", "from_year": 1000 + i, "to_year": 1001 + i} for i in range(150)],
        events=[GeminiEventItem(title=f"Event {i}", from_year=1000 + i) for i in range(n_events)],
        related_prompts=[f"p{i}" for i in range(40)],
        chat_questions=[f"q{i}" for i in range(40)],
        chat_edit_ideas=[f"i{i}" for i in range(40)],
        categories=[f"c{i}" for i in range(30)],
        tags=[f"t{i}" for i in range(60)],
    )


def test_b19_huge_unlimited_generation_is_capped_before_enrichment(monkeypatch):
    stub = _ModelStub(monkeypatch, _huge_output())
    token = gemini_service.set_model_response_hook(stub.count_hook)
    try:
        timeline = asyncio.run(gemini_service.generate_timeline_with_gemini(
            "1000 events", api_key="k", allow_large=True, enable_ai_fallback_images=False,
        ))
    finally:
        gemini_service._model_response_hook.reset(token)
    assert len(stub.enrich_inputs[0]) == 600
    assert stub.hook_calls_before_enrich == [1]  # B-16: marked before enrichment
    assert len(timeline.articles) == 600 and len(timeline.lanes) == 40 and len(timeline.timeBands) == 120
    assert len(timeline.relatedPrompts) == 30 and len(timeline.chatQuestions) == 30 and len(timeline.chatEditIdeas) == 30
    assert len(timeline.categories) == 20 and len(timeline.tags) == 40
    TimelineData.model_validate(timeline.model_dump(by_alias=True))


def test_b20_finalize_keeps_media_type_image_model_and_cost(monkeypatch):
    stub = _ModelStub(monkeypatch, None)
    stub.enrich_update = {
        "imageUrl": "https://upload.wikimedia.org/clip.webm", "imageSource": "wikimedia",
        "mediaType": "video", "imageModel": "gemini-image", "imageCostUsd": 0.039,
    }
    timeline = asyncio.run(gemini_service.finalize_timeline_from_parsed(
        _output([{"title": "Launch", "from_year": 1969}]), "Space", enable_ai_fallback_images=False,
    ))
    art = timeline.articles[0]
    assert (art.mediaType, art.imageModel, art.imageCostUsd, art.imageSource) == ("video", "gemini-image", 0.039, "wikimedia")


def test_b20_refine_new_events_keep_media_fields_and_bad_values_are_dropped(monkeypatch):
    stub = _ModelStub(monkeypatch, _output([{"id": "new_1", "title": "Moon", "from_year": 1969}], keep_unmentioned_events=True))
    stub.enrich_update = {"mediaType": "gif", "imageModel": "m" * 500, "imageCostUsd": float("nan")}
    result = asyncio.run(_refine(_treaty_timeline(), "add the moon landing"))
    moon = next(a for a in result.articles if a.title == "Moon")
    assert moon.mediaType == "gif" and moon.imageModel == "m" * 120 and moon.imageCostUsd is None
    assert gemini_service.article_media_kwargs({"mediaType": "audio"}).get("mediaType") is None


def test_b16_refine_calls_the_model_response_hook_before_enrichment(monkeypatch):
    stub = _ModelStub(monkeypatch, _output([{"id": "new_1", "title": "Moon", "from_year": 1969}], keep_unmentioned_events=True))
    token = gemini_service.set_model_response_hook(stub.count_hook)
    try:
        asyncio.run(_refine(_treaty_timeline(), "add the moon landing"))
    finally:
        gemini_service._model_response_hook.reset(token)
    assert stub.hook_calls_before_enrich == [1]


# --------------------------------------------------------------------------------------------
# B-16: cancel-refund lock and cancel during persist
# --------------------------------------------------------------------------------------------

def test_b16_model_response_marks_the_job_non_refundable(monkeypatch):
    refunds = []
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: refunds.append(1))

    async def run():
        job_id = main._create_ai_job(OWNER, client_ip="1.2.3.4", incremented_quota=True)
        reached = asyncio.Event()

        async def op():
            gemini_service._notify_model_response()  # the model has answered
            reached.set()
            await asyncio.sleep(30)  # "enrichment"

        task = asyncio.create_task(main._run_ai_job(job_id, op, OWNER, "generate"))
        main._AI_JOBS[job_id]["task"] = task
        await reached.wait()
        assert main._AI_JOBS[job_id]["can_refund_on_cancel"] is False
        res = await main.cancel_ai_job(job_id, _request(), OWNER)
        await asyncio.gather(task, return_exceptions=True)
        return res, main._AI_JOBS.pop(job_id)

    res, job = asyncio.run(run())
    assert res["status"] == "cancelled" and job["status"] == "cancelled"
    assert refunds == []  # tokens were already spent


def test_b16_cancel_during_persist_reports_the_saved_timeline(monkeypatch):
    refunds = []
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: refunds.append(1))
    entered, release = threading.Event(), threading.Event()

    def slow_save(tl, **kwargs):
        entered.set()
        release.wait(5)
        return {**tl, "updatedAt": "v-saved"}

    monkeypatch.setattr(main, "save_timeline_data", slow_save)

    async def run():
        job_id = main._create_ai_job(OWNER, client_ip="1.2.3.4", incremented_quota=True)

        async def op():
            gemini_service._notify_model_response()
            saved = await main._persist_timeline_dict(
                {"id": "tl-p", "title": "T", "articles": _articles(1)}, user=OWNER,
                target_owner=OWNER["id"], existing_meta=None, id_is_server_generated=True,
            )
            return saved

        task = asyncio.create_task(main._run_ai_job(job_id, op, OWNER, "generate"))
        main._AI_JOBS[job_id]["task"] = task
        await asyncio.to_thread(entered.wait, 5)
        cancel = asyncio.create_task(main.cancel_ai_job(job_id, _request(), OWNER))
        await asyncio.sleep(0.05)
        assert not cancel.done()  # waits for the save instead of reporting "cancelled"
        release.set()
        res = await cancel
        await task
        return res, main._AI_JOBS.pop(job_id)

    res, job = asyncio.run(run())
    assert res["status"] == "done"
    assert res["timeline_id"] == "tl-p" and res["persisted"] is True
    assert job["status"] == "done" and job["result"]["updatedAt"] == "v-saved"
    assert refunds == []


# --------------------------------------------------------------------------------------------
# B-09: job-based attach-files route (start, poll, cancel, refund) and the sync routes' cancel refund
# --------------------------------------------------------------------------------------------

def _poll(client, job_id, until=("done", "error", "cancelled"), tries=100):
    body = None
    for _ in range(tries):
        body = client.get(f"/api/timeline/job/status/{job_id}").json()
        if body.get("status") in until:
            return body
        time.sleep(0.02)
    return body


def _attach(client, timeline: Dict[str, Any]):
    return client.post(
        "/api/timeline/chat/attach-files/start",
        data={"timeline": json.dumps(timeline), "message": "add these"},
        files=[("files", ("notes.md", b"# Notes\n- 1977: Voyager 1 launched", "text/markdown"))],
    )


@pytest.fixture
def attach_env(monkeypatch, no_activity):
    refunds = []
    monkeypatch.setattr(main, "resolve_gemini_key", lambda *a, **k: ("KEY", "custom", False))
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: refunds.append(job.get("quota_credits")))
    return SimpleNamespace(refunds=refunds)


def test_b09_attach_files_job_saves_and_returns_the_chat_edit(api, local_store, attach_env, monkeypatch):
    _seed(local_store, _owned("tl-a", "v1"))
    snapshot = {k: v for k, v in _owned("tl-a", "v1").items() if k != "user_id"}
    seen = {}

    async def fake_refine(current_timeline, instruction, api_key=None, files=None, extracted_documents=None, **kw):
        seen["docs"] = extracted_documents
        data = current_timeline.model_dump(by_alias=True)
        data["articles"].append({"id": "evt-voy", "title": "Voyager 1", "from": {"year": 1977}})
        return TimelineData.model_validate(data)

    monkeypatch.setattr(main, "refine_timeline_with_gemini", fake_refine)
    res = _attach(api, snapshot)
    assert res.status_code == 200, res.text
    body = _poll(api, res.json()["job_id"])

    assert body["status"] == "done", body
    result = body["result"]
    assert result["action"] == "edit" and result["persisted"] is True
    assert result["timeline_id"] == "tl-a" and body["timeline_id"] == "tl-a" and body["persisted"] is True
    row = _rows(local_store)["tl-a"]
    assert [a["id"] for a in row["articles"]][-1] == "evt-voy"
    assert result["updated_timeline"]["updatedAt"] == row["updatedAt"] != "v1"
    assert seen["docs"] and "Voyager" in seen["docs"][0][1]
    assert attach_env.refunds == []


def test_b09_attach_files_job_failure_is_refunded(api, local_store, attach_env, monkeypatch):
    _seed(local_store, _owned("tl-a", "v1"))
    snapshot = {k: v for k, v in _owned("tl-a", "v1").items() if k != "user_id"}

    async def failing_refine(*a, **k):
        raise RuntimeError("model down")

    monkeypatch.setattr(main, "refine_timeline_with_gemini", failing_refine)
    res = _attach(api, snapshot)
    assert res.status_code == 200, res.text
    body = _poll(api, res.json()["job_id"])
    assert body["status"] == "error"
    assert len(attach_env.refunds) == 1
    assert _rows(local_store)["tl-a"]["updatedAt"] == "v1"


def test_b09_attach_files_job_cancel_before_the_model_answers_is_refunded(api, local_store, attach_env, monkeypatch):
    _seed(local_store, _owned("tl-a", "v1"))
    snapshot = {k: v for k, v in _owned("tl-a", "v1").items() if k != "user_id"}

    async def slow_refine(*a, **k):
        await asyncio.sleep(30)

    monkeypatch.setattr(main, "refine_timeline_with_gemini", slow_refine)
    monkeypatch.setattr(main, "_allow_cancel_refund_for_caller", lambda *a, **k: True)
    res = _attach(api, snapshot)
    job_id = res.json()["job_id"]
    assert _poll(api, job_id, until=("pending",))["status"] == "pending"
    cancel = api.post(f"/api/timeline/job/cancel/{job_id}")
    assert cancel.status_code == 200 and cancel.json()["status"] == "cancelled"
    assert len(attach_env.refunds) == 1
    assert _poll(api, job_id)["status"] == "cancelled"
    assert _rows(local_store)["tl-a"]["updatedAt"] == "v1"


def test_b09_generate_from_files_start_result_carries_the_stored_version(api, local_store, attach_env, monkeypatch):
    async def fake_generate_from_files(**kwargs):
        return TimelineData.model_validate({"id": "tl-gen-files", "title": "From files", "articles": _articles(2)})

    monkeypatch.setattr(main, "generate_timeline_from_files", fake_generate_from_files)
    res = api.post(
        "/api/timeline/generate-from-files/start",
        data={"context": "notes"},
        files=[("files", ("notes.md", b"# Notes\n- 1977: Voyager", "text/markdown"))],
    )
    assert res.status_code == 200, res.text
    body = _poll(api, res.json()["job_id"])
    assert body["status"] == "done", body
    row = _rows(local_store)["tl-gen-files"]
    assert body["result"]["updatedAt"] == row["updatedAt"] and row["updatedAt"]


def _stub_sync_upload(monkeypatch, refunds):
    async def verify(timeline_id, user):
        return user["id"], None

    async def no_rehydrate(*a, **k):
        return None

    async def fake_validate(*a, **k):
        return SimpleNamespace(
            binary_files=[], extracted_documents=[("n.md", "x")], total_accepted_files=1, image_count=0,
            doc_count=1, total_pdf_pages=0,
        )

    async def record_refund(user, client_ip, key_tier, custom_key, credits=None):
        refunds.append(credits)

    monkeypatch.setattr(main, "_verify_timeline_mutation_target", verify)
    monkeypatch.setattr(main, "_rehydrate_stripped_timeline_media", no_rehydrate)
    monkeypatch.setattr(main, "validate_and_read_uploads", fake_validate)
    monkeypatch.setattr(main, "calculate_upload_credit_cost", lambda *a, **k: 2)
    monkeypatch.setattr(main, "resolve_gemini_key", lambda *a, **k: ("KEY", "paid", False))
    monkeypatch.setattr(main, "_refund_sync_call_quota", record_refund)


def test_b09_sync_attach_route_refunds_when_cancelled(monkeypatch):
    refunds = []
    _stub_sync_upload(monkeypatch, refunds)

    async def cancelled(*a, **k):
        raise asyncio.CancelledError()

    monkeypatch.setattr(main, "_execute_chat_attach_files", cancelled)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main.chat_attach_files_endpoint(
            request=_request(), timeline=json.dumps({"id": "tl-s", "title": "T", "articles": _articles(1)}),
            message=None, content_mode=None, input_method=None, media_stripped=False, files=[],
            x_gemini_api_key=None, user=OWNER,
        ))
    assert refunds == [2]


def test_b09_sync_files_route_refunds_when_cancelled(monkeypatch, no_activity):
    refunds = []
    _stub_sync_upload(monkeypatch, refunds)

    async def cancelled(*a, **k):
        raise asyncio.CancelledError()

    monkeypatch.setattr(main, "run_with_key_failover", cancelled)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main.generate_timeline_from_files_endpoint(
            request=_request(), files=[], text=None, context="c", content_mode="classic", prompt_mode=False,
            enable_grounding=False, ui_language=None, enable_ai_fallback_images=None, input_method=None,
            x_gemini_api_key=None, user=OWNER,
        ))
    assert refunds == [2]


# --------------------------------------------------------------------------------------------
# B-04 follow-up (a): generation results carry the stored version
# --------------------------------------------------------------------------------------------

def test_b04a_generation_job_result_has_the_stored_updated_at(local_store, monkeypatch, no_activity):
    async def fake_failover(fn, api_key, key_tier, label=""):
        return TimelineData.model_validate({"id": "tl-gen", "title": "Generated", "articles": _articles(2)})

    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    req = main.GenerateTimelineRequest(prompt="space race")
    result = asyncio.run(main._execute_generation(req, "key", "paid", OWNER))
    row = _rows(local_store)["tl-gen"]
    assert result["updatedAt"] and result["updatedAt"] == row["updatedAt"]
    assert result["createdAt"] == row["createdAt"]


# --------------------------------------------------------------------------------------------
# B-23: Library catalog cache
# --------------------------------------------------------------------------------------------

def _library_rows(n: int) -> Dict[str, dict]:
    rows = {}
    for i in range(n):
        tid = f"lib-{i:03d}"
        rows[tid] = {
            "id": tid, "title": f"Library {i}", "description": "d", "time_scale": None,
            "updated_at": f"2026-01-01T00:00:{i % 60:02d}Z", "created_at": "2026-01-01T00:00:00Z",
            "data": {
                "id": tid, "title": f"Library {i}", "description": "d", "isLibrary": True,
                "articles": [{"id": "a", "title": "A", "from": {"year": 1}}],
            },
        }
    return rows


class _FakeLibraryDb:
    def __init__(self, rows: Dict[str, dict]):
        self.rows = rows
        self.index_calls: List[Dict[str, str]] = []
        self.fail_chunk_ids: set = set()
        self.on_index = None

    def client(self):
        db = self

        class _Resp:
            def __init__(self, status_code, payload):
                self.status_code, self._payload = status_code, payload

            def json(self):
                return self._payload

        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None, params=None):
                params = params or {}
                if params.get("select") == storage._LIGHT_LIBRARY_INDEX_SELECT:
                    db.index_calls.append(dict(params))
                    if db.on_index:
                        db.on_index()
                    ordered = list(db.rows.values())
                    offset, limit = int(params.get("offset", 0)), int(params.get("limit", 10_000))
                    page = ordered[offset: offset + limit]
                    return _Resp(200, [{k: v for k, v in r.items() if k != "data"} for r in page])
                if str(params.get("id", "")).startswith("in.("):
                    ids = [i.strip('"') for i in params["id"][4:-1].split(",")]
                    if db.fail_chunk_ids & set(ids):
                        return _Resp(500, [])
                    return _Resp(200, [db.rows[i] for i in ids if i in db.rows])
                return _Resp(500, [])

        return _Client()


@pytest.fixture
def library_db(monkeypatch):
    storage.invalidate_library_cache()
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "_trigger_background_library_refresh", lambda: None)
    monkeypatch.setattr(storage, "_get_podcast_folders_safe", lambda: set())
    db = _FakeLibraryDb(_library_rows(45))
    monkeypatch.setattr(storage, "_supabase_http_client", db.client)
    yield db
    storage.invalidate_library_cache()


def test_b23_index_is_paginated_beyond_200_rows(library_db, monkeypatch):
    library_db.rows = _library_rows(450)
    items = storage.list_library_timelines(force_refresh=True)
    assert len(items) == 450
    assert [c["offset"] for c in library_db.index_calls] == ["0", "200", "400"]


def test_b23_partial_catalog_gets_a_short_ttl(library_db):
    library_db.fail_chunk_ids = {"lib-000"}
    items = storage.list_library_timelines(force_refresh=True)
    assert 0 < len(items) < 45
    assert storage._LIBRARY_CACHE_PARTIAL is True
    with storage._LIBRARY_CACHE_LOCK:
        assert storage._library_cache_ttl() == storage._LIBRARY_PARTIAL_CACHE_TTL_SECONDS


def test_b23_partial_rebuild_keeps_the_previous_complete_catalog(library_db):
    complete = storage.list_library_timelines(force_refresh=True)
    assert len(complete) == 45 and storage._LIBRARY_CACHE_PARTIAL is False
    # Cards are re-fetched only when their content changed: change every row, then fail one chunk.
    for row in library_db.rows.values():
        row["updated_at"] = "2026-02-01T00:00:00Z"
    library_db.fail_chunk_ids = {"lib-000"}
    again = storage.list_library_timelines(force_refresh=True)
    assert len(again) == 45
    assert len(storage._LIBRARY_CACHE_ITEMS) == 45 and storage._LIBRARY_CACHE_PARTIAL is False


def test_b23_rebuild_started_before_an_invalidation_does_not_cache_its_result(library_db):
    library_db.on_index = lambda: storage.invalidate_library_cache("lib-001")
    items = storage.list_library_timelines(force_refresh=True)
    assert len(items) == 45
    assert storage._LIBRARY_CACHE_ITEMS is None  # the next request rebuilds from fresh data
