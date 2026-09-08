#!/usr/bin/env python3
"""마크다운 글을 티스토리 에디터에 붙여넣을 HTML 로 바꾼다.

티스토리는 2024년 2월에 Open API 를 없앴다. 글 작성·수정·이미지 첨부가 전부
막혀서 손으로 올리는 수밖에 없다. 이 스크립트는 그 손질을 줄인다.

붙여넣기 전제라서 외부 라이브러리를 쓰지 않는다. 파이썬만 있으면 돈다.
지원하는 문법은 우리 글에 실제로 쓰는 것만이다: 제목, 굵게, 링크, 표,
인용, 목록, 수평선. 코드블록은 안 쓰므로 뺐다.

사용법:
  to_tistory.py posts/2026-09-04-national-pension-age.md
    → 제목·태그·요약을 화면에 뿌리고, 본문 HTML 을 클립보드에 넣는다

  to_tistory.py --show <글.md>
    → 클립보드에 넣지 않고 HTML 만 출력한다
"""
import html
import os
import re
import subprocess
import sys


def split_front(raw):
    """프론트매터와 본문을 가른다."""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw, re.S)
    if not m:
        return {}, raw
    meta = {}
    for line in m.group(1).split("\n"):
        if ":" not in line or line.startswith(" "):
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip().strip('"')
    return meta, m.group(2)


def inline(text):
    """문장 안의 서식. 순서가 중요하다. 링크를 먼저 빼내야 대괄호가 안 깨진다."""
    slots = []

    def stash(repl):
        slots.append(repl)
        return "\x00%d\x00" % (len(slots) - 1)

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
                  lambda m: stash('<a href="%s" target="_blank">%s</a>'
                                  % (html.escape(m.group(2)), html.escape(m.group(1)))),
                  text)
    text = html.escape(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return re.sub(r"\x00(\d+)\x00", lambda m: slots[int(m.group(1))], text)


def table(rows):
    """마크다운 표를 HTML 표로. 티스토리 에디터가 마크다운 표를 못 받는다."""
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[2:]          # 1행은 헤더, 2행은 구분선
    out = ['<table style="border-collapse:collapse;width:100%">']
    out.append("<thead><tr>" + "".join(
        '<th style="border:1px solid #ddd;padding:8px;background:#f7f7f7;text-align:left">%s</th>'
        % inline(c) for c in head) + "</tr></thead><tbody>")
    for r in body:
        out.append("<tr>" + "".join(
            '<td style="border:1px solid #ddd;padding:8px">%s</td>' % inline(c)
            for c in r) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def convert(body):
    lines = body.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()

        if not s:
            i += 1
            continue

        # 표: 다음 줄이 구분선이면 표의 시작이다
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            out.append(table(block))
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            # 글 제목은 티스토리 제목칸에 따로 넣으므로 본문의 h1 은 h2 로 내린다
            level = min(len(m.group(1)) + 1, 4)
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2)), level))
            i += 1
            continue

        if re.match(r"^(-{3,}|\*{3,})$", s):
            out.append("<hr>")
            i += 1
            continue

        if s.startswith(">"):
            block = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                block.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append('<blockquote style="border-left:3px solid #ddd;margin:0;padding-left:14px;color:#555">'
                       "<p>%s</p></blockquote>" % inline(" ".join(block)))
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", s)
        if m:
            block = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                block.append(re.sub(r"^\d+\.\s+", "", lines[i].strip()))
                i += 1
            out.append("<ol>" + "".join("<li>%s</li>" % inline(x) for x in block) + "</ol>")
            continue

        if re.match(r"^[-*]\s+", s):
            block = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                block.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            out.append("<ul>" + "".join("<li>%s</li>" % inline(x) for x in block) + "</ul>")
            continue

        if s.startswith("!["):
            m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", s)
            if m:
                out.append("<!-- 이미지: %s (티스토리 에디터에서 직접 올릴 것) -->" % m.group(2))
                i += 1
                continue

        # 나머지는 문단. 빈 줄 전까지 이어 붙인다.
        block = []
        while i < len(lines) and lines[i].strip() and not re.match(
                r"^(#{1,4}\s|>|[-*]\s|\d+\.\s|\||!\[|-{3,}$)", lines[i].strip()):
            block.append(lines[i].strip())
            i += 1
        out.append("<p>%s</p>" % inline(" ".join(block)))

    return "\n".join(out)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show = "--show" in sys.argv
    if not args:
        sys.exit(__doc__)

    path = args[0]
    if not os.path.exists(path):
        sys.exit("%s 없음" % path)

    meta, body = split_front(open(path).read())
    htm = convert(body)

    if show:
        print(htm)
        return

    subprocess.run(["pbcopy"], input=htm.encode(), check=True)

    print("\n티스토리 글쓰기 화면에 이렇게 넣으세요.\n")
    print("  제목    %s" % meta.get("title", "(없음)"))
    tags = meta.get("tags", "").strip("[]")
    if tags:
        print("  태그    %s" % tags)
    if meta.get("description"):
        print("  요약    %s" % meta["description"])
    print()
    print("  본문    HTML 모드로 바꾼 뒤 붙여넣기 (클립보드에 담았습니다)")
    imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", body)
    if imgs:
        print("\n  이미지 %d개는 에디터에서 직접 올려야 합니다:" % len(imgs))
        for u in imgs:
            print("    %s" % u)
    print()


if __name__ == "__main__":
    main()
