/**
 * 廊内照明运维专属领域模型。
 *
 * 灯具本身仍以 EntryRow 的形式存放在通用 entries 存储的 lighting 分区里（概览条数与其它模块同源），
 * 批次、回执、维保台账、待补清单、重复上报留档等整组处理产物放在 lighting 侧车存储里。
 */

export type LampType = 'LED平板灯' | 'LED防爆灯' | '应急照明灯' | '疏散指示灯'

export type LampStatus = '待巡检' | '巡检中' | '照明正常' | '已损坏' | '已更换'

/** 灯具编号的来源：正式编号 / 早年无号按规则补号 / 尚未补号 */
export type CodeKind = '正式编号' | '规则补号' | '待补编号'

export interface LampRow {
  id: number
  status: LampStatus
  pending: boolean
  abnormal: boolean
  灯具编号: string
  编号方式: CodeKind
  所属舱室: string
  灯具类型: LampType
  安装位置: string
  额定功率: string
  巡检日期: string
  /** 历史数据按设备投运日期回填、排序、补号 */
  投运日期: string
  巡检人员: string
  /** 资产权属单位：跨单位只能看，不能办 */
  权属单位: string
  /** 对外结论：只认第一次办成的内容（损坏 / 更换完成） */
  结论: string
  结论批次号: string
  结论时间: string
  备注: string
  [field: string]: string | number | boolean
}

export type IssueKind = '编号重号' | '类型位置不符' | '跨单位只读' | '舱室混批' | '批内重复'

export interface BatchIssue {
  rowId: number
  灯具编号: string
  安装位置: string
  问题类型: IssueKind
  说明: string
}

export interface LampReceipt {
  rowId: number
  灯具编号: string
  灯具类型: string
  安装位置: string
  结论: '更换完成' | '办理失败'
  原因: string
  回执号: string
  检修待办编号: string
  时间: string
}

export interface BatchRecord {
  批次号: string
  舱室: string
  提交单位: string
  提交岗位: string
  提交人: string
  提交时间: string
  巡检日期: string
  去重前台数: number
  去重后台数: number
  /** 同一盏灯在同一批里重复出现：只算一次，这里留痕 */
  批内重复: { 灯具编号: string; 安装位置: string; 说明: string }[]
  /** 核对拦截：编号重号 / 类型与位置不符 / 跨单位只读 / 舱室混批 */
  拦截问题: BatchIssue[]
  回执: LampReceipt[]
  成功数: number
  失败数: number
  /** 整批被拒（例如全是外单位灯具）时为 true，记录仍按原提交岗位留档 */
  已拒绝: boolean
}

export interface LedgerEntry {
  台账号: string
  灯具编号: string
  所属舱室: string
  灯具类型: string
  安装位置: string
  巡检日期: string
  处理结论: string
  处理时间: string
  批次号: string
  责任单位: string
  责任岗位: string
  回执号: string
  检修待办编号: string
  备注: string
  /** true＝对外呈现的首次结论；false＝重复上报的另一份，留档备查 */
  对外版本: boolean
}

export interface SupplementItem {
  id: string
  灯具行号: number
  灯具编号: string
  所属舱室: string
  安装位置: string
  缺失项: string[]
  发现方式: string
  状态: '待补录'
}

export interface DuplicateArchive {
  id: string
  灯具编号: string
  首次批次: string
  首次结论: string
  首次时间: string
  后续批次: string
  后续内容: string
  差异: string
  提交单位: string
  提交岗位: string
  提交人: string
  时间: string
}

export interface AuditEntry {
  时间: string
  单位: string
  岗位: string
  人员: string
  动作: string
  结果: string
  详情: string
}

export interface LightingSidecar {
  ledger: LedgerEntry[]
  batches: BatchRecord[]
  supplements: SupplementItem[]
  duplicates: DuplicateArchive[]
  audit: AuditEntry[]
  stock: Record<string, number>
  seq: number
  inited: boolean
}

/* ----------------------------- 领域常量与规则 ----------------------------- */

export const LAMP_TYPES: LampType[] = ['LED平板灯', 'LED防爆灯', '应急照明灯', '疏散指示灯']

export const LAMP_POWER: Record<LampType, string> = {
  LED平板灯: '36W',
  LED防爆灯: '40W',
  应急照明灯: '12W',
  疏散指示灯: '6W',
}

/** 舱室简称 → 舱室码（补号用） */
export const CABIN_CODES: Array<{ name: string; code: string }> = [
  { name: '综合舱', code: 'ZH' },
  { name: '电力舱', code: 'DL' },
  { name: '燃气舱', code: 'RQ' },
  { name: '水信舱', code: 'SX' },
]

/** 安装位置「部位」→ 码位（编号里只留 ASCII） */
export const PART_CODES: Record<string, string> = {
  顶部: 'D',
  左墙: 'L',
  右墙: 'R',
  地面: 'P',
  踢脚: 'J',
  出口上方: 'C',
  应急区: 'Y',
}

/**
 * 灯具类型与安装位置核对规则（落库前先按这张表核对）：
 * - LED平板灯：只装在顶部（平板灯嵌顶安装）
 * - LED防爆灯：只装在燃气舱的左墙/右墙（防爆灯具随燃气舱配置，靠墙壁挂）
 * - 应急照明灯：装在出口上方、应急区等应急点位
 * - 疏散指示灯：低位安装，在地面或踢脚处
 */
export function typePositionIssue(
  type: string,
  cabin: string,
  position: string,
): string | null {
  if (type === 'LED平板灯' && !position.includes('顶部')) {
    return 'LED平板灯应为嵌顶安装，安装位置必须在「顶部」，实际位置不匹配'
  }
  if (type === 'LED防爆灯') {
    if (!cabin.includes('燃气')) {
      return 'LED防爆灯只配置在燃气舱，所属舱室与灯具类型不匹配'
    }
    if (!position.includes('左墙') && !position.includes('右墙')) {
      return 'LED防爆灯应为壁挂安装，安装位置必须在「左墙/右墙」，实际位置不匹配'
    }
  }
  if (type === '应急照明灯' && !position.includes('出口') && !position.includes('应急')) {
    return '应急照明灯应装在出口上方或应急区，安装位置与灯具类型不匹配'
  }
  if (type === '疏散指示灯' && !position.includes('地面') && !position.includes('踢脚')) {
    return '疏散指示灯应低位安装在地面或踢脚处，安装位置与灯具类型不匹配'
  }
  return null
}

export function cabinCode(cabin: string): string {
  const hit = CABIN_CODES.find((item) => cabin.includes(item.name))
  return hit ? hit.code : 'QT'
}

/** 安装位置「顶部-A-001」→ 位置码「DA001」，用于正式编号后缀 */
export function positionCode(position: string): string {
  const head = Object.keys(PART_CODES).find((part) => position.startsWith(part))
  const tail = position.replace(/[^\w]+/g, '').replace(/[一-鿿]/g, '')
  return `${head ? PART_CODES[head] : 'X'}${tail}`
}

/**
 * 早年无号灯具的补号规则（由系统决定并公示）：
 *   LIGH-{舱室码}-P{投运年末2位}{月2位}{3位流水}
 * - 全舱室内按投运日期从早到晚排序，同投运日按安装位置从左到右、从下到上排；
 * - 投运日期缺失的排在末尾，年月段记 0000；
 * - 补号灯具一律标「规则补号」并进待补清单，现场核实后可换正式编号。
 */
export function backfillCode(cabin: string, commissionDate: string, seq: number): string {
  const ym = commissionDate && /^\d{4}-\d{2}/.test(commissionDate)
    ? commissionDate.slice(2, 4) + commissionDate.slice(5, 7)
    : '0000'
  return `LIGH-${cabinCode(cabin)}-P${ym}${String(seq).padStart(3, '0')}`
}

export const OWNER_UNITS = ['管廊运维中心', '外协单位·华东照明'] as const

export const POSTS_BY_UNIT: Record<string, string[]> = {
  管廊运维中心: ['巡检一班', '巡检二班', '检修班'],
  '外协单位·华东照明': ['外单位巡检'],
}

/** 备件初始库存：刻意让部分型号少于单批损坏量，以产生「未办成」回执 */
export const INITIAL_STOCK: Record<LampType, number> = {
  LED平板灯: 4,
  LED防爆灯: 4,
  应急照明灯: 2,
  疏散指示灯: 1,
}
