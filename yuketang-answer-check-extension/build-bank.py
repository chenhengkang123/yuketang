#!/usr/bin/env python3
"""Parse course 题库.txt files into bank.js (工程伦理 + 人工智能安全与伦理 + 中国式现代化)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT_PATH = ROOT / "bank.js"

SPLIT = "----------------------------------------"
STEM_NUM = re.compile(r"^\d+\.\s*")
OPT_LINE = re.compile(r"^(?:([A-E])|true|false)[\.、．]\s*(.*)$", re.I)
LECTURE = re.compile(r"^第\d+讲")
CHAPTER = re.compile(r"^第[一二三四五六七八九十\d]+\s*章")
CLOSING = re.compile(r"^结语$")
CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}

COURSES = [
    {
        "id": "ethics",
        "dir": REPO / "BUAA-Engineering-Ethics",
        "std": "题库.txt",
        "enc": "题库-存在编码问题.txt",
        "expect": 303,
    },
    {
        "id": "ai",
        "dir": REPO / "BUAA-AI-Security-and-Ethics",
        "std": "题库.txt",
        "enc": None,
        "expect": 280,
    },
    {
        "id": "modern",
        "dir": REPO / "BUAA-Chinese-Modernization",
        "std": "题库.txt",
        "enc": None,
        "expect": 370,
    },
]


def chapter_num(token: str) -> int:
    if token.isdigit():
        return int(token)
    return CN_NUM.get(token, 0)


def normalize_unit(header: str, course: str) -> str:
    raw = header.strip()
    if course != "ai":
        return raw
    m = re.match(r"^第([一二三四五六七八九十\d]+)\s*章\s*[-—–]?\s*(.*)$", raw)
    if not m:
        return raw
    n = chapter_num(m.group(1))
    title = re.sub(r"\s+", " ", m.group(2)).strip(" -—–")
    return f"第{n:02d}章 {title}"


def parse_file(path: Path, headers: bool, course: str) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    items: list[dict] = []
    lecture = ""
    for raw in text.split(SPLIT):
        block = raw.strip()
        if not block or block.startswith("\x1a") or len(block) < 8:
            continue
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        if headers and (LECTURE.match(lines[0]) or CHAPTER.match(lines[0]) or CLOSING.match(lines[0])):
            lecture = normalize_unit(lines[0], course)
            lines = lines[1:]
            if not lines:
                continue
        stem_parts: list[str] = []
        options: list[dict] = []
        answer_raw = ""
        for ln in lines:
            t = ln.strip()
            if t.startswith("参考答案"):
                answer_raw = t.split("：", 1)[-1].split(":", 1)[-1].strip()
                continue
            m = OPT_LINE.match(t)
            if m:
                key = (m.group(1) or t.split(".", 1)[0]).strip()
                if key.lower() == "true":
                    key = "true"
                elif key.lower() == "false":
                    key = "false"
                options.append({"k": key, "t": (m.group(2) or "").strip()})
                continue
            if not options:
                stem_parts.append(STEM_NUM.sub("", t))
        stem = "".join(stem_parts).strip()
        if not stem or not answer_raw:
            continue
        items.append({
            "lecture": lecture,
            "stem": stem,
            "options": options,
            "answerRaw": answer_raw,
        })
    return items


def classify(answer_raw: str, options: list[dict]) -> tuple[str, list[str], list[str]]:
    if not options:
        return "fill", [answer_raw], [answer_raw]
    raw = answer_raw.replace(" ", "")
    if raw in ("✔", "正确"):
        return "judge", ["true"], ["正确"]
    if raw in ("❌", "错误"):
        return "judge", ["false"], ["错误"]
    keys = [p.strip() for p in re.split(r"[,，、]", answer_raw) if p.strip()]
    by_key = {o["k"]: o["t"] for o in options}
    texts = [by_key[k] for k in keys if k in by_key]
    qtype = "multi" if len(keys) > 1 else "single"
    return qtype, keys, texts


def build_course(spec: dict) -> list[dict]:
    std_path = spec["dir"] / spec["std"]
    if not std_path.exists():
        raise SystemExit(f"missing {std_path}")
    std = parse_file(std_path, headers=True, course=spec["id"])
    if spec["expect"] and len(std) != spec["expect"]:
        raise SystemExit(f"{spec['id']}: expected {spec['expect']} items, got {len(std)}")
    enc: list[dict] = []
    if spec["enc"]:
        enc_path = spec["dir"] / spec["enc"]
        if enc_path.exists():
            enc = parse_file(enc_path, headers=False, course=spec["id"])
    bank = []
    counts: dict[str, int] = {}
    for i, item in enumerate(std):
        qtype, keys, texts = classify(item["answerRaw"], item["options"])
        alts = []
        if i < len(enc):
            alt = enc[i]["stem"]
            if alt and alt != item["stem"]:
                alts.append(alt)
        lec = item["lecture"]
        counts[lec] = counts.get(lec, 0) + 1
        bank.append({
            "c": spec["id"],
            "lec": lec,
            "no": counts[lec],
            "type": qtype,
            "stem": item["stem"],
            "alts": alts,
            "opts": item["options"],
            "ans": keys,
            "ansT": texts,
        })
    return bank


def main() -> None:
    bank: list[dict] = []
    for spec in COURSES:
        part = build_course(spec)
        for q in part:
            q["i"] = len(bank) + 1
            bank.append(q)
        units = {}
        for q in part:
            units[q["lec"]] = units.get(q["lec"], 0) + 1
        print(f"{spec['id']}: {len(part)} questions")
        print("  " + ", ".join(f"{k}={v}" for k, v in units.items()))

    OUT_PATH.write_text(
        "/* generated by build-bank.py — do not edit by hand */\n"
        "window.__YKT_ANSWER_BANK__ = "
        + json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT_PATH.name}: {len(bank)} questions, {OUT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    main()
