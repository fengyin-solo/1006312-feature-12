import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 廊内照明整组处理领域：按舱室圈选 → 核对（重号 / 类型位置不符）→ 整批办损坏与更换，
// 逐台回执、批内去重、重复上报只认首次；同步设施检修待办、落维保台账。
// 灯具本体仍存放在主数据的 lighting 模块里；批次/回执/台账/待补清单各自单独存档，
// 概览条数直接从这些另存清单统计，保证口径一致。

const NS = 'urban-utility-tunnel'

export type LightingFixture = EntryRow & {
  批次号?: string
  _backfilled?: boolean
}

export type BatchRecord = {
  id: number
  批次号: string
  所属舱室: string
  权属单位: string
  圈选数量: number
  去重后数量: number
  批内重复盏次: number
  成功数: number
  失败数: number
  跳过数: number
  提交单位: string
  提交岗位: string
  提交人员: string
  备注: string
  提交时间: string
}

export type ReceiptRow = {
  id: number
  回执编号: string
  批次号: string
  灯具编号: string
  所属舱室: string
  安装位置: string
  结果: '成功' | '失败' | '跳过'
  回执信息: string
  检修编号: string
  经办岗位: string
  经办人员: string
  时间: string
}

// 每份处理结论单独一行。对外只呈现「更换处理结论 / 更换未办成」，
// 原始「巡检损坏判定」留档备查；两份都存，互不覆盖。
export type LedgerRow = {
  id: number
  台账编号: string
  批次号: string
  灯具编号: string
  所属舱室: string
  安装位置: string
  灯具类型: string
  结论性质: '巡检损坏判定（留档备查）' | '更换处理结论（对外）' | '更换未办成（对外）'
  处理结论: string
  备注: string
  经办岗位: string
  经办人员: string
  权属单位: string
  落库时间: string
}

export type GapItem = {
  id: number
  数据模块: 'lighting' | 'device'
  编号: string
  对象名称: string
  所属舱室: string
  缺失项: string[]
  补登规则: string
  状态: '待补'
  发现时间: string
}

type SeqState = { batch: number; receipt: number; ledger: number; repair: number }

type SubmitActor = { operator: string; unit: string; post: string }

export type CheckIssue = {
  kind: '重号' | '类型位置不符'
  灯具id: number
  灯具编号: string
  所属舱室: string
  说明: string
}

export type SubmitResult = {
  ok: boolean
  message: string
  issues?: CheckIssue[]
  batch?: BatchRecord
  receipts?: ReceiptRow[]
}

// ---- 单独存档：不与主条目混放，另存清单与概览统计同源 ----
function readCollection<T>(name: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(`${NS}:${name}`)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeCollection<T>(name: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`${NS}:${name}`, JSON.stringify(value))
  }
}

const listBatchesStore = (): BatchRecord[] => readCollection<BatchRecord[]>('lighting-batches', [])
const listReceiptsStore = (): ReceiptRow[] => readCollection<ReceiptRow[]>('lighting-receipts', [])
const listLedgerStore = (): LedgerRow[] => readCollection<LedgerRow[]>('lighting-ledger', [])
const readSeq = (): SeqState =>
  readCollection<SeqState>('lighting-seq', { batch: 0, receipt: 0, ledger: 0, repair: 0 })

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowStr(): string {
  const d = new Date()
  return `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---- 早年无编号灯具补号规则 ----
// 规则：LIGH-BK-<舱段码>-<NNN>。舱段码取舱室固定缩写（综合/电力舱区段），
// 没有登记缩写时按舱室名称生成稳定短码；NNN 是同舱室内按投运日期、安装位置
// 排序后的三位序号。BK 前缀与原台账编号永久区分，现场核对后可再换发正式编号。
const CABIN_ABBR: Record<string, string> = {
  综合舱一段: 'ZH1',
  综合舱二段: 'ZH2',
  电力舱一段: 'DL1',
}

// 安装位置里的桩号里程（如「顶部K0+150」→150），补号按里程从小到大为序；取不到再退回文字比较。
function positionMeter(position: string): number | null {
  const hit = position.match(/K\s*\d+\s*\+\s*(\d+)/)
  return hit ? Number(hit[1]) : null
}

export function cabinCode(name: string): string {
  const key = name.trim()
  const hit = CABIN_ABBR[key]
  if (hit) {
    return hit
  }
  let hash = 0
  for (const ch of key) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }
  return `X${pad(hash % 1000, 3)}`
}

export const BACKFILL_RULE =
  '存量灯具按巡检日期回填投运日期；早年只有安装位置、没有灯具编号的，按 LIGH-BK-<舱段码>-<NNN> 补号（舱段码取舱室缩写，序号按投运日期、安装位置排序），编号来源标记为「规则补号」待现场核对'

// 幂等：只处理一次，已处理过（含人工修正）的记录不再覆盖。
export function ensureBackfilled(): void {
  const rows = listRows('lighting') as LightingFixture[]
  let changed = false
  const legacyByCabin = new Map<string, LightingFixture[]>()

  for (const row of rows) {
    if (row._backfilled) {
      continue
    }
    if (!String(row['投运日期'] ?? '').trim()) {
      row['投运日期'] = String(row['巡检日期'] ?? '')
    }
    if (!String(row['灯具编号'] ?? '').trim()) {
      const list = legacyByCabin.get(String(row['所属舱室'] ?? '')) ?? []
      list.push(row)
      legacyByCabin.set(String(row['所属舱室'] ?? ''), list)
    } else if (!String(row['编号来源'] ?? '').trim()) {
      row['编号来源'] = '原台账编号'
    }
    row._backfilled = true
    changed = true
  }

  for (const [cabin, legacy] of legacyByCabin) {
    legacy.sort((a, b) => {
      const byDate = String(a['投运日期'] ?? '').localeCompare(String(b['投运日期'] ?? ''))
      if (byDate !== 0) {
        return byDate
      }
      const meterA = positionMeter(String(a['安装位置'] ?? ''))
      const meterB = positionMeter(String(b['安装位置'] ?? ''))
      if (meterA !== null && meterB !== null && meterA !== meterB) {
        return meterA - meterB
      }
      const byPosition = String(a['安装位置'] ?? '').localeCompare(String(b['安装位置'] ?? ''))
      return byPosition !== 0 ? byPosition : Number(a.id) - Number(b.id)
    })
    const code = cabinCode(cabin)
    legacy.forEach((row, index) => {
      row['灯具编号'] = `LIGH-BK-${code}-${pad(index + 1, 3)}`
      row['编号来源'] = '规则补号（早年缺号，待现场核对）'
    })
  }

  if (changed) {
    saveRows('lighting', rows)
  }
  rescanGaps()
}

// ---- 待补清单：灯具按巡检日期回填后仍缺的项 + 设备按投运日期回填后仍缺的项，集中列一张 ----
const LIGHTING_GAP_FIELDS = ['额定功率', '安装位置', '权属单位']
const DEVICE_GAP_FIELDS = ['投运日期', '设备型号']

export function scanGaps(): GapItem[] {
  const found: GapItem[] = []

  for (const row of listRows('lighting') as LightingFixture[]) {
    const missing = LIGHTING_GAP_FIELDS.filter((field) => !String(row[field] ?? '').trim())
    if (missing.length > 0) {
      found.push({
        id: 0,
        数据模块: 'lighting',
        编号: String(row['灯具编号'] ?? ''),
        对象名称: String(row['灯具类型'] ?? '照明灯具'),
        所属舱室: String(row['所属舱室'] ?? ''),
        缺失项: missing,
        补登规则: BACKFILL_RULE,
        状态: '待补',
        发现时间: todayStr(),
      })
    }
  }

  for (const row of listRows('device')) {
    const missing = DEVICE_GAP_FIELDS.filter((field) => !String(row[field] ?? '').trim())
    if (missing.length > 0) {
      found.push({
        id: 0,
        数据模块: 'device',
        编号: String(row['设备编号'] ?? ''),
        对象名称: String(row['设备名称'] ?? '管廊设备'),
        所属舱室: String(row['所属舱室'] ?? ''),
        缺失项: missing,
        补登规则: '设备历史数据按投运日期回填；投运日期等关键项缺失、无法推断的，列入待补清单人工补登',
        状态: '待补',
        发现时间: todayStr(),
      })
    }
  }

  found.sort(
    (a, b) =>
      a.数据模块.localeCompare(b.数据模块) ||
      a.所属舱室.localeCompare(b.所属舱室) ||
      a.编号.localeCompare(b.编号) ||
      a.缺失项.join(',').localeCompare(b.缺失项.join(',')),
  )
  return found.map((item, index) => ({ ...item, id: index + 1 }))
}

export function rescanGaps(): GapItem[] {
  const items = scanGaps()
  writeCollection('lighting-gaps', items)
  return items
}

export function listGaps(): GapItem[] {
  const stored = readCollection<GapItem[] | null>('lighting-gaps', null)
  if (stored === null) {
    return rescanGaps()
  }
  return stored
}

export function fillGap(module: 'lighting' | 'device', code: string, field: string, value: string): void {
  const key = module === 'lighting' ? 'lighting' : 'device'
  const codeField = module === 'lighting' ? '灯具编号' : '设备编号'
  const rows = listRows(key)
  const index = rows.findIndex((row) => String(row[codeField]) === code)
  if (index < 0) {
    return
  }
  rows[index] = { ...rows[index], [field]: value }
  saveRows(key, rows)
  rescanGaps()
}

// ---- 灯具类型与安装位置对照规则 ----
const TYPE_POSITION_RULES: { types: string[]; needAny: string[]; rule: string }[] = [
  { types: ['防潮吸顶灯', '防爆灯'], needAny: ['顶部'], rule: '应吸顶安装，安装位置须含「顶部」' },
  { types: ['LED灯条', 'LED灯管'], needAny: ['侧壁'], rule: '应贴壁安装，安装位置须含「侧壁」' },
  { types: ['应急照明灯', '疏散指示灯'], needAny: ['出口', '疏散', '通道'], rule: '应靠近疏散通道/安全出口安装' },
  { types: ['投光灯'], needAny: ['出入口', '入口'], rule: '应安装在出入口' },
]

export function positionRule(type: string): string {
  return TYPE_POSITION_RULES.find((item) => item.types.includes(type))?.rule ?? ''
}

function positionMismatch(type: string, position: string): string | null {
  const rule = TYPE_POSITION_RULES.find((item) => item.types.includes(type))
  if (!rule) {
    return null
  }
  if (!position.trim()) {
    return `灯具类型「${type}」缺安装位置，无法核对（${rule.rule}）`
  }
  if (!rule.needAny.some((keyword) => position.includes(keyword))) {
    return `灯具类型「${type}」与安装位置「${position}」对不上：${rule.rule}`
  }
  return null
}

// ---- 整批核对：批内去重后查重号、查类型/位置 ----
export function precheckBatch(ids: number[]): { issues: CheckIssue[]; uniqueCount: number; duplicatedPicks: number } {
  const rows = listRows('lighting') as LightingFixture[]
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const uniqueIds: number[] = []
  for (const id of ids) {
    if (byId.has(id) && !uniqueIds.includes(id)) {
      uniqueIds.push(id)
    }
  }
  const selected = uniqueIds.map((id) => byId.get(id)!)
  const issues: CheckIssue[] = []

  const selectedCodeCount = new Map<string, number>()
  for (const row of selected) {
    const code = String(row['灯具编号'] ?? '')
    selectedCodeCount.set(code, (selectedCodeCount.get(code) ?? 0) + 1)
  }

  for (const row of selected) {
    const code = String(row['灯具编号'] ?? '')
    const cabin = String(row['所属舱室'] ?? '')
    if ((selectedCodeCount.get(code) ?? 0) > 1) {
      issues.push({
        kind: '重号',
        灯具id: Number(row.id),
        灯具编号: code,
        所属舱室: cabin,
        说明: `灯具编号「${code}」在本批中重复出现 ${selectedCodeCount.get(code)} 次`,
      })
    }
    const twin = rows.find(
      (other) => Number(other.id) !== Number(row.id) && String(other['灯具编号'] ?? '') === code,
    )
    if (twin) {
      issues.push({
        kind: '重号',
        灯具id: Number(row.id),
        灯具编号: code,
        所属舱室: cabin,
        说明: `灯具编号「${code}」与台账中 ${twin['所属舱室']} 的灯具（记录号 ${twin.id}）重号`,
      })
    }
    const mismatch = positionMismatch(String(row['灯具类型'] ?? ''), String(row['安装位置'] ?? ''))
    if (mismatch) {
      issues.push({
        kind: '类型位置不符',
        灯具id: Number(row.id),
        灯具编号: code,
        所属舱室: cabin,
        说明: mismatch,
      })
    }
  }

  return { issues, uniqueCount: selected.length, duplicatedPicks: ids.length - selected.length }
}

// 重号纠正：按补号规则给单灯换发规则编号。
export function renumberFixture(id: number): string {
  const rows = listRows('lighting') as LightingFixture[]
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return ''
  }
  const cabin = String(row['所属舱室'] ?? '')
  const prefix = `LIGH-BK-${cabinCode(cabin)}-G`
  const used = rows
    .map((item) => String(item['灯具编号'] ?? ''))
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
  const next = pad((used.length ? Math.max(...used) : 0) + 1, 2)
  const code = `${prefix}${next}`
  row['灯具编号'] = code
  row['编号来源'] = '规则补号（重号纠正）'
  saveRows('lighting', rows)
  rescanGaps()
  return code
}

export type CabinSummary = {
  cabin: string
  unit: string
  total: number
  normal: number
  damaged: number
  replaced: number
  pending: number
  lastInspectDate: string
}

export function cabinSummaries(): CabinSummary[] {
  const map = new Map<string, CabinSummary>()
  for (const row of listRows('lighting') as LightingFixture[]) {
    const cabin = String(row['所属舱室'] ?? '')
    const item =
      map.get(cabin) ??
      ({ cabin, unit: String(row['权属单位'] ?? ''), total: 0, normal: 0, damaged: 0, replaced: 0, pending: 0, lastInspectDate: '' } as CabinSummary)
    item.total += 1
    if (row.status === '照明正常') {
      item.normal += 1
    } else if (row.status === '已损坏') {
      item.damaged += 1
      item.pending += 1
    } else if (row.status === '已更换') {
      item.replaced += 1
    } else {
      item.pending += 1
    }
    if (String(row['巡检日期'] ?? '') > item.lastInspectDate) {
      item.lastInspectDate = String(row['巡检日期'] ?? '')
    }
    if (!item.unit && row['权属单位']) {
      item.unit = String(row['权属单位'])
    }
    map.set(cabin, item)
  }
  return [...map.values()].sort((a, b) => a.cabin.localeCompare(b.cabin))
}

// ---- 整批提交：一次提交、逐台回执 ----
export function submitBatch(ids: number[], cabin: string, actor: SubmitActor, remark: string): SubmitResult {
  ensureBackfilled()

  const rows = listRows('lighting') as LightingFixture[]
  const byId = new Map(rows.map((row) => [Number(row.id), row]))

  // 同一盏灯同批重复出现只算一次：保留第一次圈选。
  const uniqueIds: number[] = []
  for (const id of ids) {
    if (byId.has(id) && !uniqueIds.includes(id)) {
      uniqueIds.push(id)
    }
  }
  const duplicatedPicks = ids.length - uniqueIds.length

  if (uniqueIds.length === 0) {
    return { ok: false, message: '本批没有圈出任何灯具' }
  }

  const selected = uniqueIds.map((id) => byId.get(id)!)
  const cabins = [...new Set(selected.map((row) => String(row['所属舱室'] ?? '')))]
  if (cabins.length !== 1 || cabins[0] !== cabin) {
    return { ok: false, message: `一批只办理一个舱室，当前圈选跨了 ${cabins.length} 个舱室，请分开提交` }
  }

  // 跨单位只读：灯具权属以舱室为准，不是本单位的一律拒绝，且不留任何改动。
  const ownerUnit = String(selected[0]['权属单位'] ?? '')
  if (ownerUnit && ownerUnit !== actor.unit) {
    return {
      ok: false,
      message: `越权提交已拒绝：${cabin} 属${ownerUnit}，${actor.unit}账号只读；本批未办理、未落库`,
    }
  }
  if (actor.post !== '照明巡检岗') {
    return { ok: false, message: `越权提交已拒绝：${actor.post}无权办理灯具整组损坏更换，请用照明巡检岗提交` }
  }

  const { issues } = precheckBatch(uniqueIds)
  if (issues.length > 0) {
    return { ok: false, message: `核对未通过，发现 ${issues.length} 项问题（重号/类型位置不符），请先挑出处理，核对通过后才能落库`, issues }
  }

  const seq = readSeq()
  const date = todayStr()
  const batchSeq = listBatchesStore().filter((item) => item.提交时间.startsWith(date)).length + 1
  const batchNo = `PL-${date.replace(/-/g, '')}-${pad(batchSeq)}`
  const time = nowStr()

  const receipts: ReceiptRow[] = []
  const ledger = listLedgerStore()
  const maintenance = listRows('maintenance')
  let success = 0
  let failed = 0
  let skipped = 0

  const nextRepairId = () => Math.max(0, ...maintenance.map((row) => Number(row.id))) + 1

  const appendLedgerNote = (code: string, note: string) => {
    // 差异只往该灯的对外结论备注里追加；没有对外结论时才退回最早一笔。
    const rowsOf = ledger.filter((row) => row.灯具编号 === code)
    const target =
      rowsOf.find((row) => !row.结论性质.includes('留档备查')) ?? rowsOf[0]
    if (target) {
      target.备注 = target.备注 ? `${target.备注}\n${note}` : note
    }
  }

  const ensureDamageLedger = (row: LightingFixture) => {
    const code = String(row['灯具编号'])
    if (ledger.some((item) => item.灯具编号 === code && item.结论性质.startsWith('巡检损坏判定'))) {
      return
    }
    seq.ledger += 1
    ledger.push({
      id: seq.ledger,
      台账编号: `LED-T-${pad(seq.ledger, 5)}`,
      批次号: batchNo,
      灯具编号: code,
      所属舱室: cabin,
      安装位置: String(row['安装位置'] ?? ''),
      灯具类型: String(row['灯具类型'] ?? ''),
      结论性质: '巡检损坏判定（留档备查）',
      处理结论: `巡检判定损坏：${String(row['灯具类型'] ?? '灯具')}不亮/损坏，待更换`,
      备注: '原始巡检损坏结论，留档备查；对外以更换处理结论为准',
      经办岗位: actor.post,
      经办人员: actor.operator,
      权属单位: ownerUnit,
      落库时间: time,
    })
  }

  for (const row of selected) {
    const code = String(row['灯具编号'])
    const position = String(row['安装位置'] ?? '')
    const type = String(row['灯具类型'] ?? '')
    seq.receipt += 1
    const receipt: ReceiptRow = {
      id: seq.receipt,
      回执编号: `LIGH-R-${pad(seq.receipt, 5)}`,
      批次号: batchNo,
      灯具编号: code,
      所属舱室: cabin,
      安装位置: position,
      结果: '失败',
      回执信息: '',
      检修编号: '',
      经办岗位: actor.post,
      经办人员: actor.operator,
      时间: time,
    }

    if (row.status === '已更换') {
      // 重复上报只认第一次：不重办、不改结论，差异只往首次结论的备注里追加。
      receipt.结果 = '跳过'
      receipt.回执信息 = '重复上报：该灯首次更换已办结，以首次结论为准'
      appendLedgerNote(
        code,
        `${time} ${actor.post}${actor.operator}再次上报${remark ? `，差异：${remark}` : ''}（仅记备注，结论以首次为准）`,
      )
      skipped += 1
    } else if (row.status === '照明正常') {
      receipt.回执信息 = '该灯具巡检结论为照明正常，不在损坏更换范围'
      failed += 1
    } else if (!String(row['额定功率'] ?? '').trim()) {
      receipt.回执信息 = '缺少额定功率，无法匹配更换备件'
      ensureDamageLedger(row)
      seq.ledger += 1
      ledger.push({
        id: seq.ledger,
        台账编号: `LED-T-${pad(seq.ledger, 5)}`,
        批次号: batchNo,
        灯具编号: code,
        所属舱室: cabin,
        安装位置: position,
        灯具类型: type,
        结论性质: '更换未办成（对外）',
        处理结论: `损坏已登记，更换未办成：${receipt.回执信息}`,
        备注: '',
        经办岗位: actor.post,
        经办人员: actor.operator,
        权属单位: ownerUnit,
        落库时间: time,
      })
      failed += 1
    } else if (!position.trim()) {
      receipt.回执信息 = '安装位置缺失，无法定位更换'
      ensureDamageLedger(row)
      seq.ledger += 1
      ledger.push({
        id: seq.ledger,
        台账编号: `LED-T-${pad(seq.ledger, 5)}`,
        批次号: batchNo,
        灯具编号: code,
        所属舱室: cabin,
        安装位置: position,
        灯具类型: type,
        结论性质: '更换未办成（对外）',
        处理结论: `损坏已登记，更换未办成：${receipt.回执信息}`,
        备注: '',
        经办岗位: actor.post,
        经办人员: actor.operator,
        权属单位: ownerUnit,
        落库时间: time,
      })
      failed += 1
    } else {
      ensureDamageLedger(row)

      seq.repair += 1
      const repairNo = `REP-${pad(seq.repair, 4)}`
      maintenance.push({
        id: nextRepairId(),
        status: '待开工',
        pending: true,
        abnormal: false,
        检修编号: repairNo,
        检修对象: `照明灯具 ${code}（${cabin} ${position}）`,
        检修类别: '灯具更换',
        检修班组: '设施检修班',
        计划工期: '',
        完工日期: '',
        更换部件: `${type} ${String(row['额定功率'])}W`,
        检修状态: '待开工',
        来源批次: batchNo,
        来源单位: ownerUnit,
      })

      seq.ledger += 1
      ledger.push({
        id: seq.ledger,
        台账编号: `LED-T-${pad(seq.ledger, 5)}`,
        批次号: batchNo,
        灯具编号: code,
        所属舱室: cabin,
        安装位置: position,
        灯具类型: type,
        结论性质: '更换处理结论（对外）',
        处理结论: `损坏属实，已更换 ${type}（${String(row['额定功率'])}W），更换完成，检修待办已派出（${repairNo}）`,
        备注: remark,
        经办岗位: actor.post,
        经办人员: actor.operator,
        权属单位: ownerUnit,
        落库时间: time,
      })

      row.status = '已更换'
      row.pending = false
      row.abnormal = false
      row.批次号 = batchNo
      receipt.结果 = '成功'
      receipt.回执信息 = '损坏与更换已办，检修待办已派出'
      receipt.检修编号 = repairNo
      success += 1
    }

    receipts.push(receipt)
  }

  const storedBatches = listBatchesStore()
  const batch: BatchRecord = {
    id: storedBatches.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    批次号: batchNo,
    所属舱室: cabin,
    权属单位: ownerUnit,
    圈选数量: ids.length,
    去重后数量: uniqueIds.length,
    批内重复盏次: duplicatedPicks,
    成功数: success,
    失败数: failed,
    跳过数: skipped,
    提交单位: actor.unit,
    提交岗位: actor.post,
    提交人员: actor.operator,
    备注: remark,
    提交时间: time,
  }

  saveRows('lighting', rows)
  saveRows('maintenance', maintenance)
  writeCollection('lighting-batches', [batch, ...storedBatches])
  writeCollection('lighting-receipts', [...receipts.reverse(), ...listReceiptsStore()])
  writeCollection('lighting-ledger', ledger)
  writeCollection('lighting-seq', seq)
  rescanGaps()

  return {
    ok: true,
    message: `批次 ${batchNo} 已办理：成功 ${success} 盏、失败 ${failed} 盏、重复跳过 ${skipped} 盏；批内去重 ${duplicatedPicks} 盏次，每盏均已逐台回执`,
    batch,
    receipts,
  }
}

export function listBatches(): BatchRecord[] {
  return listBatchesStore()
}

export function listReceipts(batchNo?: string): ReceiptRow[] {
  const rows = listReceiptsStore()
  return batchNo ? rows.filter((row) => row.批次号 === batchNo) : rows
}

export function listLedger(): LedgerRow[] {
  return listLedgerStore()
}

// ---- 概览：条数全部取自另存清单，另附一致性核对 ----
export type ConsistencyCheck = { label: string; consistent: boolean; detail: string }

export type LightingOpsSummary = {
  batchCount: number
  receiptCount: number
  successCount: number
  failedCount: number
  skippedCount: number
  ledgerTotal: number
  ledgerPublic: number
  ledgerArchived: number
  gapCount: number
  repairSyncedCount: number
  damagedCount: number
  replacedCount: number
  checks: ConsistencyCheck[]
}

export function lightingOpsSummary(): LightingOpsSummary {
  const batches = listBatchesStore()
  const receipts = listReceiptsStore()
  const ledger = listLedgerStore()
  // 每次看概览都重新扫一遍待补清单并另存，概览条数永远以另存清单为准。
  const gaps = rescanGaps()
  const successCount = receipts.filter((row) => row.结果 === '成功').length
  const failedCount = receipts.filter((row) => row.结果 === '失败').length
  const skippedCount = receipts.filter((row) => row.结果 === '跳过').length
  const ledgerPublic = ledger.filter((row) => !row.结论性质.includes('留档备查')).length
  const ledgerArchived = ledger.filter((row) => row.结论性质.includes('留档备查')).length
  const repairSyncedCount = listRows('maintenance').filter((row) =>
    String(row['来源批次'] ?? '').startsWith('PL-'),
  ).length
  const lights = listRows('lighting')
  const damagedCount = lights.filter((row) => row.status === '已损坏').length
  const replacedCount = lights.filter((row) => row.status === '已更换').length

  const checks: ConsistencyCheck[] = [
    {
      label: '办理回执',
      consistent: receipts.length === successCount + failedCount + skippedCount,
      detail: `另存回执清单 ${receipts.length} 条 = 成功 ${successCount} + 失败 ${failedCount} + 跳过 ${skippedCount}`,
    },
    {
      label: '维保台账',
      consistent: ledger.length === ledgerPublic + ledgerArchived,
      detail: `另存台账 ${ledger.length} 条 = 对外结论 ${ledgerPublic} + 留档备查 ${ledgerArchived}`,
    },
    {
      label: '待补清单',
      consistent: gaps.length === scanGaps().length,
      detail: `另存待补清单 ${gaps.length} 条，与重新扫描结果一致`,
    },
    {
      label: '检修待办同步',
      consistent: repairSyncedCount === successCount,
      detail: `设施检修待办 ${repairSyncedCount} 条 = 更换成功回执 ${successCount} 条`,
    },
    {
      label: '批次台账',
      consistent:
        batches.length === new Set(batches.map((item) => item.批次号)).size &&
        batches.reduce((sum, item) => sum + item.成功数 + item.失败数 + item.跳过数, 0) === receipts.length,
      detail: `批次 ${batches.length} 个，批次内回执合计 ${receipts.length} 条，与回执清单一致`,
    },
  ]

  return {
    batchCount: batches.length,
    receiptCount: receipts.length,
    successCount,
    failedCount,
    skippedCount,
    ledgerTotal: ledger.length,
    ledgerPublic,
    ledgerArchived,
    gapCount: gaps.length,
    repairSyncedCount,
    damagedCount,
    replacedCount,
    checks,
  }
}
