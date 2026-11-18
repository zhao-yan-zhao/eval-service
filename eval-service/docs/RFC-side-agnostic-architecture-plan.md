# F1 评估中台：算子全量中立计算与去阵营硬编码改造规范 (RFC)

> **目标**：彻底剥除算子初期计算中的“单方硬编码筛选（targetSide）”，实现**底层计算 100% 阵营中立（全量保留）**，完美适配现实推演中任意阵营命名（如 `PLAAF vs USAF`、`TaskForce-77`、`红/蓝/绿` 多方混战等）。

---

## 一、 算子重做核心规范（铁律）

### 1. 严禁在初期计算中过滤阵营（No Premature Side Filtering）
- **错误做法**：
  在算子开头 `filter(r => r.ShooterSide === '红方')` 或 `filter(r => r.Side === targetSide)`，强行把其他阵营过滤掉，只算一方的数值。
- **正确做法**：
  保持算子中立全量计算。如果是统计汇总算子（如命中率、战损、探测、消耗等），**天然按 `Side`（或 `ShooterSide`）作为普通维度字段进行分组汇总（Group By Side）**，输出多行标准表（每方占一行）。
  > **展示层处理**：具体展示单方、双方对比还是复盘雷达图，交由前端展示层和指标映射层按需切片，初期计算绝不丢弃任何一方数据。

### 2. 严禁硬编码阵营名称（Zero Hardcoding of Side Names）
- **错误做法**：
  写死 `if (side === '红方')`、`side.toLowerCase() === 'blue'` 或默认兜底 `'红方'` / `'蓝方'`。
- **正确做法**：
  将 `Side` 视为推演数据中的普通字符串维度。推演数据里是 `PLAAF`、`USAF` 还是 `Team_A`，算子就直接聚合输出对应的字符串，不设任何先验假设。

---

## 二、 代码改动范式对比

### 范例 1：武器命中与战损类算子

#### ❌ 改造前（有阵营偏向、过早过滤）：
```ts
// 错误：写死了只算 targetSide（红方）
const myFires = situation.weaponFiredEvents.filter(
  w => !targetSide || w.firerSide === targetSide
);
const hits = situation.damageAndHitEvents.filter(
  d => !targetSide || d.attackerSide === targetSide
);
const hitRate = myFires.length > 0 ? hits.length / myFires.length : 0;
return {
  value: hitRate,
  // 蓝方数据被彻底丢失，无法做交换比或双方对比
};
```

#### ✅ 改造后（中立全量、保留 Side 维度）：
```ts
// 正确：全量统计各阵营的发射与命中，产出标准数据集
const statsBySide: Record<string, { fired: number; hits: number }> = {};

for (const w of situation.weaponFiredEvents) {
  const side = w.firerSide || 'Unknown';
  if (!statsBySide[side]) statsBySide[side] = { fired: 0, hits: 0 };
  statsBySide[side].fired++;
}

for (const d of situation.damageAndHitEvents) {
  const side = d.attackerSide || 'Unknown';
  if (!statsBySide[side]) statsBySide[side] = { fired: 0, hits: 0 };
  if (/HIT|KILL/i.test(d.result)) {
    statsBySide[side].hits++;
  }
}

// 产出多方完整数据集（红方一行、蓝方一行、中立方一行等）
const rows = Object.entries(statsBySide).map(([side, s]) => ({
  Side: side,
  FiredCount: s.fired,
  HitCount: s.hits,
  HitRate: s.fired > 0 ? s.hits / s.fired : 0,
}));
```

---

## 三、 算子流水线画布（Canvas Pipeline）设计要求
1. **数据汇总节点 (`group_agg`)**：
   - 分组主键（`groupKeys`）默认包含 `['Side']`；
   - 避免无主键的全表直接收拢为 1 行标量，保证各阵营均有对应的独立度量记录。
2. **算子配置抽屉**：
   - 不再强制要求用户输入生硬的 `我方阵营 targetSide`；
   - 算子计算输出的标准切片保留 `Side` 列供下游消费与展示层切片。
