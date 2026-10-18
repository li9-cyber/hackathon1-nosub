"""Opt-in realistic three-page synthetic CV benchmark (one real provider call)."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from unittest.mock import patch
import pymupdf
from fastapi.testclient import TestClient
from career_twin.api.main import app
from career_twin.profile import provider
from tests.profile.fixtures import NAMES

PAGES = [
'''Alex Example
alex@example.invalid | Hong Kong
EDUCATION
Example University | Bachelor of Business Administration in Finance | 2022-2026
Relevant courses: Financial Accounting, Corporate Finance, Statistics, Business Analytics.
Completed a dissertation comparing working-capital practices across listed retail companies.

EXPERIENCE
Example Bank | Finance Intern | June-August 2025
Used Python and pandas to clean 12 monthly transaction files and compare account balances.
Wrote SQL queries to join customer and transaction tables for the monthly operations report.
Used Microsoft Excel pivot tables and XLOOKUP to investigate differences between source files.
Recorded unresolved reconciliation differences in a shared issue log for review by the accountant.
Prepared Power BI charts showing payment volumes and average processing times by business unit.
Presented the findings in Microsoft PowerPoint at a weekly meeting with the finance operations team.
Documented the data-cleaning steps and retained source filenames so another intern could repeat them.
Worked with two interns to check the report figures against the original transaction extracts.
Assisted with invoice processing by checking purchase-order numbers and payment due dates.
Prepared a written handover covering outstanding items, query locations and the monthly timetable.

Example Advisory | Research Assistant | January-May 2025
Collected financial statements and annual reports for a sample of 20 listed retail companies.
Calculated revenue growth, profit margins and leverage ratios using Microsoft Excel.
Used Bloomberg Terminal to retrieve published market prices and sector classification information.
Compared figures from the data export with company filings and recorded differences for review.
Drafted a research summary explaining the sample selection, data limitations and calculation methods.
Created Tableau charts comparing the financial ratios across the selected companies and periods.
Discussed initial findings with the research supervisor and revised charts in response to feedback.
Maintained a source register containing publication dates, report titles and relevant page references.
''',
'''PROJECTS
Cash-flow Reporting Project | University Group Project | September-December 2024
Built a financial model in Microsoft Excel to compare base, downside and upside cash-flow scenarios.
Used Python and pandas to import historical financial statements from instructor-provided CSV files.
Wrote SQL queries to aggregate sales by month and category before loading the reporting workbook.
Created a Power BI dashboard showing cash balances, overdue receivables and changes in inventory.
Performed sensitivity analysis on collection periods and documented the assumptions in the workbook.
Used Git to track changes to the Python scripts and reviewed a teammate's proposed data-cleaning change.
Prepared Microsoft PowerPoint slides and presented the methodology to a class of 30 students.
Wrote the section of the final report describing data quality checks, limitations and next steps.
The project used fictional company data supplied by the course and did not involve investment advice.

Student Analytics Project | Independent Coursework | February-April 2024
Used R to calculate descriptive statistics and examine missing values in an anonymized survey dataset.
Used Python to compare the survey exports and remove duplicate submissions using a documented rule.
Created charts in Tableau to communicate differences in survey responses across study programmes.
Used SQL to check row counts after joining programme details to the survey response table.
Packaged the reporting script in Docker so classmates could run the same version of the software.
Used Git branches to test a revised chart layout without replacing the submitted project version.
Wrote a short report explaining that the sample did not represent all students at the university.

Campus Finance Society | Events Volunteer | September 2023-April 2024
Coordinated room bookings and maintained a Microsoft Excel registration list for three campus events.
Responded to attendee questions by email and prepared written instructions for student volunteers.
Used Microsoft PowerPoint to prepare event slides and checked speaker names against the booking list.
Worked with the committee to update the event timetable after one speaker changed their arrival time.
Counted remaining printed materials after each event and recorded the figures for future planning.
Prepared a handover note explaining registration procedures and the location of shared event files.
''',
'''ADDITIONAL EXPERIENCE
Example Retail | Part-time Store Assistant | June-August 2023
Processed customer payments and checked the cash register total against the end-of-day sales report.
Answered customer enquiries and referred refund requests to the shift supervisor for approval.
Used Microsoft Excel to record inventory counts and highlight differences from the stock list.
Worked with colleagues to prepare stock for collection and update the daily task checklist.
Recorded payment discrepancies in the store log and passed the supporting receipts to the supervisor.

QUALIFICATIONS
AWS Cloud Practitioner | Passed June 2026
Completed the assessment covering cloud concepts, security responsibilities, billing and support.
CFA Level I | Passed August 2025
Passed Level I only; no claim of holding the CFA charter or having passed further levels.
Microsoft Office Specialist: Excel Associate | Awarded May 2024
Awarded after completing the spreadsheet assessment administered by the named examination provider.

SKILLS
''' + ', '.join(NAMES) + '''
Financial Analysis, Financial Modelling, Account Reconciliation, Invoice Processing, Research.
Data Analysis, Data Visualization, Statistical Analysis, Report Writing, Presentation, Teamwork.

LANGUAGES
Cantonese: native. English: IELTS overall 7.0, examination taken in October 2024.
Mandarin: used in conversations with customers during part-time retail work.

SELECTED COURSE ACTIVITIES
Reviewed an example annual report and identified how accounting notes explained changes in inventory.
Prepared a literature review comparing three published approaches to financial statement analysis.
Worked in a group of four to present the strengths and limitations of a fictional business proposal.
Maintained a personal study schedule and recorded assignment deadlines in a Microsoft Excel workbook.
''']


def main():
    root = Path('test-results')
    root.mkdir(exist_ok=True)
    with pymupdf.open() as pdf:
        for text in PAGES:
            page = pdf.new_page()
            assert page.insert_textbox(pymupdf.Rect(35, 35, 560, 810), text, fontsize=10) >= 0
        content = pdf.tobytes()
    raw = []
    real = provider.extract
    async def capture(text):
        result = await real(text)
        raw.append(result.model_dump())
        return result
    with TemporaryDirectory(dir='.test-runs', prefix='representative-') as folder:
        os.environ['CAREER_PROJECT_DATA_DIR'] = str(Path(folder) / 'data')
        os.environ['CAREER_LOGIN_ENABLED'] = '0'
        os.environ.pop('K_SERVICE', None)
        os.environ.pop('CAREER_PROJECT_STORAGE', None)
        with patch.object(provider, 'extract', capture), TestClient(app, base_url='http://localhost', client=('127.0.0.1', 45678), headers={'origin': 'http://localhost'}) as client:
            client.get('/api/projects/session')
            project = client.post('/api/projects', json={'name': 'Synthetic representative CV'}).json()
            client.headers['X-Career-Project'] = project['id']
            started = perf_counter()
            document = client.post('/api/career/parse', params={'filename': 'representative.pdf'}, content=content).json()
            state = client.post('/api/career/start', json={'document': document}).json()
            result = client.post('/api/career/extract', json={'state': state, 'expected_revision': state['revision']}).json()
            elapsed = round(perf_counter() - started, 3)
            report = dict(pages=3, characters=len(document['text']), words=len(document['text'].split()),
                calls=len(raw), end_to_end_seconds=elapsed, extraction=result['cv_extraction'],
                items=len(result['items']), skill_evidence=len(result['skill_evidence']),
                unique_skills=len({s['skill_id'] for s in result['skill_evidence']}),
                restore_equal=client.get('/api/projects/' + project['id']).json()['state'] == result)
            (root / 'representative-cv.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
            # Synthetic evidence only, retained for reproducible source-mapping diagnosis.
            (root / 'representative-provider.json').write_text(json.dumps({'text': document['text'], 'output': raw}, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
