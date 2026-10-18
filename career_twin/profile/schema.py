"""Strict single-response model; quotations are validated again against saved text."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Output(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Skill(Output):
    name: str = Field(min_length=1, max_length=160)
    quotes: list[str] = Field(min_length=1, max_length=30)


class Entry(Output):
    section: Literal['personal', 'experience', 'project', 'education', 'credential', 'skill', 'language']
    title: str = Field(min_length=1, max_length=300)
    source_quote: str = Field(min_length=1, max_length=20000)
    occurrence: int = Field(default=0, ge=0)
    organization: str = ''
    role: str = ''
    date_range: str = ''
    experience_type: Literal['internship', 'academic_project', 'part_time', 'full_time', 'volunteer', 'campus_activity', 'unknown'] = 'unknown'
    fields: dict[str, str] = Field(default_factory=dict)
    activities: list[str] = Field(default_factory=list, max_length=100)
    skills: list[Skill] = Field(default_factory=list, max_length=150)


class Extraction(Output):
    entries: list[Entry] = Field(min_length=1, max_length=100)
