/**
 * 仿真 CSV 底表标准采样数据集目录 (Table Sample Catalog)
 * 为一库全量 42 个业务算子流水线提供与其输入契约严格对齐的真实领域样本数据。
 * 覆盖 24 张 F1/CMO 原生仿真导出事件表，包含红蓝双边 (Blue/Red) 实体与时序事件。
 */

import type { TableDataset } from '../core/types.ts';

export const TABLE_SAMPLE_DATASETS: Record<string, TableDataset> = {
  // 1. Expenditures.csv (弹药消耗记录)
  'Expenditures.csv': {
    id: 'sample_expenditures',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器编号', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'WeaponName', displayName: '武器型号', type: 'string' },
      { name: 'Num', displayName: '消耗数量', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器编号', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'WeaponName', displayName: '武器型号', type: 'string' },
      { name: 'Num', displayName: '消耗数量', type: 'number' },
    ],
    rows: [
      { Time: '00:15:30', WeaponID: 'PL15_001', Side: 'Blue', WeaponName: 'PL-15 空空导弹', Num: 1 },
      { Time: '00:16:10', WeaponID: 'PL15_002', Side: 'Blue', WeaponName: 'PL-15 空空导弹', Num: 1 },
      { Time: '00:18:25', WeaponID: 'AIM120D_001', Side: 'Red', WeaponName: 'AIM-120D 空空导弹', Num: 1 },
      { Time: '00:19:00', WeaponID: 'AIM120D_002', Side: 'Red', WeaponName: 'AIM-120D 空空导弹', Num: 1 },
      { Time: '00:22:15', WeaponID: 'PL15_003', Side: 'Blue', WeaponName: 'PL-15 空空导弹', Num: 1 },
      { Time: '00:25:40', WeaponID: 'AIM120D_003', Side: 'Red', WeaponName: 'AIM-120D 空空导弹', Num: 1 },
    ],
    totalRows: 6,
  },

  // 2. UnitDestroyed.csv (战损与被击毁记录)
  'UnitDestroyed.csv': {
    id: 'sample_unit_destroyed',
    schema: [
      { name: 'Time', displayName: '战损时标', type: 'string' },
      { name: 'TimelineID', displayName: '推演时标ID', type: 'number' },
      { name: 'Iteration', displayName: '蒙特卡洛轮次', type: 'number' },
      { name: 'UnitID', displayName: '受损单元ID', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '单元阵营', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'UnitClass', displayName: '单元型号', type: 'string' },
      { name: 'DamagePercent', displayName: '毁伤百分比', type: 'number' },
      { name: 'SubjectID', displayName: '致损武器/主体', type: 'string' },
      { name: 'Cause', displayName: '战损原因', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '战损时标', type: 'string' },
      { name: 'TimelineID', displayName: '推演时标ID', type: 'number' },
      { name: 'Iteration', displayName: '蒙特卡洛轮次', type: 'number' },
      { name: 'UnitID', displayName: '受损单元ID', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '单元阵营', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'UnitClass', displayName: '单元型号', type: 'string' },
      { name: 'DamagePercent', displayName: '毁伤百分比', type: 'number' },
      { name: 'SubjectID', displayName: '致损武器/主体', type: 'string' },
      { name: 'Cause', displayName: '战损原因', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:24:30', TimelineID: 101, Iteration: 1, UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', UnitType: 'Aircraft', UnitClass: 'F-35A', DamagePercent: 100, SubjectID: 'PL15_001', Cause: 'Weapon' },
      { Time: '2026-11-18 00:26:10', TimelineID: 102, Iteration: 1, UnitID: 'F35_02', UnitSide: 'Red', Side: 'Red', UnitType: 'Aircraft', UnitClass: 'F-35A', DamagePercent: 100, SubjectID: 'PL15_002', Cause: 'Weapon' },
      { Time: '2026-11-18 00:28:00', TimelineID: 103, Iteration: 1, UnitID: 'AIM120D_001', UnitSide: 'Red', Side: 'Red', UnitType: 'Weapon', UnitClass: 'AIM-120D', DamagePercent: 100, SubjectID: 'Intercept', Cause: 'PointDefence' },
      { Time: '2026-11-18 00:30:15', TimelineID: 104, Iteration: 1, UnitID: 'GJ11_02', UnitSide: 'Blue', Side: 'Blue', UnitType: 'Aircraft', UnitClass: 'GJ-11', DamagePercent: 100, SubjectID: 'AIM120D_002', Cause: 'Weapon' },
      { Time: '2026-11-18 00:33:00', TimelineID: 105, Iteration: 1, UnitID: 'PL15_003', UnitSide: 'Blue', Side: 'Blue', UnitType: 'Weapon', UnitClass: 'PL-15', DamagePercent: 100, SubjectID: 'Miss', Cause: 'Script' },
    ],
    totalRows: 5,
  },

  // 3. UnitDamaged.csv (部件与结构受损事件)
  'UnitDamaged.csv': {
    id: 'sample_unit_damaged',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'DamagePercent', displayName: '毁伤比例 (%)', type: 'number' },
      { name: 'ComponentDamageSeverity', displayName: '部件受损等级', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'DamagePercent', displayName: '毁伤比例 (%)', type: 'number' },
      { name: 'ComponentDamageSeverity', displayName: '部件受损等级', type: 'string' },
    ],
    rows: [
      { Time: '00:20:10', UnitID: 'F35_01', Side: 'Red', DamagePercent: 80, ComponentDamageSeverity: 'Heavy' },
      { Time: '00:22:30', UnitID: 'F35_02', Side: 'Red', DamagePercent: 65, ComponentDamageSeverity: 'Heavy' },
      { Time: '00:24:15', UnitID: 'F35_03', Side: 'Red', DamagePercent: 35, ComponentDamageSeverity: 'Medium' },
      { Time: '00:26:00', UnitID: 'GJ11_01', Side: 'Blue', DamagePercent: 20, ComponentDamageSeverity: 'Light' },
      { Time: '00:28:40', UnitID: 'GJ11_02', Side: 'Blue', DamagePercent: 90, ComponentDamageSeverity: 'Critical' },
    ],
    totalRows: 5,
  },

  // 4. WeaponEndgame.csv (武器终态拦截与命中事件)
  'WeaponEndgame.csv': {
    id: 'sample_weapon_endgame',
    schema: [
      { name: 'Time', displayName: '终态时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'WeaponName', displayName: '武器名称', type: 'string' },
      { name: 'WeaponClass', displayName: '武器型号', type: 'string' },
      { name: 'FiringUnitID', displayName: '发射单元ID', type: 'string' },
      { name: 'ParentFiringUnitID', displayName: '母平台ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射方阵营', type: 'string' },
      { name: 'WeaponSide', displayName: '武器阵营', type: 'string' },
      { name: 'Side', displayName: '归属阵营', type: 'string' },
      { name: 'FireTime', displayName: '发射时标', type: 'string' },
      { name: 'InitialFindTime', displayName: '初始建轨时标', type: 'string' },
      { name: 'Result', displayName: '终态结果 (KILL/HIT/MISS)', type: 'string' },
      { name: 'TargetID', displayName: '目标单元ID', type: 'string' },
      { name: 'TargetSide', displayName: '目标阵营', type: 'string' },
      { name: 'DamagePercent', displayName: '目标毁伤度', type: 'number' },
      { name: 'MissDistance_m', displayName: '脱靶距离 (m)', type: 'number' },
      { name: 'DistanceFromFiringUnit_Horiz', displayName: '终点距发射机水平距 (nm)', type: 'number' },
      { name: 'IsIntercepted', displayName: '是否遭拦截 (1/0)', type: 'number' },
      { name: 'Num', displayName: '弹目数量', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '终态时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'WeaponName', displayName: '武器名称', type: 'string' },
      { name: 'WeaponClass', displayName: '武器型号', type: 'string' },
      { name: 'FiringUnitID', displayName: '发射单元ID', type: 'string' },
      { name: 'ParentFiringUnitID', displayName: '母平台ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射方阵营', type: 'string' },
      { name: 'WeaponSide', displayName: '武器阵营', type: 'string' },
      { name: 'Side', displayName: '归属阵营', type: 'string' },
      { name: 'FireTime', displayName: '发射时标', type: 'string' },
      { name: 'InitialFindTime', displayName: '初始建轨时标', type: 'string' },
      { name: 'Result', displayName: '终态结果 (KILL/HIT/MISS)', type: 'string' },
      { name: 'TargetID', displayName: '目标单元ID', type: 'string' },
      { name: 'TargetSide', displayName: '目标阵营', type: 'string' },
      { name: 'DamagePercent', displayName: '目标毁伤度', type: 'number' },
      { name: 'MissDistance_m', displayName: '脱靶距离 (m)', type: 'number' },
      { name: 'DistanceFromFiringUnit_Horiz', displayName: '终点距发射机水平距 (nm)', type: 'number' },
      { name: 'IsIntercepted', displayName: '是否遭拦截 (1/0)', type: 'number' },
      { name: 'Num', displayName: '弹目数量', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:24:30', WeaponID: 'PL15_001', WeaponName: 'PL-15 #1', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_01', ParentFiringUnitID: 'GJ11_01', FiringUnitSide: 'Blue', WeaponSide: 'Blue', Side: 'Blue', FireTime: '2026-11-18 00:15:30', InitialFindTime: '2026-11-18 00:08:20', Result: 'KILL', TargetID: 'F35_01', TargetSide: 'Red', DamagePercent: 100, MissDistance_m: 0.5, DistanceFromFiringUnit_Horiz: 48.5, IsIntercepted: 0, Num: 1 },
      { Time: '2026-11-18 00:26:10', WeaponID: 'PL15_002', WeaponName: 'PL-15 #2', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_01', ParentFiringUnitID: 'GJ11_01', FiringUnitSide: 'Blue', WeaponSide: 'Blue', Side: 'Blue', FireTime: '2026-11-18 00:16:10', InitialFindTime: '2026-11-18 00:09:00', Result: 'KILL', TargetID: 'F35_02', TargetSide: 'Red', DamagePercent: 65, MissDistance_m: 2.8, DistanceFromFiringUnit_Horiz: 44.2, IsIntercepted: 0, Num: 1 },
      { Time: '2026-11-18 00:28:15', WeaponID: 'PL15_003', WeaponName: 'PL-15 #3', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_02', ParentFiringUnitID: 'GJ11_02', FiringUnitSide: 'Blue', WeaponSide: 'Blue', Side: 'Blue', FireTime: '2026-11-18 00:22:15', InitialFindTime: '2026-11-18 00:10:30', Result: 'MISS', TargetID: 'F35_03', TargetSide: 'Red', DamagePercent: 0, MissDistance_m: 45.2, DistanceFromFiringUnit_Horiz: 55.6, IsIntercepted: 1, Num: 1 },
      { Time: '2026-11-18 00:30:15', WeaponID: 'AIM120D_001', WeaponName: 'AIM-120D #1', WeaponClass: 'AIM-120D', FiringUnitID: 'F35_01', ParentFiringUnitID: 'F35_01', FiringUnitSide: 'Red', WeaponSide: 'Red', Side: 'Red', FireTime: '2026-11-18 00:18:25', InitialFindTime: '2026-11-18 00:11:00', Result: 'KILL', TargetID: 'GJ11_02', TargetSide: 'Blue', DamagePercent: 100, MissDistance_m: 0.8, DistanceFromFiringUnit_Horiz: 39.0, IsIntercepted: 0, Num: 1 },
      { Time: '2026-11-18 00:32:00', WeaponID: 'AIM120D_002', WeaponName: 'AIM-120D #2', WeaponClass: 'AIM-120D', FiringUnitID: 'F35_02', ParentFiringUnitID: 'F35_02', FiringUnitSide: 'Red', WeaponSide: 'Red', Side: 'Red', FireTime: '2026-11-18 00:19:00', InitialFindTime: '2026-11-18 00:11:30', Result: 'MISS', TargetID: 'GJ11_01', TargetSide: 'Blue', DamagePercent: 0, MissDistance_m: 62.4, DistanceFromFiringUnit_Horiz: 41.8, IsIntercepted: 0, Num: 1 },
      { Time: '2026-11-18 00:34:40', WeaponID: 'AIM120D_003', WeaponName: 'AIM-120D #3', WeaponClass: 'AIM-120D', FiringUnitID: 'SAM_BLUE_01', ParentFiringUnitID: 'SAM_BLUE_01', FiringUnitSide: 'Blue', WeaponSide: 'Blue', Side: 'Blue', FireTime: '2026-11-18 00:25:40', InitialFindTime: '2026-11-18 00:12:00', Result: 'KILL', TargetID: 'AIM120D_001', TargetSide: 'Red', DamagePercent: 100, MissDistance_m: 0.2, DistanceFromFiringUnit_Horiz: 28.4, IsIntercepted: 0, Num: 1 },
      { Time: '2026-11-18 00:36:10', WeaponID: 'KD88_001', WeaponName: 'KD-88 #1', WeaponClass: 'KD-88', FiringUnitID: 'F35_03', ParentFiringUnitID: 'F35_03', FiringUnitSide: 'Red', WeaponSide: 'Red', Side: 'Red', FireTime: '2026-11-18 00:24:00', InitialFindTime: '2026-11-18 00:12:30', Result: 'HIT', TargetID: 'SAM_BLUE_01', TargetSide: 'Blue', DamagePercent: 75, MissDistance_m: 1.5, DistanceFromFiringUnit_Horiz: 52.0, IsIntercepted: 0, Num: 1 },
    ],
    totalRows: 7,
  },

  // 5. DetectionIdentificationChanged.csv (发现与正向识别状态跳变)
  'DetectionIdentificationChanged.csv': {
    id: 'sample_detection_identification',
    schema: [
      { name: 'Time', displayName: '跳变时标', type: 'string' },
      { name: 'ContactID', displayName: '目标批号', type: 'string' },
      { name: 'ContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'UnitID', displayName: '探测平台ID', type: 'string' },
      { name: 'SensorPlatformID', displayName: '传感器平台ID', type: 'string' },
      { name: 'SensorPlatformName', displayName: '探测平台名', type: 'string' },
      { name: 'SensorName', displayName: '探测传感器', type: 'string' },
      { name: 'Side', displayName: '探测方阵营', type: 'string' },
      { name: 'FindTime', displayName: '首次发现时标', type: 'string' },
      { name: 'IdentificationStatus', displayName: '识别状态 (KnownClass/PreciseID)', type: 'string' },
      { name: 'ContactRangeHoriz_nm', displayName: '探测水平距离 (nm)', type: 'number' },
      { name: 'DistanceFromSensor_nm', displayName: '距传感器距离 (nm)', type: 'number' },
      { name: 'UnitLongitude', displayName: '探测机经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '探测机纬度', type: 'number' },
      { name: 'ContactActualLongitude', displayName: '目标经度', type: 'number' },
      { name: 'ContactActualLatitude', displayName: '目标纬度', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '跳变时标', type: 'string' },
      { name: 'ContactID', displayName: '目标批号', type: 'string' },
      { name: 'ContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'UnitID', displayName: '探测平台ID', type: 'string' },
      { name: 'SensorPlatformID', displayName: '传感器平台ID', type: 'string' },
      { name: 'SensorPlatformName', displayName: '探测平台名', type: 'string' },
      { name: 'SensorName', displayName: '探测传感器', type: 'string' },
      { name: 'Side', displayName: '探测方阵营', type: 'string' },
      { name: 'FindTime', displayName: '首次发现时标', type: 'string' },
      { name: 'IdentificationStatus', displayName: '识别状态 (KnownClass/PreciseID)', type: 'string' },
      { name: 'ContactRangeHoriz_nm', displayName: '探测水平距离 (nm)', type: 'number' },
      { name: 'DistanceFromSensor_nm', displayName: '距传感器距离 (nm)', type: 'number' },
      { name: 'UnitLongitude', displayName: '探测机经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '探测机纬度', type: 'number' },
      { name: 'ContactActualLongitude', displayName: '目标经度', type: 'number' },
      { name: 'ContactActualLatitude', displayName: '目标纬度', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:08:20', ContactID: 'CNT_RED_01', ContactActualUnitID: 'F35_01', UnitID: 'GJ11_01', SensorPlatformID: 'GJ11_01', SensorPlatformName: '攻击-11长机', SensorName: 'AESA雷达', Side: 'Blue', FindTime: '2026-11-18 00:05:10', IdentificationStatus: 'KnownDomain', ContactRangeHoriz_nm: 86.4, DistanceFromSensor_nm: 86.4, UnitLongitude: 122.45, UnitLatitude: 25.32, ContactActualLongitude: 123.80, ContactActualLatitude: 25.70 },
      { Time: '2026-11-18 00:09:10', ContactID: 'CNT_RED_01', ContactActualUnitID: 'F35_01', UnitID: 'GJ11_01', SensorPlatformID: 'GJ11_01', SensorPlatformName: '攻击-11长机', SensorName: 'EOTS光电', Side: 'Blue', FindTime: '2026-11-18 00:05:10', IdentificationStatus: 'KnownClass', ContactRangeHoriz_nm: 72.1, DistanceFromSensor_nm: 72.1, UnitLongitude: 122.50, UnitLatitude: 25.35, ContactActualLongitude: 123.75, ContactActualLatitude: 25.68 },
      { Time: '2026-11-18 00:10:30', ContactID: 'CNT_RED_02', ContactActualUnitID: 'F35_02', UnitID: 'GJ11_02', SensorPlatformID: 'GJ11_02', SensorPlatformName: '攻击-11僚机', SensorName: 'AESA雷达', Side: 'Blue', FindTime: '2026-11-18 00:07:00', IdentificationStatus: 'PreciseID', ContactRangeHoriz_nm: 68.5, DistanceFromSensor_nm: 68.5, UnitLongitude: 122.48, UnitLatitude: 25.30, ContactActualLongitude: 123.85, ContactActualLatitude: 25.68 },
      { Time: '2026-11-18 00:11:00', ContactID: 'CNT_BLUE_01', ContactActualUnitID: 'GJ11_01', UnitID: 'F35_01', SensorPlatformID: 'F35_01', SensorPlatformName: 'F-35A长机', SensorName: 'AN/APG-81', Side: 'Red', FindTime: '2026-11-18 00:07:30', IdentificationStatus: 'KnownClass', ContactRangeHoriz_nm: 65.2, DistanceFromSensor_nm: 65.2, UnitLongitude: 123.80, UnitLatitude: 25.70, ContactActualLongitude: 122.45, ContactActualLatitude: 25.32 },
      { Time: '2026-11-18 00:12:15', ContactID: 'CNT_BLUE_02', ContactActualUnitID: 'GJ11_02', UnitID: 'F35_02', SensorPlatformID: 'F35_02', SensorPlatformName: 'F-35A僚机', SensorName: 'AN/APG-81', Side: 'Red', FindTime: '2026-11-18 00:08:00', IdentificationStatus: 'PreciseID', ContactRangeHoriz_nm: 61.0, DistanceFromSensor_nm: 61.0, UnitLongitude: 123.85, UnitLatitude: 25.68, ContactActualLongitude: 122.48, ContactActualLatitude: 25.30 },
      { Time: '2026-11-18 00:22:30', ContactID: 'CNT_WPN_01', ContactActualUnitID: 'AIM120D_001', UnitID: 'SAM_BLUE_01', SensorPlatformID: 'SAM_BLUE_01', SensorPlatformName: '红旗-9防空营', SensorName: '相控阵火控雷达', Side: 'Blue', FindTime: '2026-11-18 00:22:30', IdentificationStatus: 'PreciseID', ContactRangeHoriz_nm: 38.0, DistanceFromSensor_nm: 38.0, UnitLongitude: 121.40, UnitLatitude: 31.20, ContactActualLongitude: 122.10, ContactActualLatitude: 31.40 },
    ],
    totalRows: 6,
  },

  // 6. FirstSensorToUnitRecordCreated.csv (首次建立探测记录)
  'FirstSensorToUnitRecordCreated.csv': {
    id: 'sample_first_sensor_record',
    schema: [
      { name: 'Time', displayName: '建轨时标', type: 'string' },
      { name: 'SensorID', displayName: '传感器编号', type: 'string' },
      { name: 'TargetID', displayName: '目标ID', type: 'string' },
      { name: 'Distance', displayName: '物理探测距离 (nm)', type: 'number' },
      { name: 'UnitSide', displayName: '传感器所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '建轨时标', type: 'string' },
      { name: 'SensorID', displayName: '传感器编号', type: 'string' },
      { name: 'TargetID', displayName: '目标ID', type: 'string' },
      { name: 'Distance', displayName: '物理探测距离 (nm)', type: 'number' },
      { name: 'UnitSide', displayName: '传感器所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:05:10', SensorID: 'SENS_GJ11_01', TargetID: 'F35_01', Distance: 86.4, UnitSide: 'Blue', Side: 'Blue' },
      { Time: '2026-11-18 00:05:30', SensorID: 'SENS_SAM_01', TargetID: 'F35_01', Distance: 75.0, UnitSide: 'Blue', Side: 'Blue' },
      { Time: '2026-11-18 00:06:15', SensorID: 'SENS_GJ11_02', TargetID: 'F35_02', Distance: 78.5, UnitSide: 'Blue', Side: 'Blue' },
      { Time: '2026-11-18 00:07:00', SensorID: 'SENS_GJ11_01', TargetID: 'F35_03', Distance: 92.1, UnitSide: 'Blue', Side: 'Blue' },
      { Time: '2026-11-18 00:07:30', SensorID: 'SENS_F35_01', TargetID: 'GJ11_01', Distance: 68.2, UnitSide: 'Red', Side: 'Red' },
      { Time: '2026-11-18 00:08:00', SensorID: 'SENS_F35_02', TargetID: 'GJ11_02', Distance: 64.0, UnitSide: 'Red', Side: 'Red' },
    ],
    totalRows: 6,
  },

  // 7. WeaponFired.csv (武器开火记录)
  'WeaponFired.csv': {
    id: 'sample_weapon_fired',
    schema: [
      { name: 'Time', displayName: '开火时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'WeaponName', displayName: '武器名称', type: 'string' },
      { name: 'WeaponClass', displayName: '武器型号', type: 'string' },
      { name: 'FiringUnitID', displayName: '发射单元ID', type: 'string' },
      { name: 'FiringUnitName', displayName: '发射单元名', type: 'string' },
      { name: 'FiringUnitClass', displayName: '发射平台型号', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'TargetContactID', displayName: '目标批号', type: 'string' },
      { name: 'TargetContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'PidTime', displayName: '确认识别时标', type: 'string' },
      { name: 'TargetContactRangeHoriz_nm', displayName: '开火水平距 (nm)', type: 'number' },
      { name: 'IdentificationStatus', displayName: '开火前识别态', type: 'string' },
      { name: 'SalvoID', displayName: '齐射批次ID', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '开火时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'WeaponName', displayName: '武器名称', type: 'string' },
      { name: 'WeaponClass', displayName: '武器型号', type: 'string' },
      { name: 'FiringUnitID', displayName: '发射单元ID', type: 'string' },
      { name: 'FiringUnitName', displayName: '发射单元名', type: 'string' },
      { name: 'FiringUnitClass', displayName: '发射平台型号', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'TargetContactID', displayName: '目标批号', type: 'string' },
      { name: 'TargetContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'PidTime', displayName: '确认识别时标', type: 'string' },
      { name: 'TargetContactRangeHoriz_nm', displayName: '开火水平距 (nm)', type: 'number' },
      { name: 'IdentificationStatus', displayName: '开火前识别态', type: 'string' },
      { name: 'SalvoID', displayName: '齐射批次ID', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:15:30', WeaponID: 'PL15_001', WeaponName: 'PL-15 #1', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_01', FiringUnitName: '攻击-11长机', FiringUnitClass: 'GJ-11', FiringUnitSide: 'Blue', Side: 'Blue', TargetContactID: 'CNT_RED_01', TargetContactActualUnitID: 'F35_01', PidTime: '2026-11-18 00:08:20', TargetContactRangeHoriz_nm: 52.4, IdentificationStatus: 'PreciseID', SalvoID: 'SALVO_01' },
      { Time: '2026-11-18 00:16:10', WeaponID: 'PL15_002', WeaponName: 'PL-15 #2', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_01', FiringUnitName: '攻击-11长机', FiringUnitClass: 'GJ-11', FiringUnitSide: 'Blue', Side: 'Blue', TargetContactID: 'CNT_RED_02', TargetContactActualUnitID: 'F35_02', PidTime: '2026-11-18 00:09:00', TargetContactRangeHoriz_nm: 48.0, IdentificationStatus: 'KnownClass', SalvoID: 'SALVO_01' },
      { Time: '2026-11-18 00:18:25', WeaponID: 'AIM120D_001', WeaponName: 'AIM-120D #1', WeaponClass: 'AIM-120D', FiringUnitID: 'F35_01', FiringUnitName: 'F-35A长机', FiringUnitClass: 'F-35A', FiringUnitSide: 'Red', Side: 'Red', TargetContactID: 'CNT_BLUE_01', TargetContactActualUnitID: 'GJ11_01', PidTime: '2026-11-18 00:11:00', TargetContactRangeHoriz_nm: 42.5, IdentificationStatus: 'PreciseID', SalvoID: 'SALVO_02' },
      { Time: '2026-11-18 00:19:00', WeaponID: 'AIM120D_002', WeaponName: 'AIM-120D #2', WeaponClass: 'AIM-120D', FiringUnitID: 'F35_02', FiringUnitName: 'F-35A僚机', FiringUnitClass: 'F-35A', FiringUnitSide: 'Red', Side: 'Red', TargetContactID: 'CNT_BLUE_02', TargetContactActualUnitID: 'GJ11_02', PidTime: '2026-11-18 00:12:15', TargetContactRangeHoriz_nm: 39.8, IdentificationStatus: 'KnownClass', SalvoID: 'SALVO_02' },
      { Time: '2026-11-18 00:22:15', WeaponID: 'PL15_003', WeaponName: 'PL-15 #3', WeaponClass: 'PL-15', FiringUnitID: 'GJ11_02', FiringUnitName: '攻击-11僚机', FiringUnitClass: 'GJ-11', FiringUnitSide: 'Blue', Side: 'Blue', TargetContactID: 'CNT_RED_03', TargetContactActualUnitID: 'F35_03', PidTime: '2026-11-18 00:10:30', TargetContactRangeHoriz_nm: 55.6, IdentificationStatus: 'PreciseID', SalvoID: 'SALVO_03' },
      { Time: '2026-11-18 00:24:00', WeaponID: 'KD88_001', WeaponName: 'KD-88 #1', WeaponClass: 'KD-88', FiringUnitID: 'F35_03', FiringUnitName: 'F-35A三号机', FiringUnitClass: 'F-35A', FiringUnitSide: 'Red', Side: 'Red', TargetContactID: 'CNT_BLUE_SAM', TargetContactActualUnitID: 'SAM_BLUE_01', PidTime: '2026-11-18 00:12:30', TargetContactRangeHoriz_nm: 52.0, IdentificationStatus: 'PreciseID', SalvoID: 'SALVO_04' },
    ],
    totalRows: 6,
  },

  // 8. UnitPositions.csv (作战单元航迹与态势点流)
  'UnitPositions.csv': {
    id: 'sample_unit_positions',
    schema: [
      { name: 'Time', displayName: '航迹时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitName', displayName: '单元名称', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'UnitSide', displayName: '阵营别名', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'Longitude', displayName: '经度 (°)', type: 'number' },
      { name: 'Latitude', displayName: '纬度 (°)', type: 'number' },
      { name: 'UnitLongitude', displayName: '单元经度 (°)', type: 'number' },
      { name: 'UnitLatitude', displayName: '单元纬度 (°)', type: 'number' },
      { name: 'UnitCourse', displayName: '单元航向 (°)', type: 'number' },
      { name: 'Altitude_m', displayName: '物理高度 (m)', type: 'number' },
      { name: 'UnitAltitude_m', displayName: '单元高度 (m)', type: 'number' },
      { name: 'SurvivalStatus', displayName: '在勤存活态', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '航迹时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitName', displayName: '单元名称', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'UnitSide', displayName: '阵营别名', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'Longitude', displayName: '经度 (°)', type: 'number' },
      { name: 'Latitude', displayName: '纬度 (°)', type: 'number' },
      { name: 'UnitLongitude', displayName: '单元经度 (°)', type: 'number' },
      { name: 'UnitLatitude', displayName: '单元纬度 (°)', type: 'number' },
      { name: 'UnitCourse', displayName: '单元航向 (°)', type: 'number' },
      { name: 'Altitude_m', displayName: '物理高度 (m)', type: 'number' },
      { name: 'UnitAltitude_m', displayName: '单元高度 (m)', type: 'number' },
      { name: 'SurvivalStatus', displayName: '在勤存活态', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:10:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', Side: 'Blue', UnitSide: 'Blue', UnitType: 'Aircraft', Longitude: 121.40, Latitude: 31.20, UnitLongitude: 121.40, UnitLatitude: 31.20, UnitCourse: 90, Altitude_m: 11500, UnitAltitude_m: 11500, SurvivalStatus: 'Active' },
      { Time: '2026-11-18 00:10:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', Side: 'Blue', UnitSide: 'Blue', UnitType: 'Aircraft', Longitude: 121.45, Latitude: 31.22, UnitLongitude: 121.45, UnitLatitude: 31.22, UnitCourse: 90, Altitude_m: 11200, UnitAltitude_m: 11200, SurvivalStatus: 'Active' },
      { Time: '2026-11-18 00:10:00', UnitID: 'F35_01', UnitName: 'F-35A长机', Side: 'Red', UnitSide: 'Red', UnitType: 'Aircraft', Longitude: 123.80, Latitude: 25.70, UnitLongitude: 123.80, UnitLatitude: 25.70, UnitCourse: 270, Altitude_m: 9800, UnitAltitude_m: 9800, SurvivalStatus: 'Active' },
      { Time: '2026-11-18 00:10:00', UnitID: 'F35_02', UnitName: 'F-35A僚机', Side: 'Red', UnitSide: 'Red', UnitType: 'Aircraft', Longitude: 123.85, Latitude: 25.68, UnitLongitude: 123.85, UnitLatitude: 25.68, UnitCourse: 270, Altitude_m: 9500, UnitAltitude_m: 9500, SurvivalStatus: 'Active' },
      { Time: '2026-11-18 00:20:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', Side: 'Blue', UnitSide: 'Blue', UnitType: 'Aircraft', Longitude: 121.85, Latitude: 31.35, UnitLongitude: 121.85, UnitLatitude: 31.35, UnitCourse: 85, Altitude_m: 11800, UnitAltitude_m: 11800, SurvivalStatus: 'Active' },
      { Time: '2026-11-18 00:20:00', UnitID: 'F35_01', UnitName: 'F-35A长机', Side: 'Red', UnitSide: 'Red', UnitType: 'Aircraft', Longitude: 123.35, Latitude: 25.55, UnitLongitude: 123.35, UnitLatitude: 25.55, UnitCourse: 275, Altitude_m: 10200, UnitAltitude_m: 10200, SurvivalStatus: 'Active' },
    ],
    totalRows: 6,
  },

  // 9. AirOps.csv (基地与航母出动回收记录)
  'AirOps.csv': {
    id: 'sample_air_ops',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '战机ID', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Action', displayName: '动作 (TakeOff/Landed/Recovered)', type: 'string' },
      { name: 'DepartureHostID', displayName: '起飞机场/母舰', type: 'string' },
      { name: 'ArrivalHostID', displayName: '着陆机场/母舰', type: 'string' },
      { name: 'LandTime', displayName: '着陆时钟', type: 'string' },
      { name: 'ReadyTime', displayName: '再次出动机务准备完毕时标', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '战机ID', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Action', displayName: '动作 (TakeOff/Landed/Recovered)', type: 'string' },
      { name: 'DepartureHostID', displayName: '起飞机场/母舰', type: 'string' },
      { name: 'ArrivalHostID', displayName: '着陆机场/母舰', type: 'string' },
      { name: 'LandTime', displayName: '着陆时钟', type: 'string' },
      { name: 'ReadyTime', displayName: '再次出动机务准备完毕时标', type: 'string' },
    ],
    rows: [
      { Time: '00:05:00', UnitID: 'GJ11_01', UnitSide: 'Blue', Side: 'Blue', Action: 'TakeOff', DepartureHostID: 'BASE_HANGZHOU', ArrivalHostID: '', LandTime: '', ReadyTime: '' },
      { Time: '00:05:30', UnitID: 'GJ11_02', UnitSide: 'Blue', Side: 'Blue', Action: 'TakeOff', DepartureHostID: 'BASE_HANGZHOU', ArrivalHostID: '', LandTime: '', ReadyTime: '' },
      { Time: '00:45:10', UnitID: 'GJ11_01', UnitSide: 'Blue', Side: 'Blue', Action: 'Landed', DepartureHostID: 'BASE_HANGZHOU', ArrivalHostID: 'BASE_HANGZHOU', LandTime: '00:45:10', ReadyTime: '01:05:10' },
      { Time: '00:06:00', UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', Action: 'TakeOff', DepartureHostID: 'CVN78_CARRIER', ArrivalHostID: '', LandTime: '', ReadyTime: '' },
      { Time: '00:50:20', UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', Action: 'Landed', DepartureHostID: 'CVN78_CARRIER', ArrivalHostID: 'CVN78_CARRIER', LandTime: '00:50:20', ReadyTime: '01:18:20' },
    ],
    totalRows: 5,
  },

  // 10. Losses.csv (装备战损价值核算表)
  'Losses.csv': {
    id: 'sample_losses',
    schema: [
      { name: 'Time', displayName: '战损时标', type: 'string' },
      { name: 'UnitID', displayName: '战损装备ID', type: 'string' },
      { name: 'SubjectID', displayName: '战损对象ID', type: 'string' },
      { name: 'SubjectType', displayName: '战损对象类型', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'Num', displayName: '损失台套数', type: 'number' },
      { name: 'Cost_M_USD', displayName: '单套装具重置成本 (百万美元)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '战损时标', type: 'string' },
      { name: 'UnitID', displayName: '战损装备ID', type: 'string' },
      { name: 'SubjectID', displayName: '战损对象ID', type: 'string' },
      { name: 'SubjectType', displayName: '战损对象类型', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'Num', displayName: '损失台套数', type: 'number' },
      { name: 'Cost_M_USD', displayName: '单套装具重置成本 (百万美元)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:24:30', UnitID: 'F35_01', SubjectID: 'F35_01', SubjectType: 'Aircraft', Side: 'Red', Num: 1, Cost_M_USD: 110.0 },
      { Time: '2026-11-18 00:26:10', UnitID: 'F35_02', SubjectID: 'F35_02', SubjectType: 'Aircraft', Side: 'Red', Num: 1, Cost_M_USD: 110.0 },
      { Time: '2026-11-18 00:30:15', UnitID: 'GJ11_02', SubjectID: 'GJ11_02', SubjectType: 'Aircraft', Side: 'Blue', Num: 1, Cost_M_USD: 35.0 },
    ],
    totalRows: 3,
  },

  // 11. ContactPositions.csv (传感器跟踪航迹间隙)
  'ContactPositions.csv': {
    id: 'sample_contact_positions',
    schema: [
      { name: 'Time', displayName: '采样时标', type: 'string' },
      { name: 'ContactID', displayName: '批号', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'TrackGap_s', displayName: '失跟间隙 (s)', type: 'number' },
      { name: 'ContactLongitude', displayName: '估计经度', type: 'number' },
      { name: 'ContactLatitude', displayName: '估计纬度', type: 'number' },
      { name: 'UnitLongitude', displayName: '真机经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '真机纬度', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '采样时标', type: 'string' },
      { name: 'ContactID', displayName: '批号', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'TrackGap_s', displayName: '失跟间隙 (s)', type: 'number' },
      { name: 'ContactLongitude', displayName: '估计经度', type: 'number' },
      { name: 'ContactLatitude', displayName: '估计纬度', type: 'number' },
      { name: 'UnitLongitude', displayName: '真机经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '真机纬度', type: 'number' },
    ],
    rows: [
      { Time: '00:12:00', ContactID: 'CNT_RED_01', Side: 'Blue', TrackGap_s: 1.2, ContactLongitude: 123.801, ContactLatitude: 25.702, UnitLongitude: 123.800, UnitLatitude: 25.700 },
      { Time: '00:15:00', ContactID: 'CNT_RED_01', Side: 'Blue', TrackGap_s: 4.8, ContactLongitude: 123.815, ContactLatitude: 25.710, UnitLongitude: 123.812, UnitLatitude: 25.709 },
      { Time: '00:18:00', ContactID: 'CNT_RED_02', Side: 'Blue', TrackGap_s: 8.5, ContactLongitude: 123.860, ContactLatitude: 25.690, UnitLongitude: 123.850, UnitLatitude: 25.680 },
      { Time: '00:20:00', ContactID: 'CNT_BLUE_01', Side: 'Red', TrackGap_s: 2.1, ContactLongitude: 122.452, ContactLatitude: 25.321, UnitLongitude: 122.450, UnitLatitude: 25.320 },
      { Time: '00:23:00', ContactID: 'CNT_BLUE_01', Side: 'Red', TrackGap_s: 6.4, ContactLongitude: 122.495, ContactLatitude: 25.340, UnitLongitude: 122.490, UnitLatitude: 25.335 },
    ],
    totalRows: 5,
  },

  // 12. EngagementCycle.csv (交战循环与波次)
  'EngagementCycle.csv': {
    id: 'sample_engagement_cycle',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '交战平台', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'CycleAction', displayName: '交战动作 (Engage/Completed/Abort)', type: 'string' },
      { name: 'ContactID', displayName: '目标批号', type: 'string' },
      { name: 'ContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'SalvoID', displayName: '齐射波次号', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '交战平台', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'CycleAction', displayName: '交战动作 (Engage/Completed/Abort)', type: 'string' },
      { name: 'ContactID', displayName: '目标批号', type: 'string' },
      { name: 'ContactActualUnitID', displayName: '目标实际单元ID', type: 'string' },
      { name: 'SalvoID', displayName: '齐射波次号', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:15:30', UnitID: 'GJ11_01', UnitSide: 'Blue', Side: 'Blue', CycleAction: 'Engage', ContactID: 'CNT_RED_01', ContactActualUnitID: 'F35_01', SalvoID: 'WAVE_01' },
      { Time: '2026-11-18 00:18:00', UnitID: 'GJ11_01', UnitSide: 'Blue', Side: 'Blue', CycleAction: 'Completed', ContactID: 'CNT_RED_01', ContactActualUnitID: 'F35_01', SalvoID: 'WAVE_01' },
      { Time: '2026-11-18 00:22:15', UnitID: 'GJ11_02', UnitSide: 'Blue', Side: 'Blue', CycleAction: 'Engage', ContactID: 'CNT_RED_02', ContactActualUnitID: 'F35_02', SalvoID: 'WAVE_02' },
      { Time: '2026-11-18 00:18:25', UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', CycleAction: 'Engage', ContactID: 'CNT_BLUE_01', ContactActualUnitID: 'GJ11_01', SalvoID: 'RED_WAVE_01' },
      { Time: '2026-11-18 00:21:00', UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', CycleAction: 'Completed', ContactID: 'CNT_BLUE_02', ContactActualUnitID: 'GJ11_02', SalvoID: 'RED_WAVE_01' },
    ],
    totalRows: 5,
  },

  // 13. MissionChanged.csv (任务定义与状态流)
  'MissionChanged.csv': {
    id: 'sample_mission_changed',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'MissionName', displayName: '任务名称', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Category', displayName: '任务类别', type: 'string' },
      { name: 'MissionClass', displayName: '任务主类 (MissionClass)', type: 'string' },
      { name: 'SubClass', displayName: '任务子类 (SubClass)', type: 'string' },
      { name: 'OldStatus', displayName: '前序状态', type: 'string' },
      { name: 'NewStatus', displayName: '变更状态', type: 'string' },
      { name: 'OrderIssuedTime', displayName: '下达指令时标', type: 'string' },
      { name: 'StartTime', displayName: '开始时钟', type: 'string' },
      { name: 'EndTime', displayName: '截止时钟', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'MissionName', displayName: '任务名称', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Category', displayName: '任务类别', type: 'string' },
      { name: 'MissionClass', displayName: '任务主类 (MissionClass)', type: 'string' },
      { name: 'SubClass', displayName: '任务子类 (SubClass)', type: 'string' },
      { name: 'OldStatus', displayName: '前序状态', type: 'string' },
      { name: 'NewStatus', displayName: '变更状态', type: 'string' },
      { name: 'OrderIssuedTime', displayName: '下达指令时标', type: 'string' },
      { name: 'StartTime', displayName: '开始时钟', type: 'string' },
      { name: 'EndTime', displayName: '截止时钟', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitSide: 'Blue', Side: 'Blue', Category: 'CombatAirPatrol', MissionClass: 'Patrol', SubClass: 'Air_Patrol', OldStatus: 'Planned', NewStatus: 'Active', OrderIssuedTime: '2026-11-18 00:04:45', StartTime: '2026-11-18 00:05:00', EndTime: '2026-11-18 00:45:00' },
      { Time: '2026-11-18 00:15:00', MissionID: 'MSN_STRIKE_02', MissionName: '纵深突防走廊-B', UnitSide: 'Blue', Side: 'Blue', Category: 'Strike', MissionClass: 'Strike', SubClass: 'Land_Strike', OldStatus: 'Planned', NewStatus: 'Active', OrderIssuedTime: '2026-11-18 00:14:30', StartTime: '2026-11-18 00:15:00', EndTime: '2026-11-18 00:35:00' },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', MissionName: '空中预警支援巡逻-C', UnitSide: 'Blue', Side: 'Blue', Category: 'Support', MissionClass: 'Support', SubClass: 'AEW_Support', OldStatus: 'Planned', NewStatus: 'Active', OrderIssuedTime: '2026-11-18 00:11:30', StartTime: '2026-11-18 00:12:00', EndTime: '2026-11-18 00:40:00' },
      { Time: '2026-11-18 00:06:00', MissionID: 'MSN_RED_SWEEP', MissionName: '攻势制空压制走廊-R', UnitSide: 'Red', Side: 'Red', Category: 'FighterSweep', MissionClass: 'Patrol', SubClass: 'Air_Patrol', OldStatus: 'Planned', NewStatus: 'Active', OrderIssuedTime: '2026-11-18 00:05:40', StartTime: '2026-11-18 00:06:00', EndTime: '2026-11-18 00:40:00' },
    ],
    totalRows: 4,
  },

  // 14. WeaponLost.csv (在飞弹药折损记录)
  'WeaponLost.csv': {
    id: 'sample_weapon_lost',
    schema: [
      { name: 'Time', displayName: '丢失时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'LossReason', displayName: '折损原因 (FuelExhausted/LostLock/GuidanceFailure)', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '丢失时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'LossReason', displayName: '折损原因 (FuelExhausted/LostLock/GuidanceFailure)', type: 'string' },
    ],
    rows: [
      { Time: '00:20:10', WeaponID: 'PL15_004', FiringUnitSide: 'Blue', Side: 'Blue', LossReason: 'FuelExhausted' },
      { Time: '00:23:45', WeaponID: 'PL15_005', FiringUnitSide: 'Blue', Side: 'Blue', LossReason: 'LostLock' },
      { Time: '00:25:30', WeaponID: 'AIM120D_004', FiringUnitSide: 'Red', Side: 'Red', LossReason: 'FuelExhausted' },
      { Time: '00:27:00', WeaponID: 'AIM120D_005', FiringUnitSide: 'Red', Side: 'Red', LossReason: 'GuidanceFailure' },
    ],
    totalRows: 4,
  },

  // 15. WeaponImpact.csv (弹着点与协同到达时差)
  'WeaponImpact.csv': {
    id: 'sample_weapon_impact',
    schema: [
      { name: 'Time', displayName: '命中时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射方', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Distance_m', displayName: '距靶心误差 (m)', type: 'number' },
      { name: 'SalvoID', displayName: '波次号', type: 'string' },
      { name: 'TimeOnTarget', displayName: '条令预定TOT', type: 'string' },
      { name: 'TimeDelta_s', displayName: '协同到达时差 (s)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '命中时标', type: 'string' },
      { name: 'WeaponID', displayName: '武器ID', type: 'string' },
      { name: 'FiringUnitSide', displayName: '发射方', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Distance_m', displayName: '距靶心误差 (m)', type: 'number' },
      { name: 'SalvoID', displayName: '波次号', type: 'string' },
      { name: 'TimeOnTarget', displayName: '条令预定TOT', type: 'string' },
      { name: 'TimeDelta_s', displayName: '协同到达时差 (s)', type: 'number' },
    ],
    rows: [
      { Time: '00:24:30', WeaponID: 'PL15_001', FiringUnitSide: 'Blue', Side: 'Blue', Distance_m: 1.2, SalvoID: 'SALVO_01', TimeOnTarget: '00:24:30', TimeDelta_s: 0.0 },
      { Time: '00:24:33', WeaponID: 'PL15_002', FiringUnitSide: 'Blue', Side: 'Blue', Distance_m: 3.5, SalvoID: 'SALVO_01', TimeOnTarget: '00:24:30', TimeDelta_s: 3.0 },
      { Time: '00:30:15', WeaponID: 'AIM120D_001', FiringUnitSide: 'Red', Side: 'Red', Distance_m: 2.1, SalvoID: 'RED_SALVO_01', TimeOnTarget: '00:30:10', TimeDelta_s: 5.0 },
      { Time: '00:30:22', WeaponID: 'AIM120D_002', FiringUnitSide: 'Red', Side: 'Red', Distance_m: 6.8, SalvoID: 'RED_SALVO_01', TimeOnTarget: '00:30:10', TimeDelta_s: 12.0 },
    ],
    totalRows: 4,
  },

  // 16. UnitJammed.csv (电子战被干扰压制时段)
  'UnitJammed.csv': {
    id: 'sample_unit_jammed',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '受压制单元', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Status', displayName: '状态 (Active/Inactive)', type: 'string' },
      { name: 'IsJammed', displayName: '受扰标记 (1/0)', type: 'number' },
      { name: 'JammedDuration_s', displayName: '连续受压制时长 (s)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '受压制单元', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Status', displayName: '状态 (Active/Inactive)', type: 'string' },
      { name: 'IsJammed', displayName: '受扰标记 (1/0)', type: 'number' },
      { name: 'JammedDuration_s', displayName: '连续受压制时长 (s)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:15:00', UnitID: 'GJ11_02', Side: 'Blue', Status: 'Active', IsJammed: 1, JammedDuration_s: 180 },
      { Time: '2026-11-18 00:25:00', UnitID: 'GJ11_01', Side: 'Blue', Status: 'Inactive', IsJammed: 0, JammedDuration_s: 45 },
      { Time: '2026-11-18 00:18:00', UnitID: 'F35_02', Side: 'Red', Status: 'Active', IsJammed: 1, JammedDuration_s: 320 },
      { Time: '2026-11-18 00:28:00', UnitID: 'F35_01', Side: 'Red', Status: 'Active', IsJammed: 1, JammedDuration_s: 210 },
    ],
    totalRows: 4,
  },

  // 17. CommIsJammedChanged.csv (战术通信压制事件)
  'CommIsJammedChanged.csv': {
    id: 'sample_comm_jammed',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'CommID', displayName: '通信链路ID', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'IsJammed', displayName: '是否受压制 (1/0)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'CommID', displayName: '通信链路ID', type: 'string' },
      { name: 'Side', displayName: '所属阵营', type: 'string' },
      { name: 'IsJammed', displayName: '是否受压制 (1/0)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:10:00', CommID: 'COMM_RED_01', Side: 'Red', IsJammed: 1 },
      { Time: '2026-11-18 00:15:00', CommID: 'COMM_BLUE_01', Side: 'Blue', IsJammed: 0 },
      { Time: '2026-11-18 00:22:00', CommID: 'COMM_RED_01', Side: 'Red', IsJammed: 1 },
      { Time: '2026-11-18 00:30:00', CommID: 'COMM_BLUE_02', Side: 'Blue', IsJammed: 0 },
    ],
    totalRows: 4,
  },

  // 18. GroupUnitRelationChanged.csv (编队协同与间距关系)
  'GroupUnitRelationChanged.csv': {
    id: 'sample_group_relation',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'GroupID', displayName: '编组ID', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'UnitLongitude', displayName: '经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '纬度', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'GroupID', displayName: '编组ID', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'UnitLongitude', displayName: '经度', type: 'number' },
      { name: 'UnitLatitude', displayName: '纬度', type: 'number' },
    ],
    rows: [
      { Time: '00:15:00', GroupID: 'GRP_BLUE_01', UnitID: 'GJ11_01', Side: 'Blue', UnitLongitude: 122.450, UnitLatitude: 25.320 },
      { Time: '00:15:00', GroupID: 'GRP_BLUE_01', UnitID: 'GJ11_02', Side: 'Blue', UnitLongitude: 122.480, UnitLatitude: 25.300 },
      { Time: '00:15:00', GroupID: 'GRP_RED_01', UnitID: 'F35_01', Side: 'Red', UnitLongitude: 123.800, UnitLatitude: 25.700 },
      { Time: '00:15:00', GroupID: 'GRP_RED_01', UnitID: 'F35_02', Side: 'Red', UnitLongitude: 123.850, UnitLatitude: 25.680 },
    ],
    totalRows: 4,
  },

  // 19. DockingOps.csv (母机/母舰停泊与收放)
  'DockingOps.csv': {
    id: 'sample_docking_ops',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Action', displayName: '停泊动作 (Docked/Undocked)', type: 'string' },
      { name: 'DepartureHostID', displayName: '离开母港/舰', type: 'string' },
      { name: 'ArrivalHostID', displayName: '进驻母港/舰', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitSide', displayName: '阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Action', displayName: '停泊动作 (Docked/Undocked)', type: 'string' },
      { name: 'DepartureHostID', displayName: '离开母港/舰', type: 'string' },
      { name: 'ArrivalHostID', displayName: '进驻母港/舰', type: 'string' },
    ],
    rows: [
      { Time: '00:08:00', UnitID: 'USV_SWARM_01', UnitSide: 'Blue', Side: 'Blue', Action: 'Undocked', DepartureHostID: 'MOTHERSHIP_01', ArrivalHostID: '' },
      { Time: '00:48:30', UnitID: 'USV_SWARM_01', UnitSide: 'Blue', Side: 'Blue', Action: 'Docked', DepartureHostID: '', ArrivalHostID: 'MOTHERSHIP_01' },
      { Time: '00:10:00', UnitID: 'UUV_01', UnitSide: 'Red', Side: 'Red', Action: 'Undocked', DepartureHostID: 'SUB_01', ArrivalHostID: '' },
      { Time: '00:52:00', UnitID: 'UUV_01', UnitSide: 'Red', Side: 'Red', Action: 'Docked', DepartureHostID: '', ArrivalHostID: 'SUB_01' },
    ],
    totalRows: 4,
  },

  // 20. FuelConsumed.csv (燃油消耗与剩余量)
  'FuelConsumed.csv': {
    id: 'sample_fuel_consumed',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '战机/舰艇ID', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'FuelType', displayName: '燃料类型', type: 'string' },
      { name: 'FuelQuantity', displayName: '当前余油量 (kg)', type: 'number' },
      { name: 'TotalFuel', displayName: '满油载荷 (kg)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '战机/舰艇ID', type: 'string' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'FuelType', displayName: '燃料类型', type: 'string' },
      { name: 'FuelQuantity', displayName: '当前余油量 (kg)', type: 'number' },
      { name: 'TotalFuel', displayName: '满油载荷 (kg)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:45:00', UnitID: 'GJ11_01', UnitSide: 'Blue', Side: 'Blue', FuelType: 'Aviation', FuelQuantity: 1850, TotalFuel: 5200 },
      { Time: '2026-11-18 00:45:00', UnitID: 'GJ11_02', UnitSide: 'Blue', Side: 'Blue', FuelType: 'Aviation', FuelQuantity: 2100, TotalFuel: 5200 },
      { Time: '2026-11-18 00:48:00', UnitID: 'F35_01', UnitSide: 'Red', Side: 'Red', FuelType: 'Aviation', FuelQuantity: 2800, TotalFuel: 8200 },
      { Time: '2026-11-18 00:48:00', UnitID: 'F35_02', UnitSide: 'Red', Side: 'Red', FuelType: 'Aviation', FuelQuantity: 1950, TotalFuel: 8200 },
    ],
    totalRows: 4,
  },

  // 21. FuelTransfer.csv (空中加油转注量)
  'FuelTransfer.csv': {
    id: 'sample_fuel_transfer',
    schema: [
      { name: 'Time', displayName: '转注时标', type: 'string' },
      { name: 'UnitID', displayName: '加油机ID', type: 'string' },
      { name: 'ReceiverID', displayName: '受油战机ID', type: 'string' },
      { name: 'ReceiverSide', displayName: '受油方阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'FuelQuantity', displayName: '转注燃油量 (kg)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '转注时标', type: 'string' },
      { name: 'UnitID', displayName: '加油机ID', type: 'string' },
      { name: 'ReceiverID', displayName: '受油战机ID', type: 'string' },
      { name: 'ReceiverSide', displayName: '受油方阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'FuelQuantity', displayName: '转注燃油量 (kg)', type: 'number' },
    ],
    rows: [
      { Time: '00:35:00', UnitID: 'TANKER_YY20', ReceiverID: 'GJ11_01', ReceiverSide: 'Blue', Side: 'Blue', FuelQuantity: 2800 },
      { Time: '00:38:30', UnitID: 'TANKER_YY20', ReceiverID: 'GJ11_02', ReceiverSide: 'Blue', Side: 'Blue', FuelQuantity: 3100 },
      { Time: '00:32:00', UnitID: 'KC46_01', ReceiverID: 'F35_01', ReceiverSide: 'Red', Side: 'Red', FuelQuantity: 4200 },
    ],
    totalRows: 3,
  },

  // 22. ComponentStatusChanged.csv (无线电静默与传感器/组件工作状态)
  'ComponentStatusChanged.csv': {
    id: 'sample_component_status',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'ComponentID', displayName: '组件ID', type: 'string' },
      { name: 'ComponentStatus', displayName: '组件状态', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'InSilenceZone', displayName: '是否在静默区 (1/0)', type: 'number' },
      { name: 'SensorIsActive', displayName: '传感器是否主动辐射 (1/0)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'ComponentID', displayName: '组件ID', type: 'string' },
      { name: 'ComponentStatus', displayName: '组件状态', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'InSilenceZone', displayName: '是否在静默区 (1/0)', type: 'number' },
      { name: 'SensorIsActive', displayName: '传感器是否主动辐射 (1/0)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:10:00', UnitID: 'GJ11_01', ComponentID: 'SENS_GJ11_01', ComponentStatus: 'Operational', Side: 'Blue', InSilenceZone: 1, SensorIsActive: 1 },
      { Time: '2026-11-18 00:15:00', UnitID: 'GJ11_02', ComponentID: 'SENS_GJ11_02', ComponentStatus: 'Operational', Side: 'Blue', InSilenceZone: 1, SensorIsActive: 0 },
      { Time: '2026-11-18 00:20:00', UnitID: 'F35_01', ComponentID: 'SENS_F35_01', ComponentStatus: 'Operational', Side: 'Red', InSilenceZone: 1, SensorIsActive: 1 },
      { Time: '2026-11-18 00:25:00', UnitID: 'F35_02', ComponentID: 'SENS_F35_02', ComponentStatus: 'Operational', Side: 'Red', InSilenceZone: 0, SensorIsActive: 1 },
    ],
    totalRows: 4,
  },

  // 23. UnitCreated.csv (作战单元全量编成与基础属性表)
  'UnitCreated.csv': {
    id: 'sample_unit_created',
    schema: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitName', displayName: '单元名称', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'UnitClass', displayName: '平台型号', type: 'string' },
      { name: 'UnitDBID', displayName: '平台DBID', type: 'number' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Cost', displayName: '造价/重置成本', type: 'number' },
      { name: 'Crew', displayName: '编制乘员', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '单元ID', type: 'string' },
      { name: 'UnitName', displayName: '单元名称', type: 'string' },
      { name: 'UnitType', displayName: '单元类型', type: 'string' },
      { name: 'UnitClass', displayName: '平台型号', type: 'string' },
      { name: 'UnitDBID', displayName: '平台DBID', type: 'number' },
      { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
      { name: 'Side', displayName: '阵营', type: 'string' },
      { name: 'Cost', displayName: '造价/重置成本', type: 'number' },
      { name: 'Crew', displayName: '编制乘员', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', UnitType: 'Aircraft', UnitClass: 'GJ-11', UnitDBID: 1001, UnitSide: 'Blue', Side: 'Blue', Cost: 35000000, Crew: 0 },
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', UnitType: 'Aircraft', UnitClass: 'GJ-11', UnitDBID: 1001, UnitSide: 'Blue', Side: 'Blue', Cost: 35000000, Crew: 0 },
      { Time: '2026-11-18 00:00:00', UnitID: 'SAM_BLUE_01', UnitName: '红旗-9防空营', UnitType: 'Facility', UnitClass: 'HQ-9', UnitDBID: 1005, UnitSide: 'Blue', Side: 'Blue', Cost: 45000000, Crew: 12 },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_01', UnitName: 'F-35A长机', UnitType: 'Aircraft', UnitClass: 'F-35A', UnitDBID: 2001, UnitSide: 'Red', Side: 'Red', Cost: 110000000, Crew: 1 },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_02', UnitName: 'F-35A僚机', UnitType: 'Aircraft', UnitClass: 'F-35A', UnitDBID: 2001, UnitSide: 'Red', Side: 'Red', Cost: 110000000, Crew: 1 },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_03', UnitName: 'F-35A三号机', UnitType: 'Aircraft', UnitClass: 'F-35A', UnitDBID: 2001, UnitSide: 'Red', Side: 'Red', Cost: 110000000, Crew: 1 },
      { Time: '2026-11-18 00:18:25', UnitID: 'AIM120D_001', UnitName: 'AIM-120D #1', UnitType: 'Weapon', UnitClass: 'AIM-120D', UnitDBID: 3001, UnitSide: 'Red', Side: 'Red', Cost: 1200000, Crew: 0 },
    ],
    totalRows: 7,
  },

  // 24. MissionUnitRelationChanged.csv (任务-单元分配关系流)
  'MissionUnitRelationChanged.csv': {
    id: 'sample_mission_unit_relation',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'UnitID', displayName: '单元编号', type: 'string' },
      { name: 'Type', displayName: '关系类型 (Assigned/StrikeActiveUnit)', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'UnitID', displayName: '单元编号', type: 'string' },
      { name: 'Type', displayName: '关系类型 (Assigned/StrikeActiveUnit)', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', UnitID: 'GJ11_01', Type: 'Assigned' },
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', UnitID: 'GJ11_02', Type: 'Assigned' },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', UnitID: 'GJ11_01', Type: 'Assigned' },
      { Time: '2026-11-18 00:15:00', MissionID: 'MSN_STRIKE_02', UnitID: 'GJ11_01', Type: 'Assigned' },
      { Time: '2026-11-18 00:15:00', MissionID: 'MSN_STRIKE_02', UnitID: 'F35_01', Type: 'StrikeActiveUnit' },
      { Time: '2026-11-18 00:15:00', MissionID: 'MSN_STRIKE_02', UnitID: 'F35_02', Type: 'StrikeActiveUnit' },
      { Time: '2026-11-18 00:06:00', MissionID: 'MSN_RED_SWEEP', UnitID: 'F35_01', Type: 'Assigned' },
    ],
    totalRows: 7,
  },

  // 25. MissionRefPointRelationChanged.csv (任务巡逻/支援走廊参考点表)
  'MissionRefPointRelationChanged.csv': {
    id: 'sample_mission_ref_point_relation',
    schema: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'Type', displayName: '参考点类型', type: 'string' },
      { name: 'PointIndex', displayName: '顶点序号', type: 'number' },
      { name: 'Longitude', displayName: '经度 (°)', type: 'number' },
      { name: 'Latitude', displayName: '纬度 (°)', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '时标', type: 'string' },
      { name: 'MissionID', displayName: '任务编号', type: 'string' },
      { name: 'Type', displayName: '参考点类型', type: 'string' },
      { name: 'PointIndex', displayName: '顶点序号', type: 'number' },
      { name: 'Longitude', displayName: '经度 (°)', type: 'number' },
      { name: 'Latitude', displayName: '纬度 (°)', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', Type: 'Patrol', PointIndex: 1, Longitude: 121.0, Latitude: 31.0 },
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', Type: 'Patrol', PointIndex: 2, Longitude: 122.5, Latitude: 31.0 },
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', Type: 'Patrol', PointIndex: 3, Longitude: 122.5, Latitude: 32.0 },
      { Time: '2026-11-18 00:05:00', MissionID: 'MSN_CAP_01', Type: 'Patrol', PointIndex: 4, Longitude: 121.0, Latitude: 32.0 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'Support', PointIndex: 1, Longitude: 121.0, Latitude: 31.0 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'Support', PointIndex: 2, Longitude: 122.5, Latitude: 31.0 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'Support', PointIndex: 3, Longitude: 122.5, Latitude: 32.0 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'Support', PointIndex: 4, Longitude: 121.0, Latitude: 32.0 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'NavigationCourse', PointIndex: 1, Longitude: 121.35, Latitude: 31.18 },
      { Time: '2026-11-18 00:12:00', MissionID: 'MSN_SUP_03', Type: 'NavigationCourse', PointIndex: 2, Longitude: 121.95, Latitude: 31.40 },
    ],
    totalRows: 10,
  },

  // 26. ContactCreated.csv (目标接触建立表)
  'ContactCreated.csv': {
    id: 'sample_contact_created',
    schema: [
      { name: 'Time', displayName: '建轨时标', type: 'string' },
      { name: 'ContactID', displayName: '批号', type: 'string' },
      { name: 'ContactName', displayName: '目标名称', type: 'string' },
      { name: 'ActualUnitID', displayName: '实际目标单元ID', type: 'string' },
      { name: 'ActualUnitName', displayName: '实际目标名称', type: 'string' },
      { name: 'Side', displayName: '建轨方阵营', type: 'string' },
      { name: 'ObservingSide', displayName: '观测方阵营', type: 'string' },
    ],
    columns: [
      { name: 'Time', displayName: '建轨时标', type: 'string' },
      { name: 'ContactID', displayName: '批号', type: 'string' },
      { name: 'ContactName', displayName: '目标名称', type: 'string' },
      { name: 'ActualUnitID', displayName: '实际目标单元ID', type: 'string' },
      { name: 'ActualUnitName', displayName: '实际目标名称', type: 'string' },
      { name: 'Side', displayName: '建轨方阵营', type: 'string' },
      { name: 'ObservingSide', displayName: '观测方阵营', type: 'string' },
    ],
    rows: [
      { Time: '2026-11-18 00:05:10', ContactID: 'CNT_RED_01', ContactName: 'F-35A #1', ActualUnitID: 'F35_01', ActualUnitName: 'F-35A长机', Side: 'Blue', ObservingSide: 'Blue' },
      { Time: '2026-11-18 00:06:15', ContactID: 'CNT_RED_02', ContactName: 'F-35A #2', ActualUnitID: 'F35_02', ActualUnitName: 'F-35A僚机', Side: 'Blue', ObservingSide: 'Blue' },
      { Time: '2026-11-18 00:07:30', ContactID: 'CNT_BLUE_01', ContactName: 'GJ-11 #1', ActualUnitID: 'GJ11_01', ActualUnitName: '攻击-11长机', Side: 'Red', ObservingSide: 'Red' },
      { Time: '2026-11-18 00:08:00', ContactID: 'CNT_BLUE_02', ContactName: 'GJ-11 #2', ActualUnitID: 'GJ11_02', ActualUnitName: '攻击-11僚机', Side: 'Red', ObservingSide: 'Red' },
      { Time: '2026-11-18 00:22:30', ContactID: 'CNT_WPN_01', ContactName: 'AIM-120D #1', ActualUnitID: 'AIM120D_001', ActualUnitName: 'AIM-120D来袭弹', Side: 'Blue', ObservingSide: 'Blue' },
    ],
    totalRows: 5,
  },

  // 27. SensorCreated.csv (传感器实例创建表)
  'SensorCreated.csv': {
    id: 'sample_sensor_created',
    schema: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '所属单元ID', type: 'string' },
      { name: 'SensorID', displayName: '传感器ID', type: 'string' },
      { name: 'SensorName', displayName: '传感器名称', type: 'string' },
      { name: 'SensorDBID', displayName: '传感器DBID', type: 'number' },
      { name: 'SensorStatus', displayName: '状态', type: 'string' },
      { name: 'SensorIsActive', displayName: '是否主动开机', type: 'boolean' },
    ],
    columns: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '所属单元ID', type: 'string' },
      { name: 'SensorID', displayName: '传感器ID', type: 'string' },
      { name: 'SensorName', displayName: '传感器名称', type: 'string' },
      { name: 'SensorDBID', displayName: '传感器DBID', type: 'number' },
      { name: 'SensorStatus', displayName: '状态', type: 'string' },
      { name: 'SensorIsActive', displayName: '是否主动开机', type: 'boolean' },
    ],
    rows: [
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_01', SensorID: 'SENS_GJ11_01', SensorName: '有源相控阵雷达', SensorDBID: 5001, SensorStatus: 'Operational', SensorIsActive: true },
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_02', SensorID: 'SENS_GJ11_02', SensorName: '有源相控阵雷达', SensorDBID: 5001, SensorStatus: 'Operational', SensorIsActive: true },
      { Time: '2026-11-18 00:00:00', UnitID: 'SAM_BLUE_01', SensorID: 'SENS_SAM_01', SensorName: '防空相控阵雷达', SensorDBID: 5001, SensorStatus: 'Operational', SensorIsActive: true },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_01', SensorID: 'SENS_F35_01', SensorName: 'AN/APG-81', SensorDBID: 5002, SensorStatus: 'Operational', SensorIsActive: true },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_02', SensorID: 'SENS_F35_02', SensorName: 'AN/APG-81', SensorDBID: 5002, SensorStatus: 'Operational', SensorIsActive: true },
    ],
    totalRows: 5,
  },

  // 28. SensorClassUsed.csv (传感器型号参数字典表)
  'SensorClassUsed.csv': {
    id: 'sample_sensor_class_used',
    schema: [
      { name: 'SensorDBID', displayName: '传感器DBID', type: 'number' },
      { name: 'SensorType', displayName: '传感器类型', type: 'string' },
      { name: 'SensorMaxRange', displayName: '最大探测距离 (nm)', type: 'number' },
      { name: 'SensorHas360Coverage', displayName: '是否全向覆盖', type: 'boolean' },
    ],
    columns: [
      { name: 'SensorDBID', displayName: '传感器DBID', type: 'number' },
      { name: 'SensorType', displayName: '传感器类型', type: 'string' },
      { name: 'SensorMaxRange', displayName: '最大探测距离 (nm)', type: 'number' },
      { name: 'SensorHas360Coverage', displayName: '是否全向覆盖', type: 'boolean' },
    ],
    rows: [
      { SensorDBID: 5001, SensorType: 'Radar', SensorMaxRange: 110.0, SensorHas360Coverage: true },
      { SensorDBID: 5002, SensorType: 'Radar', SensorMaxRange: 95.0, SensorHas360Coverage: false },
    ],
    totalRows: 2,
  },

  // 29. CommCreated.csv (通信网台实例表)
  'CommCreated.csv': {
    id: 'sample_comm_created',
    schema: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '所属单元ID', type: 'string' },
      { name: 'UnitName', displayName: '平台单元名', type: 'string' },
      { name: 'CommID', displayName: '通信网台ID', type: 'string' },
      { name: 'CommName', displayName: '通信网台名称', type: 'string' },
      { name: 'CommDBID', displayName: '通信设备DBID', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '创建时标', type: 'string' },
      { name: 'UnitID', displayName: '所属单元ID', type: 'string' },
      { name: 'UnitName', displayName: '平台单元名', type: 'string' },
      { name: 'CommID', displayName: '通信网台ID', type: 'string' },
      { name: 'CommName', displayName: '通信网台名称', type: 'string' },
      { name: 'CommDBID', displayName: '通信设备DBID', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', CommID: 'COMM_BLUE_01', CommName: '短波协同电台-B1', CommDBID: 6001 },
      { Time: '2026-11-18 00:00:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', CommID: 'COMM_BLUE_02', CommName: '短波协同电台-B2', CommDBID: 6001 },
      { Time: '2026-11-18 00:00:00', UnitID: 'F35_01', UnitName: 'F-35A长机', CommID: 'COMM_RED_01', CommName: 'HF短波通信链-R1', CommDBID: 6002 },
    ],
    totalRows: 3,
  },

  // 30. CommClassUsed.csv (通信型号参数字典表)
  'CommClassUsed.csv': {
    id: 'sample_comm_class_used',
    schema: [
      { name: 'CommDBID', displayName: '通信设备DBID', type: 'number' },
      { name: 'CommName', displayName: '型号名称', type: 'string' },
      { name: 'HF_Radio', displayName: '是否短波电台', type: 'boolean' },
    ],
    columns: [
      { name: 'CommDBID', displayName: '通信设备DBID', type: 'number' },
      { name: 'CommName', displayName: '型号名称', type: 'string' },
      { name: 'HF_Radio', displayName: '是否短波电台', type: 'boolean' },
    ],
    rows: [
      { CommDBID: 6001, CommName: 'HF协同电台', HF_Radio: true },
      { CommDBID: 6002, CommName: 'HF短波通信链', HF_Radio: true },
    ],
    totalRows: 2,
  },

  // 31. SideCreated.csv (参演阵营配置表)
  'SideCreated.csv': {
    id: 'sample_side_created',
    schema: [
      { name: 'SideID', displayName: '阵营ID', type: 'string' },
      { name: 'SideName', displayName: '阵营名称', type: 'string' },
    ],
    columns: [
      { name: 'SideID', displayName: '阵营ID', type: 'string' },
      { name: 'SideName', displayName: '阵营名称', type: 'string' },
    ],
    rows: [
      { SideID: '1', SideName: 'Blue' },
      { SideID: '2', SideName: 'Red' },
    ],
    totalRows: 2,
  },

  // 32. Tick.csv (仿真推进时间切片表)
  'Tick.csv': {
    id: 'sample_tick',
    schema: [
      { name: 'Time', displayName: '推演时标', type: 'string' },
      { name: 'Tick', displayName: '帧序号', type: 'number' },
    ],
    columns: [
      { name: 'Time', displayName: '推演时标', type: 'string' },
      { name: 'Tick', displayName: '帧序号', type: 'number' },
    ],
    rows: [
      { Time: '2026-11-18 00:00:00', Tick: 1 },
      { Time: '2026-11-18 00:15:00', Tick: 180 },
      { Time: '2026-11-18 00:35:00', Tick: 420 },
      { Time: '2026-11-18 00:45:00', Tick: 540 },
    ],
    totalRows: 4,
  },
};

/**
 * 根据 CSV 表名智能获取对应的标准领域样本数据集
 */
export function getSampleDatasetForTable(tableName: string): TableDataset | null {
  const cleanName = tableName.trim().replace(/^.*[\\\/]/, '');
  const keyWithCsv = cleanName.endsWith('.csv') ? cleanName : `${cleanName}.csv`;
  return TABLE_SAMPLE_DATASETS[keyWithCsv] || null;
}
