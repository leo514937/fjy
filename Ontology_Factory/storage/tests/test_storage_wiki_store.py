from __future__ import annotations

from pathlib import Path

from ontology_store import OntologyStore


def test_store_persists_wiki_pages_revisions_links_and_steps(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    run = store.start_wiki_run(mode="single", input_root="sample.txt", manifest={"input_files": ["sample.txt"]})

    page_a = store.create_page(title="智能养鱼系统", slug="智能养鱼系统", page_type="system")
    revision_a = store.create_revision(
        page_id=page_a.page_id,
        run_id=run.run_id,
        content_markdown="# 智能养鱼系统\n\n## 概述\n用于鱼缸环境自动控制。",
        summary="用于鱼缸环境自动控制。",
        reason="unit-test",
    )
    page_b = store.create_page(title="ESP8266", slug="esp8266", page_type="entity")
    store.create_revision(
        page_id=page_b.page_id,
        run_id=run.run_id,
        content_markdown="# ESP8266\n\n## 概述\n微控制器模块。",
        summary="微控制器模块。",
        reason="unit-test",
    )
    source = store.append_page_source(
        page_id=page_a.page_id,
        document_id="doc_1",
        source_sentence="系统使用 ESP8266 连接 OneNet。",
        evidence_text="系统使用 ESP8266 连接 OneNet。",
    )
    link = store.link_pages(
        source_page_id=page_a.page_id,
        target_page_id=page_b.page_id,
        link_type="related_to",
        anchor_text="同文档共现",
    )
    step = store.record_agent_step(
        run_id=run.run_id,
        page_id=page_a.page_id,
        thought="先建立系统页。",
        action_name="create_page",
        action_input_json={"title": "智能养鱼系统"},
        observation_json={"page_id": page_a.page_id},
    )
    store.complete_wiki_run(run_id=run.run_id, status="completed", manifest={"created_pages": ["智能养鱼系统"]})

    page_payload = store.read_page(page_a.page_id)
    assert page_payload is not None
    assert page_payload["page"]["current_revision_id"] == revision_a.revision_id
    assert source.page_id == page_a.page_id
    assert link.target_page_id == page_b.page_id
    assert step.action_name == "create_page"
    assert store.search_pages("养鱼")
    assert store.list_related_pages(page_a.page_id)
    assert store.list_wiki_agent_steps(run.run_id)


def test_store_update_page_skips_identical_revision(tmp_path: Path) -> None:
    store = OntologyStore(str(tmp_path / "wiki.sqlite3"))
    page = store.create_page(title="OneNet", slug="onenet", page_type="entity")
    first = store.create_revision(
        page_id=page.page_id,
        run_id="run_1",
        content_markdown="# OneNet\n\n## 概述\n云平台。",
        summary="云平台。",
        reason="initial",
    )

    refreshed, revision, status = store.update_page(
        page_id=page.page_id,
        run_id="run_2",
        content_markdown="# OneNet\n\n## 概述\n云平台。",
        summary="云平台。",
        reason="same",
    )

    assert refreshed.page_id == page.page_id
    assert revision is None
    assert status == "skipped"
    assert store.read_page(page.page_id)["current_revision"]["revision_id"] == first.revision_id
