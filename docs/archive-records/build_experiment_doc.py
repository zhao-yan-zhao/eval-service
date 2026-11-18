from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = Path(r"D:\soft\F1-AI\实验设计文档库\实验设计-地狱景象无人系统编队打击-v1-20260914.docx")
OUT.parent.mkdir(parents=True, exist_ok=True)

doc = Document()
section = doc.sections[0]
section.top_margin = Cm(2.2)
section.bottom_margin = Cm(2.0)
section.left_margin = Cm(2.25)
section.right_margin = Cm(2.25)

styles = doc.styles
for name in ["Normal", "Title", "Heading 1", "Heading 2"]:
    style = styles[name]
    style.font.name = "Microsoft YaHei"
    style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    style.font.color.rgb = RGBColor(0, 0, 0)
styles["Normal"].font.size = Pt(10.5)
styles["Normal"].paragraph_format.space_after = Pt(5)
styles["Normal"].paragraph_format.line_spacing = 1.25
styles["Title"].font.size = Pt(20)
styles["Title"].font.bold = True
styles["Title"].paragraph_format.space_after = Pt(10)
styles["Heading 1"].font.size = Pt(14)
styles["Heading 1"].font.bold = True
styles["Heading 1"].paragraph_format.space_before = Pt(12)
styles["Heading 1"].paragraph_format.space_after = Pt(6)
styles["Heading 2"].font.size = Pt(11.5)
styles["Heading 2"].font.bold = True

def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)

def set_cell_text(cell, text, bold=False, color=None, size=9):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.1
    run = p.add_run(str(text))
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER

def set_cell_margins(cell, top=90, start=90, bottom=90, end=90):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in("w:tcMar")
    if tcMar is None:
        tcMar = OxmlElement("w:tcMar")
        tcPr.append(tcMar)
    for m, v in [("top", top), ("start", start), ("bottom", bottom), ("end", end)]:
        node = tcMar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tcMar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)

def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.style = "Table Grid"
    t.autofit = False
    hdr = t.rows[0]
    set_repeat_table_header(hdr)
    for i, h in enumerate(headers):
        if widths:
            hdr.cells[i].width = Cm(widths[i])
        shade(hdr.cells[i], "1F4E78")
        set_cell_margins(hdr.cells[i])
        set_cell_text(hdr.cells[i], h, bold=True, color=(255,255,255), size=8.5)
        hdr.cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
    for r_idx, row in enumerate(rows):
        cells = t.add_row().cells
        for i, value in enumerate(row):
            if widths:
                cells[i].width = Cm(widths[i])
            if r_idx % 2 == 1:
                shade(cells[i], "F2F6FA")
            set_cell_margins(cells[i])
            set_cell_text(cells[i], value, size=8.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t

def add_p(text, bold_lead=None):
    p = doc.add_paragraph(style="Normal")
    if bold_lead and text.startswith(bold_lead):
        r = p.add_run(bold_lead)
        r.bold = True
        r.font.name = "Microsoft YaHei"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        p.add_run(text[len(bold_lead):])
    else:
        p.add_run(text)
    return p

def h1(text):
    return doc.add_paragraph(text, style="Heading 1")

def h2(text):
    return doc.add_paragraph(text, style="Heading 2")

title = doc.add_paragraph("地狱景象无人系统编队打击实验设计", style="Title")
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub = doc.add_paragraph("面向靶舰识别与稀疏自适应兵力扫描的研究方案")
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub.runs[0].font.name = "Microsoft YaHei"
sub.runs[0]._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
sub.runs[0].font.size = Pt(11)

add_p("本实验以“地狱景象”构想为原型，比较三种空海无人系统攻击方案在诱饵混杂编队中的靶舰识别、编队防御压制与毁伤效果。主实验先以 48 架无人机和 4 艘无人艇、96 架无人机和 8 艘无人艇进行稀疏扫描；仅在结果不能确定有效兵力区间时追加一组验证，以控制推演规模。")

h1("档案头")
table(["项目", "内容"], [
    ["文档编号与版本", "实验设计-地狱景象无人系统编队打击-v1-20260914"],
    ["用户构想原文", "以美“地域景观”构想为原型构设，研究蓝方多少架次打击型无人机、多少艘高速无人艇，能够摧毁红方由6艘驱逐舰、3艘靶舰、3艘诱饵舰组成的编队，并探究其中的战术战法、配合关系、时空间关系，其中红蓝双方均使用美国的平台、装备武器，作战时长不要超过2小时，省略转场时间。"],
    ["确认要点", "原型采用“地狱景象”；靶舰击沉或重创为成功；三种攻击方案并列研究；红方预设机动与分层防御；不纳入电磁与通信干扰；作战上限120分钟，不计转场；空中平台采用见证者-136，系用户明确豁免美国装备约束；水面平台采用魔鬼鱼T-38；两类平台均按携带单向攻击战斗部设定。"],
    ["生成方式", "Codex，2026年9月14日"],
    ["版本沿革", "初版"],
], [3.2, 12.8])

h1("1 实验目的")
add_p("验证在6艘驱逐舰、3艘靶舰与3艘诱饵舰混合编队中，空中与水面单向攻击无人系统的兵力规模和攻击时序如何影响靶舰的识别准确性、靶舰毁伤结果与蓝方消耗。研究不将诱饵舰毁伤作为成功条件。")
add_p("成功判据为：在120分钟内，至少1艘靶舰被击沉或达到推演引擎定义的重创状态；同时记录对诱饵舰的误击、对驱逐舰防御能力的影响与蓝方平台损失。")

h1("2 实验背景")
add_p("美国海军无人集群实弹击沉靶舰演习表明，无人机与无人艇可在人员监督下完成从发现、识别到打击和评估的闭环；该案例使用4架无人机与1艘无人艇，对1艘退役护卫舰实施3次动能打击。该规模只能作为本实验的低量级参照，不能外推为对多艘驱逐舰编队的效能结论。〔依据：美军海上无人集群实弹击沉靶舰演习，2025年〕")
add_p("“地狱景象”构想强调大量小型无人系统造成饱和压力。美国无人艇测试曾部署30余艘无人艇，且暴露出软件、指挥控制和可靠性风险。〔依据：美军无人艇测试连环事故，2025年〕")
add_p("魔鬼鱼T-38为美国制造的高速无人水面艇，已完成单向攻击相关实弹测试；其默认轻型载荷可造成传感器与通信任务失能，但对大型水面舰的击沉或重创不构成已验证能力。〔依据：魔鬼鱼T-38装备规格；美国海军数字利爪无人系统实弹测试〕")

h1("3 初始态势")
table(["要素", "暂定设计"], [
    ["实验海域", "抽象海上试验区域；不使用真实地理坐标。"],
    ["起始时刻", "所有蓝方平台均已完成预置；T+00为首次开始搜索与识别的时刻。"],
    ["红方态势", "6艘驱逐舰、3艘靶舰、3艘诱饵舰组成混合编队；红方采用预设机动和分层防御。"],
    ["蓝方态势", "见证者-136空中单向攻击无人机与魔鬼鱼T-38高速无人艇均已部署至作战区域附近。"],
    ["时间边界", "不计转场；推演从T+00起最长120分钟。"],
    ["空间参数", "初始间距、阵位与编队间隔尚无OKF定量依据，作为知识缺口；试车前应以一致参数固定。"],
], [3.2, 12.8])

h1("4 双方编成")
table(["阵营", "单位与数量", "用途与状态"], [
    ["红方", "美国驱逐舰 6艘", "编队防御与机动节点；具体舰型、传感器和武器配置待补充核实。"],
    ["红方", "靶舰 3艘", "实验主要目标；至少1艘被击沉或重创即达到成功判据。"],
    ["红方", "诱饵舰 3艘", "制造识别歧义与火力分流；其毁伤不计入成功。"],
    ["蓝方", "见证者-136 空中单向攻击无人机", "用户明确豁免美国装备约束。该平台为伊朗制造，承担数量可变的空中突击角色。"],
    ["蓝方", "魔鬼鱼T-38 高速无人艇", "美国MARTAC制造；承担防御能力压制、突击和协同毁伤。其单向攻击战斗部为本实验用户指定假设。"],
], [2.0, 5.0, 9.0])

h1("5 变量设置与约束条件")
h2("5.1 变量维度清点")
table(["维度", "本实验处理方式", "理由"], [
    ["双方能力水平", "固定", "红方采用预设机动和分层防御；蓝方采用一致的指挥控制与识别规则。"],
    ["兵力编成", "作为自变量扫描", "见证者-136数量与T-38数量同步改变。"],
    ["装备能力假设", "固定并标注缺口", "T-38配置单向攻击战斗部为用户设定；战斗部规格和集成依据待补充。"],
    ["年代设定", "固定为2026年前后", "与T-38已公开装备状态相匹配；见证者-136为用户豁免平台。"],
    ["海况与气象", "暂不考虑", "OKF未给出适用于本编队的定量参数；首轮应固定为同一中性条件。"],
    ["作战行为", "作为自变量扫描", "比较识别后集中攻击、先压制防御、全目标同时攻击三种方案。"],
    ["部署位置与初始阵位", "固定", "所有蓝方平台预置，省略转场；具体数值待试车前统一确定。"],
    ["编队方式", "固定", "红方保持6艘驱逐舰、3艘靶舰、3艘诱饵舰，并按预设机动执行。"],
    ["干扰设置", "不纳入", "用户确认首轮不纳入电磁与通信干扰，以控制复杂度与不确定性。"],
], [3.2, 4.5, 8.3])

h2("5.2 实验矩阵")
table(["层级", "无人机与无人艇数量", "战术方案", "场景数与处理规则"], [
    ["首轮低档", "48架见证者-136；4艘T-38", "三种方案全部执行", "3个场景。若不能完成任务，不再测试更低数量。"],
    ["首轮高档", "96架见证者-136；8艘T-38", "三种方案全部执行", "3个场景。若能够完成任务，不再测试更高数量。"],
    ["阈值加密", "72架见证者-136；6艘T-38", "仅对低档失败、高档成功的方案执行", "最多3个场景，用于缩小可行兵力区间。"],
    ["上界扩展", "144架见证者-136；12艘T-38", "仅对高档仍失败的方案执行", "最多3个场景；若仍失败，报告当前上界内未达成，不继续扩展。"],
    ["下界补测", "24架见证者-136；2艘T-38", "仅在需要识别更低充分兵力时执行", "非首轮必做项；用于将“48架、4艘足够”进一步转化为更小的数量区间。"],
], [2.1, 4.8, 3.9, 5.2])
add_p("首轮共6个场景；根据结果最多增加3个场景后形成阶段性结论。整体耗时估算在首轮实测后回填依据。")

h2("5.3 用户给定约束")
table(["约束", "落实方式"], [
    ["作战时长不超过2小时", "采用T+00至T+120分钟硬性结束条件。"],
    ["省略转场时间", "全部蓝方平台在T+00前完成预置。"],
    ["研究数量、战术配合和时空关系", "兵力规模和三种战术作为核心自变量；时间节点与预置关系纳入记录。"],
    ["美国平台、装备与武器", "红方和T-38按该约束处理；见证者-136为用户明确豁免。"],
], [5.0, 11.0])

h1("6 关键假设")
table(["假设", "依据与影响"], [
    ["靶舰与诱饵舰在初始识别中存在可观测歧义", "这是用户指定的研究难点；具体可识别特征尚待建模。"],
    ["见证者-136可用于海上单向攻击", "其存在海上攻击商船记录，但目标为商船而非现代驱逐舰，不能据此推断对驱逐舰的毁伤效能。〔依据：伊朗见证者-136无人机袭击商船系列，2021至2023年〕"],
    ["T-38可承担防御能力压制", "原始资料支持其轻型载荷对传感器和通信造成任务失能；重创靶舰的单向战斗部属于用户设定，需补充依据。〔依据：魔鬼鱼T-38装备规格〕"],
    ["先压制防御可能改变后续打击结果", "作为待验证假设，不预设结论。"],
    ["不纳入电磁干扰", "用户确认。无人系统案例显示通信中断会显著改变行动结果，因此该结论仅适用于无干扰基线。〔依据：美军海上无人集群实弹击沉靶舰演习，2025年〕"],
], [5.2, 10.8])

h1("7 实验方案")
table(["方案", "行动逻辑", "主要观测量"], [
    ["方案一 识别后集中攻击", "先完成靶舰与诱饵舰区分，再将主要攻击资源集中投向靶舰。", "识别准确率、靶舰毁伤、误击诱饵舰比例、蓝方消耗。"],
    ["方案二 先压制后攻击", "优先攻击驱逐舰的防御能力相关节点，待防御能力降低后再集中攻击靶舰。", "防御能力变化时点、靶舰毁伤、平台损失、总用时。"],
    ["方案三 全目标同时攻击", "对全部可见目标同时分配攻击资源，不预先区分靶舰与诱饵舰。", "靶舰毁伤、诱饵舰误击、资源分散程度、总用时。"],
], [3.2, 7.0, 5.8])
add_p("判读时优先比较每一方案在相同兵力档位下的靶舰毁伤率与蓝方消耗；若低档失败且高档成功，则以中档验证给出可行兵力区间，而非宣称精确最小数量。")

h1("8 关键行动")
table(["主体", "关键行动"], [
    ["蓝方无人机", "搜索、辅助识别、实施空中单向攻击，并回传毁伤观察。"],
    ["蓝方T-38", "以高速接近实施单向攻击；在方案二中优先作用于驱逐舰防御能力相关节点。"],
    ["红方驱逐舰", "按预设机动和分层防御响应来袭目标。"],
    ["红方靶舰与诱饵舰", "保持混合编队态势，构成识别与资源分配压力。"],
], [3.2, 12.8])

h1("9 推演过程")
add_p("以下时刻表为首轮统一任务节奏。具体目标距离与航速由试车前参数表固定；本表不将时刻视为平台性能数据。")
table(["时刻", "主体", "行动", "目标或参数"], [
    ["T+00分", "蓝方", "启动搜索与态势汇聚", "全部平台已预置；推演计时开始。"],
    ["T+05分", "蓝方无人机", "形成初始目标清单", "区分驱逐舰、靶舰与诱饵舰的候选集合。"],
    ["T+15分", "蓝方", "按所选方案完成攻击资源分配", "方案一集中靶舰；方案二先防御节点；方案三全目标同时。"],
    ["T+30分", "蓝方无人机与T-38", "实施首轮空海协同攻击", "记录目标分配、平台损失和初始毁伤。"],
    ["T+60分", "红蓝双方", "执行机动、防御响应与必要补攻", "仅在识别与生存条件满足时更新目标分配。"],
    ["T+90分", "蓝方", "进行毁伤评估与末轮补攻决策", "优先检查靶舰是否已达到击沉或重创。"],
    ["T+120分", "系统", "强制结束并导出记录", "达到用户规定的作战时间上限。"],
], [2.0, 3.0, 5.5, 5.5])

h1("10 推演记录")
add_p("推演后回填：每场景的实际持续时间、靶舰状态、诱饵舰误击、驱逐舰防御能力变化、蓝方损失和异常事件。")

h1("11 数据统计")
add_p("推演后回填：按战术方案和兵力档位统计靶舰击沉或重创比例、识别准确率、误击比例、平台损失率、达到成功判据的时间和未达成原因。")

h1("12 结论")
add_p("推演后回填：结论应报告可行兵力区间、三种方案的相对表现、适用前提与未解决的知识缺口，不将单次结果外推为现实作战结论。")

h1("附 依据汇总与知识缺口清单")
h2("依据汇总")
for item in [
    "美军海上无人集群实弹击沉靶舰演习，2025年：4架无人机与1艘无人艇协同、人员监督与完整杀伤链闭环。",
    "美军无人艇测试连环事故，2025年：地狱景象构想及30余艘无人艇测试中的可靠性风险。",
    "魔鬼鱼T-38装备规格：美国制造、高速、载荷、传感器、单向攻击相关实弹测试和能力边界。",
    "伊朗见证者-136无人机袭击商船系列，2021至2023年：平台国别、海上单向攻击记录及其对商船的毁伤事实。",
    "美军海上无人集群实弹击沉靶舰演习，2025年：通信问题会改变无人平台行动，支持首轮将电磁干扰排除。",
]:
    p = doc.add_paragraph(style="Normal")
    p.style = doc.styles["Normal"]
    p.paragraph_format.left_indent = Cm(0.4)
    p.paragraph_format.first_line_indent = Cm(-0.4)
    p.add_run("• " + item)

h2("知识缺口登记单 1")
add_p("缺什么：魔鬼鱼T-38采用单向攻击战斗部时的具体战斗部、安装方式和对靶舰毁伤效能依据。", "缺什么：")
add_p("影响哪个决定：方案二的防御压制范围，以及T-38对靶舰重创的效能判读。", "影响哪个决定：")
add_p("已查过哪里：OKF装备规格及装备映射；已确认T-38平台、速度和轻型载荷能力，未发现可直接支撑本实验单向重创设定的公开集成依据。", "已查过哪里：")
add_p("建议补充方向：补充美国T-38单向攻击或重型反舰载荷的原始试验资料；在补充前，将该设定标注为用户指定假设。", "建议补充方向：")
add_p("请您定夺：补充知识 / 接受暂定 / 放弃该决定。", "请您定夺：")

h2("知识缺口登记单 2")
add_p("缺什么：6艘美国驱逐舰、3艘靶舰和3艘诱饵舰的具体型号、武器、传感器和防御性能。", "缺什么：")
add_p("影响哪个决定：红方拦截能力、识别难度和靶舰重创判据。", "影响哪个决定：")
add_p("已查过哪里：OKF实战案例与装备映射。公开案例未提供与本实验编队完全对应的完整配置。", "已查过哪里：")
add_p("建议补充方向：提供或核实红方各舰型及防御配置的可引用资料。", "建议补充方向：")
add_p("请您定夺：补充知识 / 接受暂定 / 放弃该决定。", "请您定夺：")

h2("知识缺口登记单 3")
add_p("缺什么：适用于本实验的初始阵位、舰间距、海况、气象和推演引擎中“重创”的量化映射。", "缺什么：")
add_p("影响哪个决定：120分钟内的时空可行性、传感器表现和成功判据的一致性。", "影响哪个决定：")
add_p("已查过哪里：OKF实战案例与装备规格。未发现可直接搬用的同类编队参数。", "已查过哪里：")
add_p("建议补充方向：在试车前通过独立参数确认书固定，并在后续版本记录来源。", "建议补充方向：")
add_p("请您定夺：补充知识 / 接受暂定 / 放弃该决定。", "请您定夺：")

# Footer page number
footer = section.footer
p = footer.paragraphs[0]
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("实验设计文档 | 2026年9月14日")
r.font.name = "Microsoft YaHei"
r._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
r.font.size = Pt(8)

doc.core_properties.title = "地狱景象无人系统编队打击实验设计"
doc.core_properties.author = "Codex"
doc.core_properties.subject = "实验设计文档"
doc.save(OUT)
print(OUT)
