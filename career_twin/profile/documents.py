"""Local text extraction only. The saved text is the offset authority; no OCR."""
from io import BytesIO
from pathlib import PurePath
from time import perf_counter
from uuid import uuid4
from zipfile import ZipFile

from career_twin.shared.core.errors import AppError

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 20000


def pdf_text(content):
    import pymupdf
    with pymupdf.open(stream=content, filetype='pdf') as document:
        if document.needs_pass:
            raise AppError('cv_encrypted', '請上傳未加密的 PDF。', 422)
        return '\n\n'.join(page.get_text('text', sort=True) for page in document)


def docx_text(content):
    from docx import Document
    from docx.table import Table
    # Bound expanded XML before handing it to python-docx.
    with ZipFile(BytesIO(content)) as archive:
        if sum(info.file_size for info in archive.infolist()) > 30 * 1024 * 1024:
            raise AppError('cv_too_large', 'DOCX 解壓後過大，請縮小檔案。', 413)

    def blocks(container):
        for block in container.iter_inner_content():
            if isinstance(block, Table):
                seen = set()
                for row in block.rows:
                    cells = []
                    for cell in row.cells:
                        if cell._tc not in seen:  # Merged cells appear more than once.
                            seen.add(cell._tc)
                            cells.append('\n'.join(blocks(cell)))
                    yield '\t'.join(cells)
            else:
                yield block.text

    document = Document(BytesIO(content))
    texts = []
    seen = set()
    for section in document.sections:
        for header in (section.header, section.first_page_header, section.even_page_header):
            if header._element not in seen:
                seen.add(header._element)
                texts.extend(blocks(header))
    texts.extend(blocks(document))
    for section in document.sections:
        for footer in (section.footer, section.first_page_footer, section.even_page_footer):
            if footer._element not in seen:
                seen.add(footer._element)
                texts.extend(blocks(footer))
    return '\n'.join(texts)


def txt_text(content):
    encoding = 'utf-16' if content.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
    return content.decode(encoding)


READERS = {'pdf': pdf_text, 'docx': docx_text, 'txt': txt_text}


def validate_text(text):
    if not text.strip():
        raise AppError('cv_no_text', '找不到可讀文字。請提供文字型 PDF、DOCX 或 TXT；不使用 OCR。', 422)
    if len(text) > MAX_CHARS:
        raise AppError('cv_too_long', 'CV 文字超過 20,000 字元，請縮短後重試。', 422)
    if '\x00' in text:
        raise AppError('cv_encoding', '文字編碼不支援，請使用 UTF-8 或帶 BOM 的 UTF-16。', 422)
    # Canonical browser-safe line endings, applied once before saving or AI.
    return text.replace('\r\n', '\n').replace('\r', '\n')


def parse_document(filename, content):
    started = perf_counter()
    filename = filename.replace('\\', '/').rsplit('/', 1)[-1]
    extension = PurePath(filename).suffix.lower().lstrip('.')
    reader = READERS.get(extension)
    if not reader:
        raise AppError('cv_format', '只支援 PDF、DOCX、TXT。', 422)
    if not content or len(content) > MAX_BYTES:
        raise AppError('cv_file_size', '檔案為空或超過 5 MB。', 422)
    try:
        text = validate_text(reader(content))
    except AppError:
        raise
    except Exception:
        raise AppError('cv_parse_failed', '無法讀取檔案，請確認格式、編碼及檔案內容。', 422) from None
    return dict(id='cv_' + uuid4().hex, text=text, format=extension,
                file_name=filename, file_size=len(content), parse_seconds=round(perf_counter() - started, 4))
