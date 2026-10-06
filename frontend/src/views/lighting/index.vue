<template>
  <section class="page" data-module="lighting">
    <header class="page-head">
      <div>
        <h2>廊内照明运维管理</h2>
        <p class="page-desc">
          按舱室整组处理：先圈出本舱待办灯具，送系统核对编号与安装位置，核对通过才整批落库；
          一次提交、逐台回执，更换完成同步检修班待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportLedger">另存维保台账</button>
        <button class="btn" type="button" @click="exportSupplements">另存待补清单</button>
      </div>
    </header>

    <div v-if="store.isReadOnly" class="readonly-banner">
      当前为外单位身份（{{ store.unit }}），跨单位只能只读查看，整组提交一律拒绝；改动记录仍归原岗位。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">灯具总数</span>
        <strong class="stat-value">{{ summary.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已损坏待办</span>
        <strong class="stat-value stat-danger">{{ summary.damaged }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已更换（有对外结论）</span>
        <strong class="stat-value">{{ summary.replaced }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待补清单</span>
        <strong class="stat-value">{{ summary.supplementCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修待办（复验）</span>
        <strong class="stat-value">{{ summary.todoCount }}</strong>
      </article>
    </div>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <em v-if="tab.badge" class="tab-badge">{{ tab.badge }}</em>
      </button>
    </div>

    <!-- ============================ 整组处理 ============================ -->
    <div v-if="activeTab === 'batch'" class="tab-panel">
      <form class="filter-bar batch-controls" @submit.prevent="runPrecheck">
        <label class="filter-item">
          <span>按舱室圈选（一批只办一个舱室）</span>
          <select v-model="cabin">
            <option v-for="item in cabins" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>灯具状态筛选</span>
          <select v-model="statusFilter">
            <option value="">全部</option>
            <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>巡检日期</span>
          <input v-model="patrolDate" type="date" />
        </label>
        <label class="filter-item">
          <span>编号/位置检索</span>
          <input v-model="keyword" placeholder="按灯具编号或安装位置检索" />
        </label>
        <button class="btn" type="submit">核对圈选结果</button>
        <button class="btn ghost" type="button" @click="selectDamage">勾选本舱全部已损坏</button>
        <button class="btn ghost" type="button" @click="clearSelection">清空勾选</button>
      </form>

      <p class="status-legend">
        <span class="legend-item">本舱灯具 {{ cabinRows.length }} 盏</span>
        <span class="legend-item">已勾选 {{ selected.length }} 盏</span>
        <span class="legend-item">其中外单位 {{ crossSelected }} 盏（只读不可办）</span>
        <span class="legend-item">已有结论 {{ repeatedSelected }} 盏（重复上报）</span>
      </p>

      <table class="data-table lamp-table">
        <thead>
          <tr>
            <th style="width: 36px"><input type="checkbox" :checked="allCabinChecked" @change="toggleAll" /></th>
            <th>灯具编号</th>
            <th>编号方式</th>
            <th>灯具类型</th>
            <th>安装位置</th>
            <th>额定功率</th>
            <th>巡检日期</th>
            <th>权属单位</th>
            <th>当前状态</th>
            <th>对外结论</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in cabinRows"
            :key="String(row.id)"
            :class="{
              selected: selected.includes(row.id),
              foreign: String(row.权属单位) !== store.unit,
              replaced: row.status === '已更换',
            }"
          >
            <td>
              <input
                type="checkbox"
                :checked="selected.includes(row.id)"
                @change="toggleOne(row.id)"
              />
            </td>
            <td>{{ row.灯具编号 || '—' }}</td>
            <td>
              <span :class="['code-kind', row.编号方式 === '正式编号' ? 'ok' : 'warn']">{{ row.编号方式 }}</span>
            </td>
            <td>{{ row.灯具类型 }}</td>
            <td>{{ row.安装位置 }}</td>
            <td>{{ row.额定功率 }}</td>
            <td>{{ row.巡检日期 || '—' }}</td>
            <td>{{ row.权属单位 }}<em v-if="String(row.权属单位) !== store.unit" class="readonly-tag">只读</em></td>
            <td>{{ row.status }}</td>
            <td>{{ row.结论 || '—' }}</td>
          </tr>
          <tr v-if="!cabinRows.length">
            <td colspan="10" class="empty-state">该舱室暂无灯具</td>
          </tr>
        </tbody>
      </table>

      <!-- 核对结果：送系统之前先核对，问题灯具先挑出来提示 -->
      <div v-if="precheck" class="precheck-panel">
        <h3>核对结果（核对通过才落库）</h3>
        <p class="precheck-summary">
          圈选 {{ precheck.uniqueRows.length }} 盏（批内重复 {{ precheck.intraDuplicates.length }} 处，只算一次），
          拦截 {{ precheck.blocking.length }} 盏，重复上报 {{ precheck.repeatReports.length }} 盏，
          可办理 {{ processableCount }} 盏。
        </p>

        <div v-if="precheck.intraDuplicates.length" class="issue-group">
          <h4>批内重复（同一盏灯重复出现，只算一次）</h4>
          <ul>
            <li v-for="(item, i) in precheck.intraDuplicates" :key="`d${i}`">⚠️ {{ item.说明 }}</li>
          </ul>
        </div>

        <div v-if="precheck.blocking.length" class="issue-group block">
          <h4>核对拦截（先处理以下问题，本盏本次不办理）</h4>
          <table class="data-table inner-table">
            <thead><tr><th>灯具编号</th><th>安装位置</th><th>问题类型</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in precheck.blocking" :key="`b${i}`">
                <td>{{ item.灯具编号 || '—' }}</td>
                <td>{{ item.安装位置 }}</td>
                <td><span class="issue-tag">{{ item.问题类型 }}</span></td>
                <td>{{ item.说明 }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="precheck.repeatReports.length" class="issue-group repeat">
          <h4>重复上报（只认第一次的内容，本次差异只记备注、留档备查）</h4>
          <ul>
            <li v-for="(item, i) in precheck.repeatReports" :key="`r${i}`">📌 {{ item.灯具编号 }}：{{ item.说明 }}</li>
          </ul>
        </div>

        <div class="issue-group">
          <h4>备件库存（按型号扣减，不足的灯具逐台回执失败原因）</h4>
          <div class="stock-line" v-for="item in precheck.shortageForecast" :key="item.灯具类型">
            <span>{{ item.灯具类型 }}</span>
            <span>需要 {{ item.需要 }}</span>
            <span>库存 {{ item.库存 }}</span>
            <span :class="item.缺口 > 0 ? 'stock-lack' : 'stock-ok'">
              {{ item.缺口 > 0 ? `缺口 ${item.缺口}，将有 ${Math.min(item.缺口, item.需要)} 盏办不成` : '库存充足' }}
            </span>
          </div>
        </div>

        <div class="submit-bar">
          <button
            class="btn primary"
            type="button"
            :disabled="submitting || !selected.length || store.isReadOnly"
            @click="submit"
          >
            {{ store.isReadOnly ? '外单位只读，禁止提交' : `整批送系统办理（${selected.length} 盏，逐台回执）` }}
          </button>
          <span class="hint">损坏与更换一次办成；每盏落库并给独立回执，没办成的另列原因。</span>
        </div>
      </div>

      <!-- 最近一次批次回执 -->
      <div v-if="lastResult" class="receipt-panel" :class="{ rejected: lastResult.batch.已拒绝 }">
        <h3>
          批次回执 {{ lastResult.batch.批次号 }}
          <span :class="['batch-flag', lastResult.accepted ? 'ok' : 'no']">
            {{ lastResult.accepted ? '已受理' : '已拒绝' }}
          </span>
        </h3>
        <p>{{ lastResult.message }}</p>
        <p class="receipt-meta">
          舱室 {{ lastResult.batch.舱室 }} · 提交 {{ lastResult.batch.提交单位 }}/{{ lastResult.batch.提交岗位 }} ·
          {{ lastResult.batch.提交时间 }} · 去重前 {{ lastResult.batch.去重前台数 }} 台、去重后 {{ lastResult.batch.去重后台数 }} 台
        </p>
        <table class="data-table inner-table">
          <thead>
            <tr><th>回执号</th><th>灯具编号</th><th>灯具类型</th><th>安装位置</th><th>结论</th><th>原因/说明</th><th>检修待办</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in lastResult.batch.回执" :key="r.回执号">
              <td>{{ r.回执号 }}</td>
              <td>{{ r.灯具编号 }}</td>
              <td>{{ r.灯具类型 }}</td>
              <td>{{ r.安装位置 }}</td>
              <td :class="r.结论 === '更换完成' ? 'conclusion-ok' : 'conclusion-fail'">{{ r.结论 }}</td>
              <td>{{ r.原因 }}</td>
              <td>{{ r.检修待办编号 || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ============================ 批次记录 ============================ -->
    <div v-if="activeTab === 'batches'" class="tab-panel">
      <table class="data-table">
        <thead>
          <tr><th>批次号</th><th>舱室</th><th>提交时间</th><th>单位/岗位</th><th>去重前</th><th>去重后</th><th>成功</th><th>失败</th><th>受理</th></tr>
        </thead>
        <tbody>
          <template v-for="b in batches" :key="b.批次号">
            <tr class="batch-row" @click="toggleBatch(b.批次号)">
              <td>{{ b.批次号 }}</td>
              <td>{{ b.舱室 }}</td>
              <td>{{ b.提交时间 }}</td>
              <td>{{ b.提交单位 }} / {{ b.提交岗位 }}</td>
              <td>{{ b.去重前台数 }}</td>
              <td>{{ b.去重后台数 }}</td>
              <td class="conclusion-ok">{{ b.成功数 }}</td>
              <td class="conclusion-fail">{{ b.失败数 }}</td>
              <td>{{ b.已拒绝 ? '已拒绝' : '已受理' }}</td>
            </tr>
            <tr v-if="openedBatch === b.批次号">
              <td colspan="9" class="batch-detail">
                <table class="data-table inner-table">
                  <thead><tr><th>回执号</th><th>灯具编号</th><th>结论</th><th>原因/说明</th><th>检修待办</th></tr></thead>
                  <tbody>
                    <tr v-for="r in b.回执" :key="r.回执号">
                      <td>{{ r.回执号 }}</td><td>{{ r.灯具编号 }}</td>
                      <td :class="r.结论 === '更换完成' ? 'conclusion-ok' : 'conclusion-fail'">{{ r.结论 }}</td>
                      <td>{{ r.原因 }}</td><td>{{ r.检修待办编号 || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
          <tr v-if="!batches.length"><td colspan="9" class="empty-state">暂无整组批次，先在「整组处理」里提交一批</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 维保台账 ============================ -->
    <div v-if="activeTab === 'ledger'" class="tab-panel">
      <p class="hint">
        处理结论统一落到维保台账；<strong>对外只呈现「首次结论」</strong>（重复上报的另一份留档备查，不在对外口径里覆盖首次结论）。
      </p>
      <table class="data-table">
        <thead>
          <tr><th>台账号</th><th>灯具编号</th><th>舱室</th><th>类型</th><th>安装位置</th><th>巡检日期</th><th>处理结论</th><th>时间</th><th>批次号</th><th>责任岗位</th><th>版本</th><th>备注</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in ledger" :key="e.台账号" :class="{ archived: !e.对外版本 }">
            <td>{{ e.台账号 }}</td><td>{{ e.灯具编号 }}</td><td>{{ e.所属舱室 }}</td>
            <td>{{ e.灯具类型 }}</td><td>{{ e.安装位置 }}</td><td>{{ e.巡检日期 }}</td>
            <td :class="e.对外版本 ? 'conclusion-ok' : ''">{{ e.处理结论 }}</td>
            <td>{{ e.处理时间 }}</td><td>{{ e.批次号 }}</td><td>{{ e.责任岗位 }}</td>
            <td><span :class="e.对外版本 ? 'issue-tag ok' : 'issue-tag'">{{ e.对外版本 ? '对外结论' : '留档备查' }}</span></td>
            <td class="remark-cell">{{ e.备注 }}</td>
          </tr>
          <tr v-if="!ledger.length"><td colspan="12" class="empty-state">暂无台账结论</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 待补清单 ============================ -->
    <div v-if="activeTab === 'supplement'" class="tab-panel">
      <p class="hint">
        早年只有安装位置、没有灯具编号的按规则补号：<code>LIGH-舱室码-P投运年月+3位流水</code>
        （按投运日期升序、同日按安装位置排序）；补号灯具仍列入待补清单待现场核实，以下为全部缺失项。
      </p>
      <table class="data-table">
        <thead><tr><th>补录号</th><th>灯具编号（补号）</th><th>舱室</th><th>安装位置</th><th>缺失项</th><th>发现方式</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="s in supplements" :key="s.id">
            <td>{{ s.id }}</td><td>{{ s.灯具编号 }}</td><td>{{ s.所属舱室 }}</td>
            <td>{{ s.安装位置 }}</td>
            <td><span v-for="m in s.缺失项" :key="m" class="issue-tag">{{ m }}</span></td>
            <td>{{ s.发现方式 }}</td><td>{{ s.状态 }}</td>
          </tr>
          <tr v-if="!supplements.length"><td colspan="7" class="empty-state">存量数据完整，没有待补项</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 留档与审计 ============================ -->
    <div v-if="activeTab === 'archive'" class="tab-panel">
      <h3>重复上报留档（后续差异只记备注，不改首次结论）</h3>
      <table class="data-table">
        <thead><tr><th>灯具编号</th><th>首次批次</th><th>首次结论</th><th>后续批次</th><th>差异记录</th><th>提交岗位</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="d in duplicates" :key="d.id">
            <td>{{ d.灯具编号 }}</td><td>{{ d.首次批次 }}</td><td>{{ d.首次结论 }}</td>
            <td>{{ d.后续批次 }}</td><td class="remark-cell">{{ d.差异 }}</td>
            <td>{{ d.提交单位 }}/{{ d.提交岗位 }}</td><td>{{ d.时间 }}</td>
          </tr>
          <tr v-if="!duplicates.length"><td colspan="7" class="empty-state">暂无重复上报记录</td></tr>
        </tbody>
      </table>

      <h3 style="margin-top: 18px">备件库存</h3>
      <div class="stock-grid">
        <div v-for="(count, type) in stock" :key="type" class="stock-card">
          <span>{{ type }}</span>
          <strong :class="Number(count) <= 2 ? 'stock-lack' : ''">{{ count }}</strong>
        </div>
      </div>

      <h3 style="margin-top: 18px">操作审计（越权提交也留痕，记录归原岗位）</h3>
      <table class="data-table">
        <thead><tr><th>时间</th><th>单位</th><th>岗位</th><th>人员</th><th>动作</th><th>结果</th><th>详情</th></tr></thead>
        <tbody>
          <tr v-for="(a, i) in audit" :key="i">
            <td>{{ a.时间 }}</td><td>{{ a.单位 }}</td><td>{{ a.岗位 }}</td><td>{{ a.人员 }}</td>
            <td>{{ a.动作 }}</td>
            <td :class="a.结果.includes('拒绝') ? 'conclusion-fail' : ''">{{ a.结果 }}</td>
            <td class="remark-cell">{{ a.详情 }}</td>
          </tr>
          <tr v-if="!audit.length"><td colspan="7" class="empty-state">暂无操作记录</td></tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ summary.total }} 盏灯具 · 批次 {{ summary.batchCount }} · 台账结论 {{ summary.ledgerCount }}</span>
      <span v-if="summary.consistency.length" class="error-text">
        条数核对异常：{{ summary.consistency.join('；') }}
      </span>
      <span v-else class="consistency-ok">概览条数与另存清单一致</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useSessionStore } from '@/stores/session'
import {
  currentStock,
  downloadCsv,
  ledgerCsv,
  lightingSummary,
  listAudit,
  listBatches,
  listDuplicates,
  listLamps,
  listLedger,
  listSupplements,
  precheckBatch,
  submitBatch,
  supplementCsv,
  type PrecheckResult,
  type SubmitResult,
} from '@/api/lighting-service'
import type {
  AuditEntry,
  BatchRecord,
  DuplicateArchive,
  LampRow,
  LedgerEntry,
  SupplementItem,
} from '@/data/lighting-domain'

const store = useSessionStore()

const cabins = ['综合舱', '电力舱', '燃气舱', '水信舱']
const statusOptions = ['待巡检', '巡检中', '照明正常', '已损坏', '已更换']

const lamps = ref<LampRow[]>([])
const batches = ref<BatchRecord[]>([])
const ledger = ref<LedgerEntry[]>([])
const supplements = ref<SupplementItem[]>([])
const duplicates = ref<DuplicateArchive[]>([])
const audit = ref<AuditEntry[]>([])
const stock = ref<Record<string, number>>({})
const summary = ref(lightingSummary())

const activeTab = ref('batch')
const cabin = ref('综合舱')
const statusFilter = ref('已损坏')
const keyword = ref('')
const patrolDate = ref('2026-10-06')
const selected = ref<number[]>([])
const precheck = ref<PrecheckResult | null>(null)
const lastResult = ref<SubmitResult | null>(null)
const openedBatch = ref('')
const submitting = ref(false)

const tabs = computed(() => [
  { key: 'batch', label: '整组处理', badge: 0 },
  { key: 'batches', label: '批次记录', badge: batches.value.length },
  { key: 'ledger', label: `维保台账（${ledger.value.length}）`, badge: 0 },
  { key: 'supplement', label: `待补清单（${supplements.value.length}）`, badge: 0 },
  { key: 'archive', label: '留档与审计', badge: duplicates.value.length },
])

const cabinRows = computed(() =>
  lamps.value.filter((row) => {
    if (String(row.所属舱室) !== cabin.value) return false
    if (statusFilter.value && row.status !== statusFilter.value) return false
    const kw = keyword.value.trim()
    if (kw) {
      return String(row.灯具编号).includes(kw) || String(row.安装位置).includes(kw)
    }
    return true
  }),
)

const allCabinChecked = computed(
  () => cabinRows.value.length > 0 && cabinRows.value.every((row) => selected.value.includes(row.id)),
)

const crossSelected = computed(
  () =>
    lamps.value.filter(
      (row) => selected.value.includes(row.id) && String(row.权属单位) !== store.unit,
    ).length,
)

const repeatedSelected = computed(
  () => lamps.value.filter((row) => selected.value.includes(row.id) && String(row.结论).trim()).length,
)

/** 剔除拦截、重复上报、非损坏之后，本批真正能办成损坏更换的数量（库存另算逐台回执） */
const processableCount = computed(() => {
  if (!precheck.value) return 0
  const blocked = new Set(precheck.value.blocking.map((i) => i.rowId))
  const repeated = new Set(precheck.value.repeatReports.map((i) => i.rowId))
  return precheck.value.uniqueRows.filter(
    (r) => !blocked.has(r.id) && !repeated.has(r.id) && r.status === '已损坏',
  ).length
})

function refresh() {
  lamps.value = listLamps()
  batches.value = listBatches()
  ledger.value = listLedger()
  supplements.value = listSupplements()
  duplicates.value = listDuplicates()
  audit.value = listAudit()
  stock.value = currentStock()
  summary.value = lightingSummary()
}

function toggleOne(id: number) {
  const index = selected.value.indexOf(id)
  if (index >= 0) selected.value.splice(index, 1)
  else selected.value.push(id)
}

function toggleAll() {
  const ids = cabinRows.value.map((row) => row.id)
  if (allCabinChecked.value) {
    selected.value = selected.value.filter((id) => !ids.includes(id))
  } else {
    selected.value = [...new Set([...selected.value, ...ids])]
  }
}

function selectDamage() {
  statusFilter.value = '已损坏'
  selected.value = cabinRows.value
    .filter((row) => String(row.权属单位) === store.unit)
    .map((row) => row.id)
  runPrecheck()
}

function clearSelection() {
  selected.value = []
  precheck.value = null
}

// 换舱室或换单位时，把不属于当前圈选范围的勾选清掉，避免混批
watch([cabin, () => store.unit], () => {
  const valid = new Set(
    lamps.value.filter((row) => String(row.所属舱室) === cabin.value).map((row) => row.id),
  )
  selected.value = selected.value.filter((id) => valid.has(id))
  precheck.value = null
})

function runPrecheck() {
  if (!selected.value.length) {
    precheck.value = null
    return
  }
  precheck.value = precheckBatch(selected.value, cabin.value, store.unit)
}

function submit() {
  if (store.isReadOnly) return
  submitting.value = true
  try {
    const result = submitBatch({
      ids: selected.value,
      cabin: cabin.value,
      unit: store.unit,
      post: store.post,
      operator: store.operator,
      patrolDate: patrolDate.value,
    })
    lastResult.value = result
    selected.value = []
    precheck.value = null
    refresh()
  } finally {
    submitting.value = false
  }
}

function toggleBatch(no: string) {
  openedBatch.value = openedBatch.value === no ? '' : no
}

function exportLedger() {
  downloadCsv(ledgerCsv())
}

function exportSupplements() {
  downloadCsv(supplementCsv())
}

onMounted(refresh)
</script>
