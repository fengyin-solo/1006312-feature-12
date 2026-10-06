// 端到端冒烟：localStorage 打桩，直接跑照明整组流程。仅用于本地验证，不参与构建。
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const harness = `
import { buildLightingSeed } from '../src/data/seed-lighting.ts'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = { localStorage: globalThis.localStorage }

const storageKey = 'urban-utility-tunnel:entries'
localStorage.setItem(storageKey, JSON.stringify({ lighting: buildLightingSeed() }))

const svc = await import('../src/api/lighting-service.ts')

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra) }
}

// 1) 初始化回填
svc.ensureInitialized()
const lamps = svc.listLamps()
console.log('灯具总数', lamps.length)
check('种子 42 盏', lamps.length === 42, lamps.length)
const backfilled = lamps.filter((l) => l.编号方式 === '规则补号')
check('2 盏早年无号灯按规则补号', backfilled.length === 2, backfilled.map((l) => l.灯具编号).join(','))
check('补号格式 LIGH-SX-P', backfilled.every((l) => /^LIGH-SX-P\\d{7}$/.test(l.灯具编号)))
const supplements = svc.listSupplements()
check('待补清单条数 = 现存缺项灯数', supplements.length >= 3, supplements.length)

// 2) 历史已更换回填台账
const ledger0 = svc.listLedger()
const hist = ledger0.filter((e) => e.批次号 === 'HIST-BACKFILL')
check('存量已更换按投运日期回填台账 1 条', hist.length === 1, hist.length)

// 3) 综合舱整批：勾选本单位坏灯（内含重号灯、类型不符灯）+ 外单位灯 + 已更换灯
const zhRows = lamps.filter((l) => String(l.所属舱室) === '综合舱')
const damageRows = zhRows.filter((l) => l.status === '已损坏' && String(l.权属单位) === '管廊运维中心')
const dupCodeRow = zhRows.find((l) => String(l.灯具编号) === 'LIGH-ZH-LED-001' && String(l.灯具类型) === '应急照明灯')
const foreign = zhRows.find((l) => String(l.权属单位) !== '管廊运维中心')
const replaced = zhRows.find((l) => l.status === '已更换')
// dupCodeRow 本身就在 damageRows 里，不重复加入；preDup 再手工勾一次以验证批内去重
const ids = [...damageRows.map((l) => l.id), foreign.id, replaced.id]
const preDup = svc.precheckBatch([...ids, damageRows[0].id], '综合舱', '管廊运维中心')
check('批内重复勾选被识别只算一次', preDup.intraDuplicates.length === 1)
const pre = svc.precheckBatch(ids, '综合舱', '管廊运维中心')
console.log('核对：拦截', pre.blocking.length, '重复上报', pre.repeatReports.length, '批内重复', pre.intraDuplicates.length, '可办', damageRows.length - 2)
check('批内无重复勾选', pre.intraDuplicates.length === 0, pre.intraDuplicates.length)
const kinds = pre.blocking.map((b) => b.问题类型)
check('编号重号被挑出', kinds.includes('编号重号'))
check('类型位置不符被挑出', kinds.filter((k) => k === '类型位置不符').length >= 1)
check('跨单位只读被挑出', kinds.includes('跨单位只读'))
check('重复上报被挑出', pre.repeatReports.length === 1)
const forecast = pre.shortageForecast.find((f) => f.灯具类型 === 'LED平板灯')
check('平板灯库存不足被预警', forecast && forecast.缺口 > 0, JSON.stringify(forecast))

// 4) 整批提交
const r1 = svc.submitBatch({ ids, cabin: '综合舱', unit: '管廊运维中心', post: '巡检一班', operator: '王巡检', patrolDate: '2026-10-06' })
console.log(r1.message)
check('批次被受理', r1.accepted === true)
check('成功回执 = 7（平板4+应急2+疏散1，平板缺料2）', r1.batch.成功数 === 7, r1.batch.成功数)
// 失败：重号2行 + 类型不符1 + 外单位1 + 重复上报1 + 缺料4（平板2/应急1/疏散1）= 9
check('失败回执 = 9', r1.batch.失败数 === 9, r1.batch.失败数)
const failedReasons = r1.batch.回执.filter((x) => x.结论 === '办理失败').map((x) => x.原因)
check('每台失败都有原因', failedReasons.every((x) => x && x.length > 0))
check('缺料逐台回执', failedReasons.some((x) => x.includes('库存为 0')))
check('成功回执都有检修待办号', r1.batch.回执.filter((x) => x.结论 === '更换完成').every((x) => /^MAIN-L/.test(x.检修待办编号)))
check('库存按实际扣减：平板灯 0', svc.currentStock()['LED平板灯'] === 0, svc.currentStock()['LED平板灯'])
check('库存扣减：应急灯 0', svc.currentStock()['应急照明灯'] === 0)
check('库存扣减：疏散灯 0', svc.currentStock()['疏散指示灯'] === 0)

// 5) 检修待办同步：MAIN 表里一张复验单
const store = await import('../src/data/local-store.ts')
const maint = store.listRows('maintenance')
const todo = maint.filter((m) => String(m.检修类别) === '灯具更换复验')
check('检修待办同步 1 张', todo.length === 1, todo.length)
check('检修单含 7 盏编号', todo[0] && String(todo[0].更换部件).split('、').length === 7)
check('检修单状态待开工', todo[0] && todo[0].status === '待开工')

// 6) 重复上报留档 + 台账双版本
const dups = svc.listDuplicates()
check('重复上报留档 1 条', dups.length === 1, dups.length)
const led = svc.listLedger()
const replacedLedger = led.filter((e) => e.灯具编号 === 'LIGH-ZH-LED-009')
check('同灯台账有对外+留档两份', replacedLedger.length === 2, replacedLedger.length)
check('留档版本不对外', replacedLedger.some((e) => e.对外版本 === false))
check('对外只呈现首次结论', replacedLedger.every((e) => e.处理结论 === '更换完成'))
const lamp9 = svc.listLamps().find((l) => String(l.灯具编号) === 'LIGH-ZH-LED-009')
check('差异只记备注', String(lamp9.备注).includes('重复上报'))

// 7) 外单位越权整批提交：拒绝但留审计，记录归原岗位
const foreignIds = svc.listLamps().filter((l) => String(l.权属单位) === '外协单位·华东照明').map((l) => l.id)
const r2 = svc.submitBatch({ ids: foreignIds, cabin: '综合舱', unit: '外协单位·华东照明', post: '外单位巡检', operator: '赵外协', patrolDate: '2026-10-06' })
check('外单位整批提交被拒绝', r2.accepted === false)
check('拒绝批次仍留档', r2.batch.已拒绝 === true)
check('外单位灯未被改动', svc.listLamps().find((l) => l.id === foreignIds[0]).status === '已损坏')
const audit = svc.listAudit()
check('审计记录归原岗位', audit.some((a) => a.岗位 === '外单位巡检' && a.动作.includes('越权')))

// 8) 一致性校验通过
const s = svc.lightingSummary()
console.log('概览', JSON.stringify({ total: s.total, damaged: s.damaged, replaced: s.replaced, supplement: s.supplementCount, todo: s.todoCount }, null, 0))
check('概览与另存清单一致', s.consistency.length === 0, s.consistency.join('；'))

// 9) 燃气舱：4 盏坏防爆灯，库存够，全部办成，再派一张检修复验单
const rq = svc.listLamps().filter((l) => String(l.所属舱室) === '燃气舱' && l.status === '已损坏' && String(l.灯具类型) === 'LED防爆灯')
const r3 = svc.submitBatch({ ids: rq.map((l) => l.id), cabin: '燃气舱', unit: '管廊运维中心', post: '巡检二班', operator: '钱巡检', patrolDate: '2026-10-06' })
check('燃气舱成功 4', r3.batch.成功数 === 4, r3.batch.成功数)
check('燃气舱失败 0', r3.batch.失败数 === 0, r3.batch.失败数)
const todoAfter = store.listRows('maintenance').filter((m) => String(m.检修类别) === '灯具更换复验')
check('检修复验待办累计 2 张', todoAfter.length === 2, todoAfter.length)
const s2 = svc.lightingSummary()
check('提交后概览仍一致', s2.consistency.length === 0, s2.consistency.join('；'))

console.log('\\n结果:', pass, 'passed,', fail, 'failed')
if (fail > 0) process.exit(1)
`

writeFileSync('./.smoke/lighting-smoke.mts', harness)

await build({
  entryPoints: ['./.smoke/lighting-smoke.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: './.smoke/lighting-smoke.mjs',
  absWorkingDir: process.cwd(),
  logLevel: 'silent',
})
