# STABLE-R3-A1-R1：候选独立目录飞机航线真机探针 Cursor工单

> 日期：2026-08-31  
> 上轮仅因版本不可追溯而停工，未执行P1/P2/P3。监理现已在固定HEAD亲自Rebuild并固化候选指纹。  
> 本轮仍只做真机取证：不改代码、不提交、不覆盖旧专机目录、不保存正式想定。

## 一、开工版本门

1. 源码必须是`D:\soft\F1-AI-integration`、`integration/stable-single-ai`、HEAD `c8427d8544c6e3f23ab34bcbd9f4f7dd351721c1`；只允许`runs/`取证脏项。
2. 完整读取并核对`D:\soft\F1-AI\STABLE-R3-c8427d8-候选运行清单-20260831.md`。
3. 启动前重算：
   - `D:\soft\F1-AI-integration\F1\F1.dll` SHA-256必须为`2931F14A092915B217D99116F48A4D8096E40D42399A6A85A8B251FC5C7E0CE3`；
   - binlog SHA-256必须为`A063C4EFF6BFD1B6FD490956E8802EA6D7FCA2FD631C6E22DC923981EF85C691`。
4. 只从`D:\soft\F1-AI-integration\F1\F1.exe`启动，启动后记录进程实际路径。禁止启动`D:\soft\F1-AI\F1\F1.exe`。
5. 若候选目录缺资源、启动失败、hash漂移或进程路径不符：立即停工，报告真实错误；不得复制整棵旧F1目录、不得覆盖旧专机、不得改源码求启动。

## 二、安全准备

- 只用临时且最终不保存的测试想定；先确认真实阵营名。
- 选择本机数据库中已确认有效的一组Aircraft DBID + loadout_id；没有可靠组合就查数据库/UI，禁止猜数字。
- 出生点与两个航点远离其他单位、彼此明显分开；单位名前缀统一`_A1_PROBE_`。
- 开始前记录想定名、阵营、DBID、loadout、出生点、两个航点，并截图。

## 三、P1：当前unit.add内嵌course

- 用当前AI任务入口创建一架Aircraft，带有效loadout和两个course点；保存完整工具请求、回执和unit_id。
- 取证：地图规划线、UI航点、运行30脉冲后的运动方向/到第一航点距离变化。
- 同时尝试真实航点读回；没有就写“未找到”，不得把请求里的2当成功。

## 四、P2：对同一飞机独立二次SetUnit

- 不删除P1飞机；对同一unit_id调用现有`unit.update_position`，保持当前位置或记录明确新位置，并传同样两个course点。
- 再取证地图航线、真实航点数、30脉冲后的距离变化。
- 判定：
  - P1不生效、P2生效：A1二次SetUnit方向通过；
  - P1/P2都不生效：A1方向不通过，查速度/throttle/任务/API限制；
  - P1/P2都生效：原问题可能是运行条件，不得开A1施工。

## 五、P3：真实读回

- 先grep本机源码确认表达式，再通过可用Lua控制台或最小只读方式读取真实对象的`PlottedCourse.Count`或等价航点集合。
- 记录表达式、unit_id、返回值和截图/控制台原文。
- API存在但Lua不可访问：写`真实读回待确认`并提出最小Core只读接缝；未找到则逐字写“未找到”。
- 当前`unit.update_position`回执中的`course_waypoints`是请求数量，不算P3证据。

## 六、清理与报告

- 删除`_A1_PROBE_`单位，或关闭临时想定且不保存；确认正式想定未改。
- 报告必须包含版本门hash、实际进程路径、P1/P2/P3证据、参数、unit_id、截图/日志路径和清理结果。
- 最终只允许三种裁决：`A1可施工` / `A1方向不通过` / `真实读回待确认`。
- 报告落盘：`D:\soft\F1-AI\STABLE-R3-A1-R1-候选独立目录真机探针报告-20260831.md`。

本轮不做Facility/B2、批6D、A1–A16、tag/push、night-soak、V2.2。
