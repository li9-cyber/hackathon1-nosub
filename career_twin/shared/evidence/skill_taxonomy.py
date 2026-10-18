"""Small product vocabulary informed by ESCO; local IDs are NOT ESCO identifiers.

Definitions and categories below are authored for this product, not a copy of the
ESCO hierarchy. Preserved from the original project's shared CV/JD vocabulary;
canonical labels, aliases and IDs are unchanged.
"""
from dataclasses import dataclass
import re
import unicodedata

VERSION='cv-skills-3-activities'
@dataclass(frozen=True)
class Skill:
    id: str
    canonical_name: str
    match_name: str
    category: str
    family: str
    aliases: tuple[str,...]
    definition: str
    behavior: str = ''
    taxonomy_source: str = 'local_product_vocabulary_esco_reference'
    esco_uri: str | None = None
    concept_type: str = 'skill'
    parent_ids: tuple[str,...] = ()
    operations: tuple[str,...] = ()

# Canonical labels are product labels; no unverified ESCO URI is assigned.
ROWS=[
 ('excel','Microsoft Excel','excel','technical_tools',['Excel','MS Excel','Microsoft Excel'], 'Use Excel worksheets and functions.', ''),
 ('sql','SQL','sql','technical_tools',['SQL','Structured Query Language'],'Query relational data with SQL.',''),
 ('python','Python','python','technical_tools',['Python','Python programming'],'Use Python code.',''),
 ('power_bi','Power BI','power bi','technical_tools',['Power BI','PowerBI','Microsoft Power BI'],'Build reports with Power BI.',''),
 ('powerpoint','Microsoft PowerPoint','powerpoint','technical_tools',['PowerPoint','Microsoft PowerPoint','MS PowerPoint'],'Create presentation slides.',''),
 ('tableau','Tableau','tableau','technical_tools',['Tableau'],'Use Tableau for visual analytics.',''),
 ('r','R','r','technical_tools',['R programming','R'],'Use the R language.',''),
 ('java','Java','java','technical_tools',['Java'],'Use Java code.',''),
 ('rust','Rust','rust','technical_tools',['Rust'],'Use Rust code.',''),
 ('pandas','pandas','pandas','technical_tools',['pandas','Python pandas library','Pandas library'],'Use pandas data operations.',''),
 ('data_analysis','Data Analysis','data analysis','data_analytics',['data analysis','data analytics','數據分析','資料分析'],'Examine data to answer a question.',r'\b(?:analysed|analyzed|compared)\b.{0,90}\b(?:data|ratios|revenue|profit|results)\b|分析.{0,30}(?:數據|資料)'),
 ('data_collection','Data Collection','data collection','research',['data collection','資料蒐集','數據收集'],'Collect observations or research data.',r'\b(?:collected|gathered)\b.{0,80}\b(?:data|survey|responses|observations)\b|收集.{0,25}(?:資料|數據|問卷)'),
 ('data_organization','Data Organization','data organization','data_analytics',['data organization','data organisation','資料整理'],'Arrange or maintain data for use.',r'\b(?:organi[sz]ed|organi[sz]e|updated|maintained)\b.{0,80}\b(?:data|tracker|records|spreadsheet)\b|整理.{0,20}(?:資料|數據)'),
 ('data_visualization','Data Visualization','data visualization','data_analytics',['data visualization','data visualisation','數據視覺化'],'Communicate data with charts.',r'\b(?:prepared|created|built|produced)\b.{0,60}\b(?:charts|visuali[sz]ations|dashboards)\b|製作.{0,20}(?:圖表|儀表板)'),
 ('statistics','Statistical Analysis','statistical analysis','data_analytics',['statistical analysis','statistics','統計分析'],'Apply statistical methods to data.',''),
 ('financial_analysis','Financial Analysis','financial analysis','finance_accounting',['financial analysis','財務分析'],'Examine financial statements or ratios.',r'\b(?:compared|analysed|analyzed|calculated)\b.{0,100}\b(?:profit margins|leverage ratios|financial statements|financial ratios)\b'),
 ('financial_modelling','Financial Modelling','financial modelling','finance_accounting',['financial modelling','financial modeling','財務模型'],'Construct financial models from stated assumptions.',''),
 ('accounting','Accounting','accounting','finance_accounting',['accounting','會計'],'Apply accounting knowledge or processes.',''),
 ('reconciliation','Account Reconciliation','account reconciliation','finance_accounting',['account reconciliation','reconciliation','對帳'],'Compare records and reconcile totals.',r'\b(?:reconciled|reconcile)\b.{0,70}\b(?:totals|accounts|records|payments)\b|核對.{0,20}(?:帳目|金額)'),
 ('invoice_processing','Invoice Processing','invoice processing','finance_accounting',['invoice processing','發票處理'],'Enter or check invoice records.',r'\b(?:entered|checked|processed)\b.{0,60}\b(?:invoices|supplier invoices)\b'),
 ('risk_analysis','Risk Analysis','risk analysis','finance_accounting',['risk analysis','risk assessment','風險分析'],'Assess or analyse stated risks.',''),
 ('research','Research','research','research',['research','研究'],'Investigate a defined question using sources or observations.',''),
 ('literature_review','Literature Review','literature review','research',['literature review','文獻回顧'],'Review published literature.',''),
 ('communication','Communication','communication','communication',['communication','communication skills','溝通','溝通技巧'],'Exchange information with an identified audience.',r'\b(?:presented|explained|communicated|answered|discussed)\b.{0,90}\b(?:findings|results|classmates|enquiries|inquiries|customers|team)\b|向.{0,20}(?:同學|團隊).{0,20}(?:匯報|報告)|回答.{0,20}查詢'),
 ('presentation','Presentation','presentation','communication',['presentation','presentation skills','public speaking','簡報','演示'],'Present information to an audience.',r'\bpresented\b.{0,100}\b(?:findings|results|classmates|audience|group)\b|(?:匯報|簡報|演示).{0,25}(?:成果|結果)'),
 ('writing','Written Communication','written communication','communication',['written communication','report writing','書面溝通'],'Prepare written material for a purpose.',r'\b(?:wrote|drafted|authored)\b.{0,80}\b(?:report|section|summary|findings)\b'),
 ('customer_service','Customer Service','customer service','communication',['customer service','客戶服務'],'Respond to customer needs or enquiries.',r'\b(?:answered|handled|responded)\b.{0,70}\b(?:customer|enquiries|inquiries|complaints)\b'),
 ('teamwork','Teamwork','teamwork','teamwork_collaboration',['teamwork','team work','teamwork skills','team collaboration','collaboration','團隊合作'],'Work with others on a shared task.',r'\b(?:worked|collaborated|cooperated)\s+(?:closely\s+)?with\b.{0,65}\b(?:team|classmates|teammates|colleagues|members)\b|與.{0,25}(?:同學|同事|團隊).{0,15}(?:合作|協作)'),
 ('coordination','Coordination','coordination','organization_coordination',['coordination','協調'],'Coordinate information or arrangements among participants.',r'\bcoordinated\b.{0,100}\b(?:event|schedule|reminders|committee|updates)\b|協調.{0,30}(?:活動|時間|安排)'),
 ('organization','Organization','organization','organization_coordination',['organizational skills','organisational skills','organization','organisation','組織能力'],'Organize concrete work or event arrangements.',r'\b(?:organi[sz]ed|helped organi[sz]e)\b.{0,70}\b(?:events|sessions|registration|files|meetings)\b'),
 ('problem_solving','Problem Solving','problem solving','problem_solving',['problem solving','problem-solving','解難'],'Investigate and resolve a concrete issue.',r'\b(?:resolved|diagnosed|troubleshot|solved)\b.{0,80}\b(?:issue|problem|discrepanc|error|failure)\w*'),
 ('critical_thinking','Critical Thinking','critical thinking','other_transferable',['critical thinking','批判思考'],'Evaluate evidence and alternatives.',''),
 ('leadership','Leadership','leadership','other_transferable',['leadership','team leadership','領導能力'],'Direct or lead other people; participation is insufficient.',r'\b(?:led|supervised|managed)\b.{0,50}\b(?:team|staff|people|members)\b'),
 ('project_management','Project Management','project management','organization_coordination',['project management','項目管理'],'Manage project scope and delivery; group membership is insufficient.',''),
 ('document_verification','Document Verification','document verification','finance_accounting',['document verification','document checking'],'Check documents or amounts against supporting records.',r'\b(?:checked|verified|compared)\b.{0,65}\b(?:amounts|documents|invoices)\b.{0,35}\bagainst\b.{0,80}\b(?:delivery notes|payment records|supporting documents)\b'),
 ('receivables_tracking','Accounts Receivable Tracking','accounts receivable tracking','finance_accounting',['accounts receivable tracking','receivables tracking'],'Maintain a receivables tracker; no claim of full accounting responsibility.',r'\b(?:updated|maintained)\b.{0,65}\breceivables?\s+(?:tracker|records|spreadsheet)\b'),
 ('discrepancy_identification','Discrepancy Identification','discrepancy identification','finance_accounting',['discrepancy identification'],'Identify or flag missing or unmatched records.',r'\b(?:highlighted|flagged|identified)\b.{0,55}\b(?:missing|unmatched|discrepanc\w*)\b.{0,40}\b(?:documents|records|amounts)\b'),
 ('month_end_support','Month-End Support','month-end support','finance_accounting',['month-end support','month end support'],'Assist in preparing supporting files for month-end checks.',r'\b(?:helped\s+prepare|assisted\s+with|prepared)\b.{0,60}\b(?:supporting files|documents)\b.{0,60}\bmonth[- ]end\s+checks\b'),
 ('payment_handling','Payment Handling','payment handling','finance_accounting',['payment handling'],'Handle customer payments.',r'\b(?:handled|processed|accepted)\s+(?:customer\s+)?payments\b'),
 ('cash_reconciliation','Cash Reconciliation','cash reconciliation','finance_accounting',['cash reconciliation','till reconciliation'],'Reconcile till or cash totals, including assisted participation.',r'\b(?:reconcile|reconciled|checked)\b.{0,30}\b(?:till|cash)\s+(?:totals|balances)\b'),
 ('inventory_counting','Inventory Counting','inventory counting','organization_coordination',['inventory counting','stocktaking','stock counting'],'Perform or assist stock counts.',r'\b(?:assisted with|helped with|performed|conducted|completed)\b.{0,45}\b(?:stock counts|inventory counts|stocktaking)\b'),
 ('event_coordination','Event Coordination','event coordination','organization_coordination',['event coordination'],'Coordinate event arrangements or help organize sessions.',r'\bcoordinated\s+event\b|\bhelped\s+organi[sz]e\b.{0,70}\b(?:sessions|events)\b'),
 ('registration_administration','Registration Administration','registration administration','organization_coordination',['registration administration'],'Help prepare or organize registration lists.',r'\b(?:helped\s+organi[sz]e|prepared|updated|managed)\b.{0,100}\bregistration lists\b'),
 ('scheduling','Scheduling','scheduling','organization_coordination',['scheduling','schedule coordination'],'Coordinate or update an actual schedule.',r'\b(?:coordinated|updated|arranged)\b.{0,90}\bschedule(?:\s+updates)?\b'),
 ('financial_ratio_analysis','Financial Ratio Analysis','financial ratio analysis','finance_accounting',['financial ratio analysis','ratio analysis'],'Compare financial ratios in a stated report or project.',r'\b(?:compared|analysed|analyzed|calculated)\b.{0,100}\b(?:profit margins|leverage ratios|financial ratios)\b'),
 ('financial_statement_analysis','Financial Statement Analysis','financial statement analysis','finance_accounting',['financial statement analysis'],'Compare revenue or ratios using published financial reports.',r'\b(?:compared|analysed|analyzed)\b.{0,100}\b(?:revenue|profit margins|leverage ratios)\b.{0,120}\b(?:published.{0,30}reports|financial statements)\b'),
 ('financial_report_writing','Financial Report Writing','financial report writing','finance_accounting',['financial report writing'],'Write a financial report or its profitability section; no claim of authoring the entire report.',r'\b(?:wrote|drafted|authored)\b.{0,40}\b(?:profitability section|financial report)\b'),
]
# Broaden only the supported action, never a person's seniority or proficiency.
ROWS = [(*row[:-1], row[-1] + (r'|\bcoordinated\b.{0,115}\bwith (?:other )?(?:committee|team) members\b' if row[0] in {'teamwork','communication'} else '')) for row in ROWS]
SKILLS=tuple(Skill('sk_'+key,label,name,category,'transferable' if category in {'communication','teamwork_collaboration','organization_coordination','problem_solving','other_transferable'} else 'technical',tuple(aliases),definition,behavior) for key,label,name,category,aliases,definition,behavior in ROWS)
# An extensible concept hierarchy, not extra sentence regexes. Existing IDs are
# preserved; parent links support broad JD retrieval without duplicate UI tags.
from dataclasses import replace
PARENTS = {
 'financial_ratio_analysis': ('financial_analysis', 'data_analysis'),
 'financial_statement_analysis': ('financial_analysis',),
 'financial_report_writing': ('writing',), 'writing': ('communication',),
 'presentation': ('communication',), 'customer_service': ('communication',),
 'event_coordination': ('coordination', 'organization'), 'scheduling': ('coordination',),
 'registration_administration': ('organization',), 'cash_reconciliation': ('reconciliation',),
 'receivables_tracking': ('data_organization',),
}
# Operation compatibility checks structured semantic judgements. It is not a
# raw-CV keyword requirement and does not turn a compatible operation into proof.
OPERATIONS = {
 'data_analysis': ('analyze',), 'statistics': ('analyze',),
 'data_collection': ('research','record'), 'data_organization': ('record','track','prepare'),
 'data_visualization': ('visualize',), 'financial_analysis': ('analyze',),
 'financial_modelling': ('build',), 'accounting': (), 'reconciliation': ('verify',),
 'invoice_processing': ('record','verify','handle'), 'risk_analysis': ('analyze','identify'),
 'research': ('research','analyze'), 'literature_review': ('research',),
 'communication': ('respond','present','write','coordinate','collaborate'),
 'presentation': ('present',), 'writing': ('write',), 'customer_service': ('respond','handle'),
 'teamwork': ('collaborate','coordinate'), 'coordination': ('coordinate',),
 'organization': ('coordinate','prepare'), 'problem_solving': ('identify','test','verify'),
 'critical_thinking': ('analyze','research'), 'leadership': ('coordinate',),
 'project_management': ('coordinate',), 'document_verification': ('verify',),
 'receivables_tracking': ('track','record'), 'discrepancy_identification': ('identify','verify'),
 'month_end_support': ('prepare',), 'payment_handling': ('handle',),
 'cash_reconciliation': ('verify',), 'inventory_counting': ('count',),
 'event_coordination': ('coordinate','prepare'), 'registration_administration': ('record','prepare','coordinate'),
 'scheduling': ('coordinate','track'), 'financial_ratio_analysis': ('analyze',),
 'financial_statement_analysis': ('analyze',), 'financial_report_writing': ('write',),
}
TASKS={'invoice_processing','receivables_tracking','month_end_support','payment_handling',
       'inventory_counting','registration_administration'}
KNOWLEDGE={'accounting','statistics'}
SKILLS=tuple(replace(s, concept_type='tool' if s.category=='technical_tools' else 'task' if s.id[3:] in TASKS else 'knowledge' if s.id[3:] in KNOWLEDGE else 'skill',
    parent_ids=tuple('sk_'+p for p in PARENTS.get(s.id[3:],())), operations=OPERATIONS.get(s.id[3:],()),
    category='operations_inventory' if s.id=='sk_inventory_counting' else s.category,
    family='technical' if s.id=='sk_inventory_counting' else s.family,
    taxonomy_source='local_product_vocabulary') for s in SKILLS)
BY_ID={skill.id:skill for skill in SKILLS}
from career_twin.shared.evidence.concepts import normalized
BY_NAME={normalized(alias):skill for skill in SKILLS for alias in (skill.canonical_name,skill.match_name,*skill.aliases)}
def lookup(value):
    return BY_ID.get(value) or BY_NAME.get(normalized(value)) if value else None

def candidate_identity(skill_id, name=None):
    """Return an internal identity without trusting model-created ESCO IDs.

    Unknown names stay pending; they never extend the global approved vocabulary.
    The same normalized name has the same ID across experiences and processes.
    """
    from career_twin.shared.core.identifiers import stable_id
    by_id, by_name = lookup(skill_id), lookup(name)
    if by_id and by_name and by_id.id != by_name.id:
        return None, None, 'identity_conflict'
    skill = by_id or by_name
    if skill:
        return skill, skill.id, 'matched'
    if name:
        from career_twin.shared.evidence.concepts import normalize_concept
        return None, normalize_concept(name).concept_id, 'pending_standardization'
    return None, None, 'unknown_skill_id'
def mentions(text, skill):
    return any(re.search((r'(?<!\w)'+re.escape(a)+r'(?!\w)') if a.isascii() else re.escape(a),text,re.I) for a in skill.aliases)
def prompt_vocabulary():
    return [dict(skill_id=s.id,canonical_name=s.canonical_name,category=s.category,family=s.family,aliases=s.aliases,definition=s.definition,
        concept_type=s.concept_type,parent_ids=s.parent_ids,operations=s.operations) for s in SKILLS]

def ancestors(skill_id):
    found=set();queue=list(BY_ID[skill_id].parent_ids) if skill_id in BY_ID else []
    while queue:
        identity=queue.pop()
        if identity in found:continue
        found.add(identity)
        if identity in BY_ID:queue.extend(BY_ID[identity].parent_ids)
    return found
