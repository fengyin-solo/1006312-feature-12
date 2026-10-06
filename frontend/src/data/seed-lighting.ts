import type { CodeKind, LampRow, LampStatus, LampType } from './lighting-domain'
import { LAMP_POWER } from './lighting-domain'

// 灯具种子的紧凑描述：成段铺出一个舱室的灯具，坏灯刻意集中在综合舱（一次巡检坏十几盏）。
type LampSpec = {
  code: string
  kind?: CodeKind
  type: LampType
  pos: string
  status: LampStatus
  cabin?: string
  unit?: string
  patrol?: string
  commission?: string
  inspector?: string
  remark?: string
}

const CABINS = ['综合舱', '电力舱', '燃气舱', '水信舱'] as const

function lamp(
  id: number,
  cabin: string,
  spec: LampSpec,
): LampRow {
  const status = spec.status
  return {
    id,
    status,
    pending: status !== '已更换' && status !== '照明正常',
    abnormal: status === '已损坏',
    灯具编号: spec.code,
    编号方式: spec.kind ?? '正式编号',
    所属舱室: cabin,
    灯具类型: spec.type,
    安装位置: spec.pos,
    额定功率: LAMP_POWER[spec.type],
    巡检日期: spec.patrol ?? '2026-10-05',
    投运日期: spec.commission ?? '2021-06-30',
    巡检人员: spec.inspector ?? '王巡检',
    权属单位: spec.unit ?? '管廊运维中心',
    结论: status === '已更换' ? '更换完成' : '',
    结论批次号: '',
    结论时间: '',
    备注: spec.remark ?? '',
  }
}

function section(
  offset: number,
  cabinIndex: number,
  specs: LampSpec[],
): LampRow[] {
  const cabin = CABINS[cabinIndex]
  return specs.map((spec, index) => lamp(offset + index, cabin, spec))
}

// 综合舱：本次巡检一次坏 12 盏（本单位），另有核对拦截样例与已更换样例。
const ZH: LampSpec[] = [
  { code: 'LIGH-ZH-LED-001', type: 'LED平板灯', pos: '顶部-A-001', status: '已损坏' },
  { code: 'LIGH-ZH-LED-002', type: 'LED平板灯', pos: '顶部-A-002', status: '已损坏' },
  { code: 'LIGH-ZH-LED-003', type: 'LED平板灯', pos: '顶部-B-001', status: '已损坏' },
  { code: 'LIGH-ZH-LED-004', type: 'LED平板灯', pos: '顶部-B-002', status: '已损坏' },
  { code: 'LIGH-ZH-LED-005', type: 'LED平板灯', pos: '顶部-C-001', status: '已损坏' },
  { code: 'LIGH-ZH-LED-006', type: 'LED平板灯', pos: '顶部-C-002', status: '已损坏' },
  { code: 'LIGH-ZH-EMG-001', type: '应急照明灯', pos: '出口上方-E1', status: '已损坏' },
  { code: 'LIGH-ZH-EMG-002', type: '应急照明灯', pos: '应急区-Y1', status: '已损坏' },
  { code: 'LIGH-ZH-EMG-003', type: '应急照明灯', pos: '出口上方-E2', status: '已损坏' },
  { code: 'LIGH-ZH-SIG-001', type: '疏散指示灯', pos: '地面-S1', status: '已损坏' },
  { code: 'LIGH-ZH-SIG-002', type: '疏散指示灯', pos: '踢脚-S2', status: '已损坏' },
  { code: 'LIGH-ZH-LED-007', type: 'LED平板灯', pos: '顶部-A-003', status: '已损坏' },
  { code: 'LIGH-ZH-LED-010', type: 'LED平板灯', pos: '顶部-D-001', status: '照明正常', patrol: '2026-10-02' },
  { code: 'LIGH-ZH-EMG-010', type: '应急照明灯', pos: '出口上方-E3', status: '照明正常', patrol: '2026-10-02' },
  { code: 'LIGH-ZH-SIG-010', type: '疏散指示灯', pos: '地面-S3', status: '待巡检', patrol: '' },
  { code: 'LIGH-ZH-LED-011', type: 'LED平板灯', pos: '顶部-D-002', status: '巡检中' },
  // 核对拦截：平板灯挂在左墙，灯具类型与安装位置对不上
  { code: 'LIGH-ZH-LED-008', type: 'LED平板灯', pos: '左墙-W1', status: '已损坏', remark: '现场登记存疑' },
  // 核对拦截：与 LIGH-ZH-LED-001 重号
  { code: 'LIGH-ZH-LED-001', type: '应急照明灯', pos: '应急区-Y2', status: '已损坏' },
  // 跨单位只读：外单位资产，本单位只能看不能办
  { code: 'LIGH-ZH-EXT-001', type: 'LED平板灯', pos: '顶部-E-001', status: '已损坏', unit: '外协单位·华东照明' },
  // 已完成更换：再次上报即触发「重复上报只认第一次」
  { code: 'LIGH-ZH-LED-009', type: 'LED平板灯', pos: '顶部-F-001', status: '已更换', patrol: '2026-09-28', inspector: '李巡检', remark: '历史更换记录' },
]

// 电力舱：5 盏坏灯，另含一处类型-位置不符。
const DL: LampSpec[] = [
  { code: 'LIGH-DL-LED-001', type: 'LED平板灯', pos: '顶部-A-001', status: '已损坏' },
  { code: 'LIGH-DL-LED-002', type: 'LED平板灯', pos: '顶部-A-002', status: '已损坏' },
  { code: 'LIGH-DL-LED-003', type: 'LED平板灯', pos: '顶部-B-001', status: '已损坏' },
  { code: 'LIGH-DL-EMG-001', type: '应急照明灯', pos: '出口上方-E1', status: '已损坏' },
  { code: 'LIGH-DL-EMG-002', type: '应急照明灯', pos: '应急区-Y1', status: '已损坏' },
  { code: 'LIGH-DL-LED-010', type: 'LED平板灯', pos: '顶部-C-001', status: '照明正常' },
  { code: 'LIGH-DL-SIG-010', type: '疏散指示灯', pos: '地面-S1', status: '照明正常' },
  // 核对拦截：应急灯装顶部，位置与类型不符
  { code: 'LIGH-DL-EMG-009', type: '应急照明灯', pos: '顶部-X-001', status: '已损坏' },
]

// 燃气舱：防爆灯壁挂，库存够用；另含一盏坏的疏散灯。
const RQ: LampSpec[] = [
  { code: 'LIGH-RQ-EXP-001', type: 'LED防爆灯', pos: '左墙-W1', status: '已损坏' },
  { code: 'LIGH-RQ-EXP-002', type: 'LED防爆灯', pos: '左墙-W2', status: '已损坏' },
  { code: 'LIGH-RQ-EXP-003', type: 'LED防爆灯', pos: '左墙-W3', status: '已损坏' },
  { code: 'LIGH-RQ-EXP-004', type: 'LED防爆灯', pos: '右墙-W4', status: '已损坏' },
  { code: 'LIGH-RQ-EXP-010', type: 'LED防爆灯', pos: '右墙-W5', status: '照明正常' },
  { code: 'LIGH-RQ-EXP-011', type: 'LED防爆灯', pos: '左墙-W6', status: '待巡检' },
  { code: 'LIGH-RQ-SIG-001', type: '疏散指示灯', pos: '地面-S1', status: '已损坏' },
]

// 水信舱：3 盏坏灯、1 处类型不符，另有 2 盏早年无编号灯具（只留了安装位置）。
const SX: LampSpec[] = [
  { code: 'LIGH-SX-LED-001', type: 'LED平板灯', pos: '顶部-A-001', status: '已损坏' },
  { code: 'LIGH-SX-EMG-001', type: '应急照明灯', pos: '出口上方-E1', status: '已损坏' },
  { code: 'LIGH-SX-SIG-001', type: '疏散指示灯', pos: '地面-S1', status: '已损坏' },
  { code: 'LIGH-SX-LED-010', type: 'LED平板灯', pos: '顶部-B-001', status: '照明正常' },
  // 核对拦截：防爆灯不应出现在水信舱
  { code: 'LIGH-SX-EXP-009', type: 'LED防爆灯', pos: '左墙-W1', status: '已损坏' },
  {
    code: '',
    kind: '待补编号',
    type: 'LED平板灯',
    pos: '顶部-K1',
    status: '待巡检',
    patrol: '',
    commission: '2018-05-20',
    inspector: '',
    remark: '早年安装，仅登记安装位置',
  },
  {
    code: '',
    kind: '待补编号',
    type: 'LED平板灯',
    pos: '顶部-K2',
    status: '待巡检',
    patrol: '',
    commission: '',
    inspector: '',
    remark: '早年安装，台账信息缺失',
  },
]

/** 廊内照明灯具种子：共 4 个舱室 41 盏 */
export function buildLightingSeed(): LampRow[] {
  const zh = section(1, 0, ZH)
  const dl = section(zh.length + 1, 1, DL)
  const rq = section(zh.length + dl.length + 1, 2, RQ)
  const sx = section(zh.length + dl.length + rq.length + 1, 3, SX)
  return [...zh, ...dl, ...rq, ...sx]
}
