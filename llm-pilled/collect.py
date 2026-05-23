#!/usr/bin/env python3
"""Collect 2025 paper-title LLM counts for CSRankings-style conferences.

Primary source: DBLP publication API by table-of-contents facet (toc:...bht).
This avoids downloading huge DBLP HTML proceedings pages. The script is
checkpointed/resumable and intentionally throttled to avoid DBLP resets.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urljoin

YEAR = 2025
OUT = Path('/Users/doehyunbaek/llm-pilled/data.json')
CACHE = Path('/Users/doehyunbaek/llm-pilled/.cache')
CACHE.mkdir(parents=True, exist_ok=True)

PARENT_MAP = {
    'aaai': 'ai', 'ijcai': 'ai',
    'cvpr': 'vision', 'eccv': 'vision', 'iccv': 'vision',
    'icml': 'mlmining', 'iclr': 'mlmining', 'kdd': 'mlmining', 'nips': 'mlmining',
    'acl': 'nlp', 'emnlp': 'nlp', 'naacl': 'nlp',
    'sigir': 'inforet', 'www': 'inforet',
    'asplos': 'arch', 'isca': 'arch', 'micro': 'arch', 'hpca': 'arch',
    'ccs': 'sec', 'oakland': 'sec', 'usenixsec': 'sec', 'ndss': 'sec',
    'vldb': 'mod', 'sigmod': 'mod', 'icde': 'mod', 'pods': 'mod',
    'dac': 'da', 'iccad': 'da',
    'emsoft': 'bed', 'rtas': 'bed', 'rtss': 'bed',
    'sc': 'hpc', 'hpdc': 'hpc', 'ics': 'hpc',
    'mobicom': 'mobile', 'mobisys': 'mobile', 'sensys': 'mobile',
    'imc': 'metrics', 'sigmetrics': 'metrics',
    'osdi': 'ops', 'sosp': 'ops', 'eurosys': 'ops', 'fast': 'ops', 'usenixatc': 'ops',
    'popl': 'plan', 'pldi': 'plan', 'oopsla': 'plan', 'icfp': 'plan',
    'fse': 'soft', 'icse': 'soft', 'ase': 'soft', 'issta': 'soft',
    'nsdi': 'comm', 'sigcomm': 'comm',
    'siggraph': 'graph', 'siggraph-asia': 'graph', 'eurographics': 'graph',
    'focs': 'act', 'soda': 'act', 'stoc': 'act',
    'crypto': 'crypt', 'eurocrypt': 'crypt',
    'cav': 'log', 'lics': 'log',
    'ismb': 'bio', 'recomb': 'bio',
    'ec': 'ecom', 'wine': 'ecom',
    'chiconf': 'chi', 'ubicomp': 'chi', 'uist': 'chi',
    'icra': 'robotics', 'iros': 'robotics', 'rss': 'robotics',
    'vis': 'visualization', 'vr': 'visualization',
    'sigcse': 'csed'
}

# DBLP directory / page-prefix aliases.
VENUES: dict[str, list[tuple[str, str]]] = {
    'nips': [('nips', 'neurips'), ('nips', 'nips')],
    'oakland': [('sp', 'sp')],
    'usenixsec': [('uss', 'uss')],
    'usenixatc': [('usenix', 'atc')],
    'chiconf': [('chi', 'chi')],
    'siggraph-asia': [('siggrapha', 'siggrapha')],
    'ec': [('sigecom', 'ec'), ('ec', 'ec')],
    'ubicomp': [('huc', 'ubicomp'), ('ubicomp', 'ubicomp')],
    'vis': [('visualization', 'visualization'), ('vis', 'vis')],
}

# Venues whose CSRankings publication venue is a DBLP journal/proceedings volume.
SPECIAL_TOCS: dict[str, list[str]] = {
    # PVLDB vol. 18 corresponds to the 2025 VLDB cycle in DBLP.
    'vldb': ['db/journals/pvldb/pvldb18.bht'],
}

# DBLP stream/year queries for venues whose 2025 publications are represented
# through journal streams or non-standard proceedings rather than a simple TOC.
SPECIAL_QUERIES: dict[str, str] = {
    'sigmod': 'stream:conf/sigmod: year:2025:',
    'pods': 'stream:conf/pods: year:2025:',
    'popl': 'stream:conf/popl: year:2025:',
    'pldi': 'stream:conf/pldi: year:2025:',
    'oopsla': 'stream:conf/oopsla: year:2025:',
    'icfp': 'stream:conf/icfp: year:2025:',
    'eurographics': 'stream:conf/eurographics: year:2025:',
    'ismb': 'stream:conf/ismb: year:2025:',
    'ec': 'stream:conf/sigecom: year:2025:',
    # UbiComp main research papers are published in IMWUT.
    'ubicomp': 'stream:journals/imwut: year:2025:',
}

# Researchr tracks where DBLP has not exposed a 2025 TOC yet.
RESEARCHR_URLS: dict[str, str] = {
    'fse': 'https://conf.researchr.org/track/fse-2025/fse-2025-research-papers',
    'icse': 'https://conf.researchr.org/track/icse-2025/icse-2025-research-track',
    'ase': 'https://conf.researchr.org/track/ase-2025/ase-2025-papers',
    'issta': 'https://conf.researchr.org/track/issta-2025/issta-2025-papers',
}

# Official conference pages used when DBLP is missing/late.
OFFICIAL_URLS: dict[str, str] = {
    'nips': 'https://neurips.cc/virtual/2025/papers.html?filter=titles',
    'usenixatc': 'https://www.usenix.org/conference/atc25/technical-sessions',
    'rss': 'https://roboticsconference.org/2025/program/papers/',
    'vis': 'https://ieeevis.org/year/2025/info/program/papers_list',
    'wine': 'https://link.springer.com/book/10.1007/978-3-032-18660-7',
}

# DBLP pages with non-obvious names that are main conference proceedings.
SPECIAL_MAIN_STEMS: dict[str, set[str]] = {
    'sigmod': {'sigmod2025c'},
    'usenixatc': {'atc2025'},
}

# Known conferences with no 2025 main edition (biennial / not applicable). We still
# try DBLP first when --force is used, but this prevents expensive fallback probing.
KNOWN_NO_2025 = {'eccv'}

USER_AGENT = 'llm-pilled-title-survey/0.2 (polite; DBLP API)'


def curl(url: str, *, max_time: int = 120, retries: int = 5, cache_key: str | None = None, delay: float = 0.0) -> str:
    """Fetch a URL using curl with retries and optional on-disk cache."""
    if cache_key:
        path = CACHE / cache_key
        if path.exists() and path.stat().st_size > 0:
            return path.read_text(encoding='utf-8', errors='ignore')
    last = ''
    for attempt in range(retries):
        cmd = [
            'curl', '-L', '--silent', '--show-error', '--fail', '--compressed',
            '--connect-timeout', '20', '--max-time', str(max_time),
            '--retry', '2', '--retry-delay', '3', '--retry-all-errors',
            '-A', USER_AGENT, url,
        ]
        p = subprocess.run(cmd, text=True, capture_output=True)
        if p.returncode == 0 and p.stdout.strip():
            if cache_key:
                path.write_text(p.stdout, encoding='utf-8')
            if delay:
                time.sleep(delay)
            return p.stdout
        last = (p.stderr or p.stdout or '').strip()
        sleep_for = 10 + attempt * 15
        print(f'    fetch failed attempt {attempt + 1}/{retries}: {last[:160]} ; sleeping {sleep_for}s', file=sys.stderr, flush=True)
        time.sleep(sleep_for)
    raise RuntimeError(last or f'curl failed for {url}')


def cache_name(prefix: str, key: str) -> str:
    return prefix + '-' + hashlib.sha1(key.encode()).hexdigest() + '.txt'


def api_titles_for_query(q: str, request_delay: float) -> list[str]:
    """Return all DBLP titles for one publication API query."""
    titles: list[str] = []
    total = None
    for off in range(0, 20000, 1000):
        url = 'https://dblp.org/search/publ/api?' + urlencode({'q': q, 'format': 'json', 'h': '1000', 'f': str(off)})
        raw = curl(url, max_time=120, retries=6, cache_key=cache_name('api', url), delay=request_delay)
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(f'bad JSON for query {q!r} offset {off}: {e}: {raw[:200]}')
        hits_obj = obj.get('result', {}).get('hits', {})
        if total is None:
            try:
                total = int(hits_obj.get('@total', 0))
            except Exception:
                total = 0
        hits = hits_obj.get('hit', [])
        if isinstance(hits, dict):
            hits = [hits]
        if not hits:
            break
        for hit in hits:
            title = hit.get('info', {}).get('title')
            if not title or title == 'Home Page':
                continue
            title = html.unescape(re.sub(r'\s+', ' ', title)).strip()
            # DBLP title strings commonly carry a final period not considered part of title.
            if title.endswith('.'):
                title = title[:-1]
            if title not in titles:
                titles.append(title)
        if len(hits) < 1000 or (total is not None and off + len(hits) >= total):
            break
    return titles


def api_titles_for_toc(toc: str, request_delay: float) -> list[str]:
    """Return all DBLP titles for one table-of-contents facet."""
    return api_titles_for_query(f'toc:{toc}:', request_delay)


def researchr_titles(url: str, request_delay: float) -> list[str]:
    """Parse a Researchr accepted-papers event overview table."""
    raw = curl(url, max_time=180, retries=5, cache_key=cache_name('researchr', url), delay=request_delay)
    idx = raw.find('id="event-overview"')
    sub = raw[idx:] if idx >= 0 else raw
    table_start = sub.find('<table')
    if table_start >= 0:
        table_end = sub.find('</table>', table_start)
        if table_end >= 0:
            sub = sub[table_start:table_end]
    titles: list[str] = []
    for m in re.finditer(r'<a href="#" data-event-modal="[^"]+">(.*?)</a>', sub, re.S):
        content = re.split(r'<span class="pull-right"', m.group(1), maxsplit=1)[0]
        title = html.unescape(re.sub(r'<.*?>', ' ', content)).strip()
        title = re.sub(r'\s+', ' ', title)
        if title and title not in titles:
            titles.append(title)
    return titles


def official_titles(conf: str, url: str, request_delay: float) -> list[str]:
    """Parse conference-specific official accepted-paper pages."""
    raw = curl(url, max_time=180, retries=5, cache_key=cache_name('official', url), delay=request_delay)
    titles: list[str] = []
    if conf == 'nips':
        pattern = r'<li><a href="/virtual/2025/(?:poster|oral|spotlight)/\d+">(.*?)</a></li>'
        for m in re.finditer(pattern, raw, re.S):
            title = html.unescape(re.sub(r'<.*?>', ' ', m.group(1))).strip()
            title = re.sub(r'\s+', ' ', title)
            if title and title not in titles:
                titles.append(title)
    elif conf == 'usenixatc':
        for art in re.findall(r'(<article[^>]*class="[^"]*node-paper[^"]*".*?</article>)', raw, re.S):
            m = re.search(r'<h2>\s*<a[^>]*>(.*?)</a>\s*</h2>', art, re.S)
            if not m:
                continue
            title = html.unescape(re.sub(r'<.*?>', ' ', m.group(1))).strip()
            title = re.sub(r'\s+', ' ', title)
            # The technical-sessions page also exposes an invited keynote as node-paper.
            if not title or title == 'Accelerating Software Development: The LLM (R)evolution':
                continue
            if title not in titles:
                titles.append(title)
    elif conf == 'rss':
        for m in re.finditer(r'<td[^>]*>\s*<b>(.*?)</b>\s*</td>', raw, re.S):
            title = html.unescape(re.sub(r'<.*?>', ' ', m.group(1))).strip()
            title = re.sub(r'\s+', ' ', title)
            if title and title not in titles:
                titles.append(title)
    elif conf == 'vis':
        for m in re.finditer(r'<p><strong>(.*?)</strong><br\s*/?>\s*by\s', raw, re.S | re.I):
            title = html.unescape(re.sub(r'<.*?>', ' ', m.group(1))).strip()
            title = re.sub(r'\s+', ' ', title)
            if title and title not in titles:
                titles.append(title)
    elif conf == 'wine':
        for m in re.finditer(r'<a[^>]+href="/chapter/[^"]+"[^>]*>(.*?)</a>', raw, re.S):
            title = html.unescape(re.sub(r'<.*?>', ' ', m.group(1))).strip()
            title = re.sub(r'\s+', ' ', title)
            if title and title not in titles:
                titles.append(title)
    return titles


def main_link_for(conf: str, prefix: str, stem: str) -> bool:
    """Whether a DBLP 2025 page basename looks like main proceedings."""
    specials = SPECIAL_MAIN_STEMS.get(conf, set())
    if stem in specials:
        return True
    if stem == f'{prefix}2025':
        return True
    if re.fullmatch(re.escape(prefix) + r'2025-\d+', stem):
        return True
    return False


def html_to_toc(url: str) -> str | None:
    m = re.search(r'dblp\.org/(db/.*)\.html', url)
    if not m:
        return None
    return m.group(1) + '.bht'


def discover_tocs(conf: str, request_delay: float, force_known_no_2025: bool = False) -> tuple[list[str], list[str]]:
    if conf in SPECIAL_TOCS:
        return SPECIAL_TOCS[conf], []
    if conf in KNOWN_NO_2025 and not force_known_no_2025:
        return [], ['known_no_2025_main_edition']

    pairs = VENUES.get(conf, [(conf, conf)])
    tocs: list[str] = []
    errors: list[str] = []
    for directory, prefix in pairs:
        index_url = f'https://dblp.org/db/conf/{directory}/'
        try:
            index = curl(index_url, max_time=120, retries=4, cache_key=cache_name('index', index_url), delay=request_delay)
            for link in re.findall(r'href="([^"]*2025[^"#]*\.html)"', index):
                if '/rec/' in link:
                    continue
                full = urljoin(index_url, link)
                toc = html_to_toc(full)
                if not toc:
                    continue
                stem = Path(full).stem
                if main_link_for(conf, prefix, stem) and toc not in tocs:
                    tocs.append(toc)
        except Exception as e:
            errors.append(f'{index_url}: {type(e).__name__}: {e}')

    # If the index did not reveal anything, try just the most likely exact page(s).
    # This keeps non-existing venues cheap while still recovering from sparse indexes.
    if not tocs:
        for directory, prefix in pairs:
            fallback = f'db/conf/{directory}/{prefix}2025.bht'
            if fallback not in tocs:
                tocs.append(fallback)
    return tocs, errors


def load_existing() -> dict[str, dict]:
    if not OUT.exists():
        return {}
    try:
        obj = json.loads(OUT.read_text(encoding='utf-8'))
    except Exception:
        return {}
    return {c['conference']: c for c in obj.get('conferences', []) if 'conference' in c}


def write_checkpoint(results: dict[str, dict]) -> None:
    ordered = [results[k] for k in PARENT_MAP if k in results]
    total_titles = sum(x.get('total_titles', 0) for x in ordered)
    total_llm_titles = sum(x.get('titles_with_llm_count', 0) for x in ordered)
    total_llm_occurrences = sum(x.get('llm_occurrences_in_titles', 0) for x in ordered)
    summary = {
        'conference_count': len(ordered),
        'completed_count': sum(1 for x in ordered if x.get('status') in {'ok', 'no_2025_found'}),
        'ok_count': sum(1 for x in ordered if x.get('status') == 'ok'),
        'error_count': sum(1 for x in ordered if x.get('status') == 'error'),
        'total_titles': total_titles,
        'titles_with_llm_count': total_llm_titles,
        'llm_occurrences_in_titles': total_llm_occurrences,
        'llm_title_share': (total_llm_titles / total_titles if total_titles else None),
    }
    area_summary: dict[str, dict] = {}
    for item in ordered:
        area = item.get('area')
        if area not in area_summary:
            area_summary[area] = {'conference_count': 0, 'total_titles': 0, 'titles_with_llm_count': 0, 'llm_occurrences_in_titles': 0}
        a = area_summary[area]
        a['conference_count'] += 1
        a['total_titles'] += item.get('total_titles', 0)
        a['titles_with_llm_count'] += item.get('titles_with_llm_count', 0)
        a['llm_occurrences_in_titles'] += item.get('llm_occurrences_in_titles', 0)
    for a in area_summary.values():
        a['llm_title_share'] = (a['titles_with_llm_count'] / a['total_titles'] if a['total_titles'] else None)
    obj = {
        'year': YEAR,
        'metric': "case-insensitive substring match for 'LLM' in 2025 publication titles",
        'source_note': 'Primary source is DBLP publication API, queried by table-of-contents facet or stream/year facet. Official conference pages are used where DBLP is missing/late. Non-main workshops/companions/findings/adjunct pages are excluded when sources expose them separately.',
        'summary': summary,
        'area_summary': area_summary,
        'conferences': ordered,
    }
    OUT.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding='utf-8')


def collect_one(conf: str, area: str, request_delay: float, force: bool) -> dict:
    titles: list[str] = []
    sources: list[str] = []
    errors: list[str] = []
    discovery_errors: list[str] = []

    if conf in SPECIAL_QUERIES:
        q = SPECIAL_QUERIES[conf]
        try:
            titles = api_titles_for_query(q, request_delay)
            if titles:
                sources.append('https://dblp.org/search/publ/api?' + urlencode({'q': q, 'format': 'json'}))
        except Exception as e:
            errors.append(f'{q}: {type(e).__name__}: {e}')
    elif conf in RESEARCHR_URLS:
        url = RESEARCHR_URLS[conf]
        try:
            titles = researchr_titles(url, request_delay)
            if titles:
                sources.append(url)
        except Exception as e:
            errors.append(f'{url}: {type(e).__name__}: {e}')
    elif conf in OFFICIAL_URLS:
        url = OFFICIAL_URLS[conf]
        try:
            titles = official_titles(conf, url, request_delay)
            if titles:
                sources.append(url)
        except Exception as e:
            errors.append(f'{url}: {type(e).__name__}: {e}')
    else:
        tocs, discovery_errors = discover_tocs(conf, request_delay, force_known_no_2025=force)
        for toc in tocs:
            try:
                ts = api_titles_for_toc(toc, request_delay)
                if ts:
                    src = 'https://dblp.org/' + toc.replace('.bht', '.html')
                    sources.append(src)
                    for t in ts:
                        if t not in titles:
                            titles.append(t)
            except Exception as e:
                errors.append(f'{toc}: {type(e).__name__}: {e}')
    llm_titles = [t for t in titles if re.search(r'LLM', t, re.I)]
    status = 'ok' if titles else 'no_2025_found'
    if not titles and errors and not (conf in KNOWN_NO_2025):
        status = 'error'
    item = {
        'conference': conf,
        'area': area,
        'year': YEAR,
        'status': status,
        'sources': sources,
        'total_titles': len(titles),
        'titles_with_llm_count': len(llm_titles),
        'llm_occurrences_in_titles': sum(len(re.findall(r'LLM', t, re.I)) for t in titles),
        'llm_title_share': (len(llm_titles) / len(titles) if titles else None),
        'titles_with_llm': llm_titles,
    }
    if discovery_errors:
        item['discovery_errors'] = discovery_errors
    if errors:
        item['errors'] = errors
    if not titles and conf in KNOWN_NO_2025:
        item['note'] = 'No 2025 main edition expected/found (biennial or otherwise not held).'
    return item


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='re-fetch even conferences with nonzero existing totals')
    ap.add_argument('--only', nargs='*', help='only collect these conference keys')
    ap.add_argument('--delay', type=float, default=2.0, help='sleep after each successful network request')
    args = ap.parse_args()

    results = load_existing()
    todo = list(PARENT_MAP.items())
    if args.only:
        wanted = set(args.only)
        todo = [(k, v) for k, v in todo if k in wanted]

    for conf, area in todo:
        old = results.get(conf)
        if old and old.get('total_titles', 0) > 0 and not args.force:
            # Normalize older records to have a status.
            old.setdefault('status', 'ok')
            results[conf] = old
            print(f'{conf:14s} skip {old.get("total_titles", 0):5d} {old.get("titles_with_llm_count", 0):4d}', flush=True)
            write_checkpoint(results)
            continue
        if old and old.get('status') == 'no_2025_found' and not args.force:
            print(f'{conf:14s} skip no_2025_found', flush=True)
            continue

        print(f'{conf:14s} collecting...', flush=True)
        item = collect_one(conf, area, args.delay, args.force)
        results[conf] = item
        print(f'{conf:14s} {item["status"]:13s} {item["total_titles"]:5d} {item["titles_with_llm_count"]:4d} {len(item["sources"]):2d} sources', flush=True)
        write_checkpoint(results)

    write_checkpoint(results)


if __name__ == '__main__':
    main()
