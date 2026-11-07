"""S-06: podcast episodes on unknown timelines, per-timeline cap, owner-first ordering, private namespace."""
import copy

from test_podcast_api import (  # noqa: F401  (env is a fixture)
    OWNER,
    SCRIPT,
    STRANGER,
    TIMELINE,
    VIEWER,
    _create_episode,
    env,
)

import main
from services import podcast_store

CAP = main.MAX_EPISODES_PER_OWNER_TIMELINE  # the smallest cap the env var can set


def _seed(owner_id, created_at, private=False, timeline_id="tl-1", episode_id=None):
    doc = copy.deepcopy(SCRIPT)
    doc.update({
        "id": episode_id or podcast_store.new_episode_id(private=private),
        "timeline_id": timeline_id,
        "owner_id": owner_id,
        "created_by_admin": False,
        "created_at": created_at,
        "updated_at": created_at,
        "source": "generated",
        "default_engine": "edge",
        # Intro-only script: never matches a new request, so starts always generate a fresh episode.
        "segments": [copy.deepcopy(SCRIPT["segments"][0])],
        "audio": {},
    })
    podcast_store.save_episode(doc)
    return doc["id"]


def _listed(client):
    return [e["id"] for e in client.get("/api/timelines/tl-1/podcasts").json()["episodes"]]


def test_can_view_timeline_rejects_unknown_timeline():
    assert main._can_view_timeline(None, OWNER) is False
    assert main._can_view_timeline({}, None) is False


def test_podcast_routes_on_nonexistent_timeline_return_404(env):
    client = env["client"]
    ghost = dict(TIMELINE, id="ghost-tl")
    res = client.post("/api/timelines/ghost-tl/podcasts/start", json={"timeline": ghost, "tts_engine": "edge"})
    assert res.status_code == 404
    assert client.get("/api/timelines/ghost-tl/podcasts").status_code == 404
    assert client.get("/api/timelines/ghost-tl/podcasts/abc123").status_code == 404
    assert podcast_store.list_episodes("ghost-tl") == []


def test_non_owner_episode_is_private_and_never_published(env):
    client = env["client"]
    env["meta"]["tl-1"]["is_shared"] = True
    env["meta"]["tl-1"]["is_library"] = True

    env["as_user"](VIEWER)
    viewer_ep = _create_episode(client)["episode"]["id"]
    assert podcast_store.is_private_episode_id(viewer_ep)
    # Only private episodes so far: the timeline doesn't count as having a podcast.
    podcast_store.invalidate_podcast_folders_cache()
    assert podcast_store.has_timeline_episodes("tl-1") is False
    assert viewer_ep in _listed(client)  # its creator still sees it

    env["as_user"](STRANGER)
    assert viewer_ep not in _listed(client)
    assert client.get(f"/api/timelines/tl-1/podcasts/{viewer_ep}").status_code == 404
    env["as_user"](None)
    assert viewer_ep not in _listed(client)

    env["as_user"](OWNER)
    owner_ep = _create_episode(client)["episode"]["id"]
    assert not podcast_store.is_private_episode_id(owner_ep)
    podcast_store.invalidate_podcast_folders_cache()
    assert podcast_store.has_timeline_episodes("tl-1") is True
    env["as_user"](STRANGER)
    assert _listed(client) == [owner_ep]


def test_cap_refuses_new_non_owner_episodes(env, monkeypatch):
    monkeypatch.setenv("MAX_EPISODES_PER_TIMELINE_TOTAL", str(CAP))
    client = env["client"]
    env["meta"]["tl-1"]["is_shared"] = True
    for i in range(CAP):
        _seed(f"guest-{i}", f"2026-01-01T00:00:{i:02d}+00:00", private=True)

    env["as_user"](VIEWER)
    res = client.post(
        "/api/timelines/tl-1/podcasts/start",
        json={"timeline": TIMELINE, "format": "single", "voice_gender": "male", "length": "full", "tts_engine": "edge"},
    )
    assert res.status_code == 409
    assert len(podcast_store.list_episodes("tl-1")) == CAP


def test_owner_episodes_survive_the_cap_and_are_listed_first(env, monkeypatch):
    monkeypatch.setenv("MAX_EPISODES_PER_TIMELINE_TOTAL", str(CAP))
    client = env["client"]
    env["meta"]["tl-1"]["is_shared"] = True
    owner_old = _seed(OWNER["id"], "2025-01-01T00:00:00+00:00")  # oldest of all
    strangers = [
        _seed(f"guest-{i}", f"2026-01-01T00:00:{i:02d}+00:00", private=True) for i in range(CAP - 1)
    ]

    env["as_user"](OWNER)
    owner_new = _create_episode(client)["episode"]["id"]  # at the cap: makes room by pruning others

    remaining = {d["id"] for d in podcast_store.list_episodes("tl-1")}
    assert len(remaining) == CAP
    assert {owner_old, owner_new} <= remaining
    assert strangers[0] not in remaining  # the oldest other-creator episode went
    assert set(strangers[1:]) <= remaining

    listed = _listed(client)
    assert listed[:2] == [owner_new, owner_old]  # owner's first, newest first
    assert set(listed[2:]) == set(strangers[1:])


def test_list_reads_more_than_the_old_forty_object_window(env, monkeypatch):
    client = env["client"]
    env["meta"]["tl-1"]["is_shared"] = True
    # Pre-fix layout: other people's episodes in the public folder. Object names list in id order,
    # so an owner episode whose id sorts last fell outside the old first-40 window.
    for i in range(45):
        _seed(f"guest-{i}", f"2026-01-01T00:{i:02d}:00+00:00", episode_id=f"a{i:031d}")
    owner_ep = _seed(OWNER["id"], "2025-01-01T00:00:00+00:00", episode_id="f" * 32)
    env["as_user"](STRANGER)
    assert _listed(client) == [owner_ep]
