"""Adjustable product policy; original FCDT formula/market weights are preserved."""
HIGH = 80
MEDIUM = 40
VERSION = 'evidence-coverage-1'
RELATED = {'power bi': {'tableau'}, 'tableau': {'power bi'}, 'python': {'r'}, 'r': {'python'}}

def band(score):
    return 'high' if score >= HIGH else 'medium' if score >= MEDIUM else 'low'
