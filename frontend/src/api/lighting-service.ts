import {
  listRows,
  readSidecar,
  saveRows,
  saveSidecar,
} from '@/data/local-store'
import type {
  AuditEntry,
  BatchIssue,
  BatchRecord,
  DuplicateArchive,
  LampReceipt,
  LampRow,
  LedgerEntry,
  LightingSidecar,
  SupplementItem,
} from '@/data/lighting-domain'
import {
  backfillCode,
  typePositionIssue,
} from '@/data/lighting-domain'
import type { EntryRow } from '@/data/types'

const KEY = 'lighting'

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function lampRows(): LampRow[] {
  return listRows(KEY) as unknown as LampRow[]
}

function persistLamps(rows: LampRow[]): void {
  saveRows(KEY, rows as unknown as EntryRow[])
}

/* --------------------------- 存量回填：只跑一次 --------------------------- */

let ensured = false

/**
 * 历史数据按设备投运日期回填：
 * 1) 早年只有安装位置、没有灯具编号的，按舱室+投运日期+位置排序后按规则补号；
 * 2) 缺失项集中进待补清单；
 * 3) 已是「已更换」但还没有台账结论的，按投运/巡检日期回填一条对外台账结论。
 */
export function ensureInitialized(force = false): void {
  if (ensured && !force) return
  const data = readSidecar()
  let rows = lampRows()
  let changed = false

  if (!data.inited) {
    // 1) 无编号补号：全库按舱室分组、投运日期升序（同日按位置）排序
    const pendingNoCode = rows.filter((r) => !String(r.灯具编号 ?? '').trim())
    if (pendingNoCode.length > 0) {
      const byCabin = new Map<string, LampRow[]>()
      for (const row of pendingNoCode) {
        const cabin = String(row.所属舱室)
        byCabin.set(cabin, [...(byCabin.get(cabin) ?? []), row])
      }
      for (const [, group] of byCabin) {
        group.sort(
          (a, b) =>
            String(a.投运日期 ?? '').localeCompare(String(b.投运日期 ?? '')) ||
            String(a.安装位置 ?? '').localeCompare(String(b.安装位置 ?? '')),
        )
        group.forEach((row, index) => {
          const target = rows.find((r) => r.id === row.id)
          if (target) {
            target.灯具编号 = backfillCode(
              String(target.所属舱室),
              String(target.投运日期 ?? ''),
              index + 1,
            )
            target.编号方式 = '规则补号'
          }
        })
      }
      changed = true
    }

    // 2) 缺失项集中列待补清单
    const supplements: SupplementItem[] = []
    rows.forEach((row) => {
      const missing: string[] = []
      if (!String(row.投运日期 ?? '').trim()) missing.push('投运日期')
      if (!String(row.巡检日期 ?? '').trim()) missing.push('巡检日期')
      if (!String(row.巡检人员 ?? '').trim()) missing.push('巡检人员')
      if (row.编号方式 !== '正式编号') missing.push('正式灯具编号')
      if (missing.length > 0) {
        supplements.push({
          id: `SUP-${String(row.id).padStart(3, '0')}`,
          灯具行号: row.id,
          灯具编号: String(row.灯具编号),
          所属舱室: String(row.所属舱室),
          安装位置: String(row.安装位置),
          缺失项: missing,
          发现方式: '存量回填核对',
          状态: '待补录',
        })
      }
    })
    data.supplements = supplements

    // 3) 存量已更换灯具：按投运日期回填维保台账结论（对外版本）
    const ledger: LedgerEntry[] = [...data.ledger]
    rows.forEach((row) => {
      if (row.status === '已更换' && !String(row.结论批次号).trim()) {
        const batchNo = 'HIST-BACKFILL'
        const time = `${String(row.巡检日期 || row.投运日期 || '').trim() || '—'} 历史回填`
        row.结论 = '更换完成'
        row.结论批次号 = batchNo
        row.结论时间 = time
        row.备注 = `${String(row.备注 ?? '')}存量更换记录按投运/巡检日期回填`.trim()
        ledger.push({
          台账号: `LED-H${String(row.id).padStart(3, '0')}`,
          灯具编号: String(row.灯具编号),
          所属舱室: String(row.所属舱室),
          灯具类型: String(row.灯具类型),
          安装位置: String(row.安装位置),
          巡检日期: String(row.巡检日期),
          处理结论: '更换完成',
          处理时间: time,
          批次号: batchNo,
          责任单位: String(row.权属单位),
          责任岗位: '历史台账',
          回执号: '—',
          检修待办编号: '—',
          备注: '历史数据按设备投运日期回填',
          对外版本: true,
        })
        changed = true
      }
    })
    data.ledger = ledger
    data.inited = true
  }

  if (changed) persistLamps(rows)
  saveSidecar(data)
  ensured = true
}

/* ------------------------------- 送系统前核对 ------------------------------ */

export interface PrecheckResult {
  /** 批内去重后的行 */
  uniqueRows: LampRow[]
  /** 批内重复：同一盏灯重复出现 */
  intraDuplicates: BatchIssue[]
  /** 落库前拦截的问题：重号 / 类型位置不符 / 跨单位只读 / 舱室混批 */
  blocking: BatchIssue[]
  /** 重复上报：本盏灯已有对外结论 */
  repeatReports: BatchIssue[]
  cabin: string
  stockBefore: Record<string, number>
  /** 按现有库存预计各型号会有几台换不成 */
  shortageForecast: Array<{ 灯具类型: string; 需要: number; 库存: number; 缺口: number }>
}

/** 同一盏灯在同一批里重复出现只算一次：以行 id 去重，重复项留痕 */
function dedupe(ids: number[]): { uniqueIds: number[]; dupes: BatchIssue[] } {
  const seen = new Set<number>()
  const dupes: BatchIssue[] = []
  rowsById(ids).forEach((row) => {
    if (seen.has(row.id)) {
      dupes.push({
        rowId: row.id,
        灯具编号: String(row.灯具编号),
        安装位置: String(row.安装位置),
        问题类型: '批内重复',
        说明: `灯具 ${row.灯具编号}（${row.安装位置}）在本批中重复勾选，只按第一次计入`,
      })
    } else {
      seen.add(row.id)
    }
  })
  return { uniqueIds: [...seen], dupes }
}

function rowsById(ids: number[]): LampRow[] {
  const all = lampRows()
  return ids
    .map((id) => all.find((row) => row.id === id))
    .filter((row): row is LampRow => Boolean(row))
}

/** 送进系统之前先核对：问题灯具先挑出来提示，核对通过才落库 */
export function precheckBatch(
  ids: number[],
  cabin: string,
  unit: string,
): PrecheckResult {
  ensureInitialized()
  const data = readSidecar()
  const all = lampRows()
  const { uniqueIds, dupes } = dedupe(ids)
  const uniqueRows = rowsById(uniqueIds)

  // 全库重号地图（同编号、不同行）
  const codeOwners = new Map<string, number>()
  all.forEach((row) => {
    const code = String(row.灯具编号 ?? '').trim()
    if (code) codeOwners.set(code, (codeOwners.get(code) ?? 0) + 1)
  })

  const blocking: BatchIssue[] = []
  const repeatReports: BatchIssue[] = []
  uniqueRows.forEach((row) => {
    const code = String(row.灯具编号 ?? '').trim()
    if (code && (codeOwners.get(code) ?? 0) > 1) {
      blocking.push({
        rowId: row.id,
        灯具编号: code,
        安装位置: String(row.安装位置),
        问题类型: '编号重号',
       说明: `灯具编号「${code}」在全库登记了 ${codeOwners.get(code)} 次，需先核实重号`,
      })
    }
    const typeIssue = typePositionIssue(
      String(row.灯具类型),
      String(row.所属舱室),
      String(row.安装位置),
    )
    if (typeIssue) {
      blocking.push({
        rowId: row.id,
        灯具编号: code,
        安装位置: String(row.安装位置),
        问题类型: '类型位置不符',
        说明: typeIssue,
      })
    }
    if (String(row.权属单位) !== unit) {
      blocking.push({
        rowId: row.id,
        灯具编号: code,
        安装位置: String(row.安装位置),
        问题类型: '跨单位只读',
        说明: `灯具属「${row.权属单位}」资产，本单位（${unit}）只读，不能办理`,
      })
    }
    if (String(row.所属舱室) !== cabin) {
      blocking.push({
        rowId: row.id,
        灯具编号: code,
        安装位置: String(row.安装位置),
        问题类型: '舱室混批',
        说明: `灯具属于「${row.所属舱室}」，与本批舱室「${cabin}」不一致`,
      })
    }
    // 重复上报：已有对外结论的灯，后续再办只认第一次
    if (String(row.结论).trim()) {
      repeatReports.push({
        rowId: row.id,
        灯具编号: code,
        安装位置: String(row.安装位置),
        问题类型: '舱室混批',
        说明: `该灯已有对外结论「${row.结论}」（批次 ${row.结论批次号}），本次按重复上报处理，只记备注留档`,
      })
    }
  })

  const blockedIds = new Set(blocking.map((item) => item.rowId))
  const repeatedIds = new Set(repeatReports.map((item) => item.rowId))
  const candidates = uniqueRows.filter((row) => !blockedIds.has(row.id) && !repeatedIds.has(row.id))
  const needByType: Record<string, number> = {}
  candidates.forEach((row) => {
    const t = String(row.灯具类型)
    needByType[t] = (needByType[t] ?? 0) + 1
  })
  const shortageForecast = Object.entries(needByType).map(([t, need]) => {
    const stock = data.stock[t] ?? 0
    return { 灯具类型: t, 需要: need, 库存: stock, 缺口: Math.max(0, need - stock) }
  })

  return {
    uniqueRows,
    intraDuplicates: dupes,
    blocking,
    repeatReports,
    cabin,
    stockBefore: { ...data.stock },
    shortageForecast,
  }
}

/* ------------------------------- 整批办理 -------------------------------- */

export interface SubmitResult {
  batch: BatchRecord
  accepted: boolean
  message: string
}

export interface SubmitInput {
  ids: number[]
  cabin: string
  unit: string
  post: string
  operator: string
  patrolDate: string
}

function addAudit(data: LightingSidecar, entry: AuditEntry): void {
  data.audit.unshift(entry)
}

function pushMaintenanceTodo(batchNo: string, cabin: string, receipts: LampReceipt[], date: string): string {
  // 更换完成的灯具同步到设施检修管理待办：一批派一张检修单，检修班在检修页面能看到
  if (receipts.length === 0) return ''
  const todoNo = `MAIN-L${String(Date.now()).slice(-6)}`
  const maintRows = listRows('maintenance')
  const maxId = maintRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const replaced = receipts.filter((r) => r.结论 === '更换完成')
  const summary = replaced.map((r) => r.灯具编号).join('、')
  maintRows.push({
    id: maxId + 1,
    status: '待开工',
    pending: true,
    abnormal: false,
    检修编号: todoNo,
    检修对象: `${cabin}照明灯具（${replaced.length}盏）`,
    检修类别: '灯具更换复验',
    检修班组: '检修班',
    计划工期: date.slice(0, 10),
    完工日期: '',
    更换部件: summary,
    检修状态: '照明整组更换已派出，待复验',
  } as unknown as EntryRow)
  saveRows('maintenance', maintRows)
  return todoNo
}

/** 一次提交：逐台灯办损坏与更换，每台单独回执；没办成的另列原因 */
export function submitBatch(input: SubmitInput): SubmitResult {
  ensureInitialized()
  const { ids, cabin, unit, post, operator, patrolDate } = input
  const data = readSidecar()
  const time = nowText()
  const batchNo = `LBR-${time.slice(0, 10).replace(/-/g, '')}-${String(data.seq).padStart(3, '0')}`
  const all = lampRows()

  const check = precheckBatch(ids, cabin, unit)
  const receipts: LampReceipt[] = []
  const blockedIds = new Set(check.blocking.map((item) => item.rowId))
  const stock = { ...data.stock }
  const ledgerAdds: LedgerEntry[] = []
  const duplicateAdds: DuplicateArchive[] = []
  let todoNo = ''

  // 越权提交一律拒绝：本平台只有资产运维单位可写，外单位看到的全部只读。
  // 即便整批都是外单位自家灯具，也不受理；批次仍按原提交岗位留档。
  const operatingUnit = '管廊运维中心'
  const rejected = unit !== operatingUnit

  // 逐台办理
  check.uniqueRows.forEach((row) => {
    const code = String(row.灯具编号)
    const receiptNo = `RCPT-${String(data.seq++).padStart(4, '0')}`
    const base = {
      rowId: row.id,
      灯具编号: code,
      灯具类型: String(row.灯具类型),
      安装位置: String(row.安装位置),
      回执号: receiptNo,
      检修待办编号: '',
      时间: time,
    }

    // 越权提交：每台灯都单独回执拒绝原因，不落库、不扣库存
    if (rejected) {
      receipts.push({
        ...base,
        结论: '办理失败',
        原因: `越权提交已拒绝：${unit} 对本平台灯具只有只读权限，改动记录归原岗位留档`,
      })
      return
    }

    if (blockedIds.has(row.id)) {
      const reasons = check.blocking
        .filter((item) => item.rowId === row.id)
        .map((item) => item.说明)
        .join('；')
      receipts.push({ ...base, 结论: '办理失败', 原因: reasons })
      return
    }

    // 重复上报只认第一次的内容，后续差异只记备注、留档备查
    if (String(row.结论).trim()) {
      const firstConclusion = String(row.结论)
      const firstBatch = String(row.结论批次号)
      const diff = `本次再次申报「整组损坏与更换」，首次结论为「${firstConclusion}」`
      row.备注 = [String(row.备注 ?? ''), `${time} 重复上报：${diff}（批次 ${batchNo}），以首次结论为准`]
        .filter(Boolean)
        .join('；')
      duplicateAdds.push({
        id: `DUP-${receiptNo}`,
        灯具编号: code,
        首次批次: firstBatch,
        首次结论: firstConclusion,
        首次时间: String(row.结论时间),
        后续批次: batchNo,
        后续内容: '再次申报损坏并更换',
        差异: diff,
        提交单位: unit,
        提交岗位: post,
        提交人: operator,
        时间: time,
      })
      ledgerAdds.push({
        台账号: `LED-L${String(data.seq++).padStart(4, '0')}`,
        灯具编号: code,
        所属舱室: cabin,
        灯具类型: String(row.灯具类型),
        安装位置: String(row.安装位置),
        巡检日期: patrolDate,
        处理结论: firstConclusion,
        处理时间: time,
        批次号: batchNo,
        责任单位: unit,
        责任岗位: post,
        回执号: receiptNo,
        检修待办编号: '',
        备注: `重复上报，对外仍呈现首次结论（${firstBatch}）；本份留档备查`,
        对外版本: false,
      })
      receipts.push({
        ...base,
        结论: '办理失败',
        原因: `重复上报：该灯已有对外结论「${firstConclusion}」，本次差异只记备注留档`,
      })
      return
    }

    // 备件不足：办不成，单独回执，不落结论
    const type = String(row.灯具类型)
    if (row.status !== '已损坏') {
      receipts.push({
        ...base,
        结论: '办理失败',
        原因: `灯具当前状态为「${row.status}」，本批只办理损坏与更换，不能按更换落库`,
      })
      return
    }
    if ((stock[type] ?? 0) <= 0) {
      receipts.push({
        ...base,
        结论: '办理失败',
        原因: `${type}备件库存为 0，暂时无法更换，已转待料`,
      })
      return
    }

    // 办成：损坏与更换一次落库，逐台回执（先留存原状态再改）
    const originalStatus = row.status
    stock[type] -= 1
    row.status = '已更换'
    row.pending = false
    row.abnormal = false
    row.巡检日期 = patrolDate
    row.巡检人员 = operator
    row.结论 = '更换完成'
    row.结论批次号 = batchNo
    row.结论时间 = time
    ledgerAdds.push({
      台账号: `LED-L${String(data.seq++).padStart(4, '0')}`,
      灯具编号: code,
      所属舱室: cabin,
      灯具类型: type,
      安装位置: String(row.安装位置),
      巡检日期: patrolDate,
      处理结论: '更换完成',
      处理时间: time,
      批次号: batchNo,
      责任单位: unit,
      责任岗位: post,
      回执号: receiptNo,
      检修待办编号: '见批次检修单',
      备注: `整组损坏与更换一次办理；原状态「${originalStatus}」`,
      对外版本: true,
    })
    receipts.push({ ...base, 结论: '更换完成', 原因: '损坏已登记，灯具更换完成', 检修待办编号: '待派单' })
  })

  // 成功更换的灯：整批同步一张设施检修待办单，并把单号回填到回执/台账
  const successReceipts = receipts.filter((r) => r.结论 === '更换完成')
  if (successReceipts.length > 0) {
    todoNo = pushMaintenanceTodo(batchNo, cabin, successReceipts, time)
    successReceipts.forEach((r) => {
      r.检修待办编号 = todoNo
    })
    ledgerAdds.forEach((entry) => {
      if (entry.批次号 === batchNo && entry.对外版本) entry.检修待办编号 = todoNo
    })
  }

  const batch: BatchRecord = {
    批次号: batchNo,
    舱室: cabin,
    提交单位: unit,
    提交岗位: post,
    提交人: operator,
    提交时间: time,
    巡检日期: patrolDate,
    去重前台数: ids.length,
    去重后台数: check.uniqueRows.length,
    批内重复: check.intraDuplicates.map((item) => ({
      灯具编号: item.灯具编号,
      安装位置: item.安装位置,
      说明: item.说明,
    })),
    拦截问题: check.blocking,
    回执: receipts,
    成功数: successReceipts.length,
    失败数: receipts.length - successReceipts.length,
    已拒绝: rejected,
  }

  data.batches.unshift(batch)
  data.ledger.push(...ledgerAdds)
  data.duplicates.push(...duplicateAdds)
  data.stock = stock
  addAudit(data, {
    时间: time,
    单位: unit,
    岗位: post,
    人员: operator,
    动作: rejected ? '越权整组提交（拒绝）' : '整组损坏与更换提交',
    结果: rejected ? '已拒绝' : `成功 ${batch.成功数} 台 / 失败 ${batch.失败数} 台`,
    详情: `批次 ${batchNo} · ${cabin} · 去重后 ${check.uniqueRows.length} 台${todoNo ? ` · 检修待办 ${todoNo}` : ''}`,
  })

  persistLamps(all)
  saveSidecar(data)

  return {
    batch,
    accepted: !rejected,
    message: rejected
      ? `批次 ${batchNo} 已拒绝：本批灯具均不属于本单位或未通过核对，跨单位只能只读，改动记录仍归原岗位`
      : `批次 ${batchNo} 已落库：成功 ${batch.成功数} 台、失败 ${batch.失败数} 台${todoNo ? `，检修待办 ${todoNo} 已同步检修班` : ''}`,
  }
}

/* -------------------------------- 查询出口 -------------------------------- */

export function listLamps(): LampRow[] {
  ensureInitialized()
  return lampRows()
}

export function listBatches(): BatchRecord[] {
  ensureInitialized()
  return readSidecar().batches
}

export function listLedger(): LedgerEntry[] {
  ensureInitialized()
  return readSidecar().ledger
}

export function listSupplements(): SupplementItem[] {
  ensureInitialized()
  return readSidecar().supplements
}

export function listDuplicates(): DuplicateArchive[] {
  ensureInitialized()
  return readSidecar().duplicates
}

export function listAudit(): AuditEntry[] {
  ensureInitialized()
  return readSidecar().audit
}

export function currentStock(): Record<string, number> {
  ensureInitialized()
  return { ...readSidecar().stock }
}

export interface LightingSummary {
  total: number
  damaged: number
  replaced: number
  pendingPatrol: number
  abnormal: number
  supplementCount: number
  batchCount: number
  ledgerCount: number
  duplicateCount: number
  todoCount: number
  /** 概览条数与另存清单必须一致；不一致时列出差异 */
  consistency: string[]
}

/** 概览：所有条数都直接来自另存的同一份清单，并做一致性交叉校验 */
export function lightingSummary(): LightingSummary {
  ensureInitialized()
  const rows = lampRows()
  const data = readSidecar()
  const maint = listRows('maintenance')
  const summary: LightingSummary = {
    total: rows.length,
    damaged: rows.filter((r) => r.status === '已损坏').length,
    replaced: rows.filter((r) => r.status === '已更换').length,
    pendingPatrol: rows.filter((r) => r.status === '待巡检' || r.status === '巡检中').length,
    abnormal: rows.filter((r) => r.abnormal).length,
    supplementCount: data.supplements.length,
    batchCount: data.batches.length,
    ledgerCount: data.ledger.length,
    duplicateCount: data.duplicates.length,
    todoCount: maint.filter((r) => String(r.检修类别) === '灯具更换复验').length,
    consistency: [],
  }
  const publicConclusions = data.ledger.filter((entry) => entry.对外版本).length
  if (publicConclusions !== summary.replaced) {
    summary.consistency.push(
      `已更换灯具 ${summary.replaced} 盏，与台账对外结论 ${publicConclusions} 条不一致`,
    )
  }
  const missingNow = rows.filter(
    (r) =>
      !String(r.投运日期 ?? '').trim() ||
      !String(r.巡检日期 ?? '').trim() ||
      !String(r.巡检人员 ?? '').trim() ||
      r.编号方式 !== '正式编号',
  ).length
  if (missingNow !== summary.supplementCount) {
    summary.consistency.push(
      `现存缺项灯具 ${missingNow} 盏，与待补清单 ${summary.supplementCount} 条不一致，请重新核对`,
    )
  }
  const publicBatchConclusions = data.ledger.filter(
    (e) => e.对外版本 && e.批次号 !== 'HIST-BACKFILL',
  ).length
  const successReceipts = data.batches.reduce((sum, b) => sum + b.成功数, 0)
  if (publicBatchConclusions !== successReceipts) {
    summary.consistency.push(
      `批次成功回执 ${successReceipts} 张，与批次台账结论 ${publicBatchConclusions} 条不一致`,
    )
  }
  return summary
}

/* ------------------------------- 台账另存导出 ------------------------------ */

function toCsv(headers: string[], lines: Array<Array<string | number>>): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `\uFEFF${[headers, ...lines.map((line) => line.map(esc).join(','))].join('\n')}`
}

export function ledgerCsv(): { filename: string; content: string } {
  const rows = listLedger()
  const headers = ['台账号', '灯具编号', '所属舱室', '灯具类型', '安装位置', '巡检日期', '处理结论', '处理时间', '批次号', '责任单位', '责任岗位', '回执号', '检修待办编号', '对外版本', '备注']
  return {
    filename: '照明维保台账.csv',
    content: toCsv(headers, rows.map((r) => [
      r.台账号, r.灯具编号, r.所属舱室, r.灯具类型, r.安装位置, r.巡检日期,
      r.处理结论, r.处理时间, r.批次号, r.责任单位, r.责任岗位, r.回执号,
      r.检修待办编号, r.对外版本 ? '对外结论' : '留档备查', r.备注,
    ])),
  }
}

export function supplementCsv(): { filename: string; content: string } {
  const rows = listSupplements()
  return {
    filename: '照明待补清单.csv',
    content: toCsv(
      ['补录号', '灯具行号', '灯具编号', '所属舱室', '安装位置', '缺失项', '发现方式', '状态'],
      rows.map((r) => [r.id, r.灯具行号, r.灯具编号, r.所属舱室, r.安装位置, r.缺失项.join('、'), r.发现方式, r.状态]),
    ),
  }
}

export function downloadCsv(bundle: { filename: string; content: string }): void {
  const blob = new Blob([bundle.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = bundle.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
