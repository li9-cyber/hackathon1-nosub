"""Read saved pre-single-pass JD predicates without rewriting their source data."""


def requirements(job):
    text = job.get('jd') or ''
    for index, raw in enumerate(job.get('requirements') or []):
        if not isinstance(raw, dict):
            continue
        if raw.get('name'):
            yield raw
            continue
        if raw.get('statement_type', 'requirement') != 'requirement':
            continue
        groups = []
        for group in raw.get('alternatives') or []:
            predicates = []
            for predicate in group:
                name = predicate.get('name') or predicate.get('raw_name')
                if name:
                    predicates.append(dict(name=name, names=[name], kind=predicate.get('kind', 'skill'),
                                           level=predicate.get('minimum_level') or 'unspecified'))
            if predicates:
                groups.append(predicates)
        name = raw.get('description') or raw.get('quote')
        if not name and not groups:
            continue
        names = list(dict.fromkeys(p['name'] for group in groups for p in group))
        name = name or ' / '.join(names)
        quote = raw.get('quote') or ''
        start = text.find(quote) if quote.strip() else -1
        spans = [dict(start=start, end=start + len(quote), quote=quote)] if start >= 0 else []
        kinds = {p['kind'] for group in groups for p in group}
        label=' 或 '.join(' + '.join(p['name'] for p in group) for group in groups) or name
        yield dict(id=raw.get('id') or f'legacy_requirement_{index}', name=name, label=label, names=names or [name],
                   kind='skill' if kinds and kinds <= {'skill', 'tool'} else next(iter(kinds)) if len(kinds) == 1 else 'experience',
                   type=raw.get('requirement_type') if raw.get('requirement_type') in ('Required', 'Preferred') else 'Required' if raw.get('required', True) else 'Preferred',
                   level='unspecified', description=name, quote=quote, source_spans=spans,
                   citation_status='exact' if spans else 'unverified', alternative_groups=groups)
