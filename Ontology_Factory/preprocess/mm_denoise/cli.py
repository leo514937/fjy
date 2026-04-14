from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from .config import load_config
from .io_loaders import discover_inputs, load_document, normalize_text_for_pipeline
from .pipeline import run_pipeline


def _write_output(out_dir: Path, input_path: Path, clean_text: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_stem = input_path.stem
    out_path = out_dir / f"{safe_stem}.clean.txt"
    out_path.write_text(clean_text, encoding="utf-8")
    return out_path


def _write_report(out_dir: Path, input_path: Path, out_path: Path, pipeline_out) -> Path:
    safe_stem = input_path.stem
    report_path = out_dir / f"{safe_stem}.report.json"

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": {
            "path": str(input_path),
            "suffix": input_path.suffix.lower(),
        },
        "output": {
            "clean_text_path": str(out_path),
            "report_path": str(report_path),
        },
        "rules": {
            "removed_lines": pipeline_out.rule_based.removed_lines,
            "merged_wrap_lines": pipeline_out.rule_based.merged_wrap_lines,
        },
        "models": {
            "enabled": pipeline_out.model_arbitration is not None,
            "candidates": [
                {
                    "name": m.name,
                    "confidence": m.confidence,
                    "notes": m.notes,
                }
                for m in pipeline_out.model_outputs
            ],
        },
        "arbitration": None,
    }

    if pipeline_out.model_arbitration is not None:
        report["arbitration"] = {
            "chosen_name": pipeline_out.model_arbitration.chosen_name,
            "rationale": pipeline_out.model_arbitration.rationale,
            "rejected": pipeline_out.model_arbitration.rejected,
        }

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def main() -> int:
    ap = argparse.ArgumentParser(description="Multi-model conservative document denoiser (clean text only).")
    ap.add_argument("--config", required=True, help="Path to config.yaml")
    ap.add_argument("--input", default=None, help="Single input file path. If omitted, use io.input_globs.")
    ap.add_argument("--base-dir", default=".", help="Base directory for glob discovery.")
    args = ap.parse_args()

    cfg = load_config(args.config)

    if args.input:
        inputs = [args.input]
    else:
        inputs = discover_inputs(cfg.io.input_globs, args.base_dir)

    if not inputs:
        raise SystemExit("No input files found.")

    out_dir = Path(args.base_dir) / cfg.io.output_dir

    for ip in inputs:
        doc = load_document(ip, cfg.io.encoding_fallbacks)
        raw = normalize_text_for_pipeline(doc.text)
        print(f"[START] input={doc.path}")
        print(f"[TEXT] raw_chars={len(raw)} raw_lines={raw.count(chr(10)) + 1}")
        print(f"[MODELS] enabled={cfg.models.enabled} candidates={len(cfg.models.candidates)}")
        out = run_pipeline(raw, cfg)
        out_path = _write_output(out_dir, doc.path, out.clean_text)
        report_path = _write_report(out_dir, doc.path, out_path, out)

        # Minimal stdout: keep it script-friendly
        print(f"[OK] {doc.path} -> {out_path}")
        if out.model_arbitration is not None:
            print(f"     chosen={out.model_arbitration.chosen_name} reason={out.model_arbitration.rationale}")
        print(f"     rule_removed_lines={out.rule_based.removed_lines} rule_merged_wrap={out.rule_based.merged_wrap_lines}")
        print(f"     report={report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

