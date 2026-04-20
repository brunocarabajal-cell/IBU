#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


SOURCE_FILES = [
    Path("/Users/brunocarabajal/Downloads/CC-AFF.13.001.001 - Responsables por Clase.pdf"),
    Path("/Users/brunocarabajal/Downloads/Organigrama Activos Fijos.pdf"),
    Path("/Users/brunocarabajal/Downloads/CC-AFF.13.001 - Gestion de Activos Obsoletos..pdf"),
    Path("/Users/brunocarabajal/Downloads/CC-AFF.06.005 - Gestión de Inventario de Bienes de Uso.pdf"),
]


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_chunks(text: str, max_chars: int = 1800):
    paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
    chunks = []
    current = []
    current_len = 0

    for paragraph in paragraphs:
        extra = len(paragraph) + (2 if current else 0)
        if current and current_len + extra > max_chars:
            chunks.append("\n\n".join(current))
            current = [paragraph]
            current_len = len(paragraph)
        else:
            current.append(paragraph)
            current_len += extra

    if current:
        chunks.append("\n\n".join(current))

    return chunks


def extract_doc(path: Path):
    reader = PdfReader(str(path))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        raw = page.extract_text() or ""
        text = normalize_text(raw)
        if text:
            pages.append({
                "page": index,
                "text": text,
                "chunks": split_chunks(text),
            })
    return {
        "source": path.name,
        "path": str(path),
        "pages": pages,
    }


def main():
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("backend/data/acti_docs/knowledge.json")
    docs = []
    for source in SOURCE_FILES:
        if not source.exists():
            continue
        docs.append(extract_doc(source))

    payload = {
        "documents": docs,
    }

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Escritos {len(docs)} documentos en {target}")


if __name__ == "__main__":
    main()
