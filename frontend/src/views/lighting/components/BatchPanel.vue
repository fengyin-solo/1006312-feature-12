<template>
  <div class="panel">
    <div class="panel-head">
      <h3>第一步：按舱室圈出本批待处理灯具</h3>
      <p class="hint">一个舱室一批：勾选损坏/待巡检的灯具，同一盏灯在本批重复出现只算一次。核对通过（无重号、灯具类型与安装位置相符）后才能落库。</p>
    </div>

    <div class="cabin-grid">
      <button
        v-for="item in cabins"
        :key="item.cabin"
        class="cabin-card"
        :class="{ active: cabin === item.cabin, foreign: item.unit !== store.unit }"
        type="button"
        @click="chooseCabin(item.cabin)"
      >
        <strong>{{ item.cabin }}</strong>
        <span class="cabin-unit">{{ item.unit }}</span>
        <span class="cabin-line">灯具 {{ item.total }} 盏 · 待处理 {{ item.pending }} · 已损坏 {{ item.damaged }} · 已更换 {{ item.replaced }}</span>
        <span class="cabin-line">最近巡检：{{ item.lastInspectDate || '—' }}</span>
        <span v-if="item.unit !== store.unit" class="tag readonly-tag">跨单位只读</span>
      </button>
    </div>

    <template v-if="cabin">
      <div class="panel-head second">
        <h3>第二步：勾选本批灯具（{{ ownerUnit }}）</h3>
        <div class="bulk-tools">
          <button class="btn ghost sm" type="button" @click="selectDamage">全选损坏/待办</button>
          <button class="btn ghost sm" type="button" @click="clearPick">清空勾选</button>
        </div>
      </div>

      <label class="remark-line">
        <span>批次备注（重复上报的差异只记到这里）</span>
        <input v-model="remark" placeholder="如：巡检称两盏时亮时灭，与首次结论有差异" />
      </label>

      <table class="data-table pick-table">
        <thead>
          <tr>
            <th class="col-check">
              <input type="checkbox" :checked="allPicked" :disabled="!cabinRows.length" @change="toggleAll" />
            </th>
            <th>灯具编号</th>
            <th>灯具类型</th>
            <th>安装位置</th>
            <th>额定功率</th>
            <th>巡检日期</th>
            <th>编号来源</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in cabinRows" :key="String(row.id)" :class="{ replaced: row.status === '已更换' }">
            <td>
              <input type="checkbox" :value="Number(row.id)" v-model="pickedIds" />
            </td>
            <td>{{ row['灯具编号'] }}</td>
            <td>{{ row['灯具类型'] }}</td>
            <td>{{ row['安装位置'] || '—' }}</td>
            <td>{{ row['额定功率'] === '' ? '缺失' : row['额定功率'] }}</td>
            <td>{{ row['巡检日期'] }}</td>
            <td class="muted">{{ row['编号来源'] || '—' }}</td>
            <td>
              {{ row.status }}
              <span v-if="row.status === '已更换'" class="tag">已办结，再报算重复</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="submit-bar">
        <button class="btn" type="button" :disabled="!pickedIds.length" @click="runCheck">送系统前核对</button>
        <button
          class="btn primary"
          type="button"
          :disabled="!pickedIds.length"
          @click="submit"
        >
          整批送办损坏与更换（{{ uniquePicked.length }} 盏）
        </button>
        <span v-if="pickedIds.length !== uniquePicked.length" class="warn-text">
          已自动去重：圈选 {{ pickedIds.length }} 盏次，去重后 {{ uniquePicked.length }} 盏
        </span>
      </div>

      <div v-if="issues.length" class="issue-box">
        <h4>核对未通过，先挑出来处理（{{ issues.length }} 项），核对通过才落库：</h4>
        <ul>
          <li v-for="(issue, index) in issueView" :key="`${issue.灯具id}-${issue.kind}-${index}`">
            <span class="tag" :class="issue.kind === '重号' ? 'tag-red' : 'tag-amber'">{{ issue.kind }}</span>
            {{ issue.灯具编号 || '（空编号）' }} · {{ issue.所属舱室 }}：{{ issue.说明 }}
            <span class="issue-tools">
              <button class="link" type="button" @click="dropFromPick(issue.灯具id)">剔出本批</button>
              <button v-if="issue.kind === '重号'" class="link" type="button" @click="renumber(issue.灯具id)">
                按规则换发补号
              </button>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="checkNote" class="notice-bar ok">
        {{ checkNote }}
      </div>

      <div v-if="lastResult" class="receipt-result">
        <h4>批次 {{ lastResult.batch?.批次号 }} 逐台回执（一次提交、逐台回执）</h4>
        <p :class="lastResult.failedCount + lastResult.skippedCount > 0 ? 'warn-text' : 'ok-text'">
          {{ lastResult.message }}
        </p>
        <table class="data-table">
          <thead>
            <tr><th>回执编号</th><th>灯具编号</th><th>安装位置</th><th>结果</th><th>回执信息</th><th>检修待办</th><th>经办岗位</th></tr>
          </thead>
          <tbody>
            <tr v-for="receipt in lastReceipts" :key="receipt.回执编号">
              <td>{{ receipt.回执编号 }}</td>
              <td>{{ receipt.灯具编号 }}</td>
              <td>{{ receipt.安装位置 || '—' }}</td>
              <td>
                <span class="tag" :class="resultTag(receipt.结果)">{{ receipt.结果 }}</span>
              </td>
              <td>{{ receipt.回执信息 }}</td>
              <td>{{ receipt.检修编号 || '—' }}</td>
              <td>{{ receipt.经办岗位 }} · {{ receipt.经办人员 }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="failedReceipts.length" class="failed-list">
          没办成的另起一行：<span v-for="receipt in failedReceipts" :key="receipt.回执编号" class="failed-item">
            {{ receipt.灯具编号 }}（{{ receipt.回执信息 }}）
          </span>
        </p>
      </div>

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  cabinSummaries,
  precheckBatch,
  renumberFixture,
  submitBatch,
  type CheckIssue,
  type ReceiptRow,
} from '@/data/lighting'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const emit = defineEmits<{ (event: 'changed'): void }>()

const store = useSessionStore()
const cabins = ref(cabinSummaries())
const cabin = ref('')
const pickedIds = ref<number[]>([])
const remark = ref('')
const issues = ref<CheckIssue[]>([])
const checkNote = ref('')
const errorMessage = ref('')
const lastReceipts = ref<ReceiptRow[]>([])

const cabinRows = computed<EntryRow[]>(() =>
  (listRows('lighting') as (EntryRow & { 所属舱室?: string })[]).filter((row) => row['所属舱室'] === cabin.value),
)
const ownerUnit = computed(() => cabins.value.find((item) => item.cabin === cabin.value)?.unit ?? '')
const uniquePicked = computed(() => [...new Set(pickedIds.value)])
const allPicked = computed(
  () => cabinRows.value.length > 0 && uniquePicked.value.length === cabinRows.value.length,
)
const lastResult = computed(() =>
  lastReceipts.value.length
    ? {
        message: `批次 ${lastReceipts.value[0].批次号}：成功 ${
          lastReceipts.value.filter((item) => item.结果 === '成功').length
        } 盏、失败 ${lastReceipts.value.filter((item) => item.结果 === '失败').length} 盏、重复跳过 ${
          lastReceipts.value.filter((item) => item.结果 === '跳过').length
        } 盏`,
        batch: { 批次号: lastReceipts.value[0].批次号 },
        successCount: lastReceipts.value.filter((item) => item.结果 === '成功').length,
        failedCount: lastReceipts.value.filter((item) => item.结果 === '失败').length,
        skippedCount: lastReceipts.value.filter((item) => item.结果 === '跳过').length,
      }
    : null,
)
const failedReceipts = computed(() => lastReceipts.value.filter((item) => item.结果 !== '成功'))

// 同灯多条问题合并展示，避免一盏灯占好几行。
const issueView = computed(() => {
  const map = new Map<string, CheckIssue>()
  for (const issue of issues.value) {
    const key = `${issue.灯具id}`
    const exist = map.get(key)
    if (!exist) {
      map.set(key, issue)
    } else {
      map.set(key, { ...exist, 说明: `${exist.说明}；${issue.说明}` })
    }
  }
  return [...map.values()]
})

function chooseCabin(name: string) {
  cabin.value = name
  pickedIds.value = []
  issues.value = []
  checkNote.value = ''
  errorMessage.value = ''
  lastReceipts.value = []
}

function selectDamage() {
  pickedIds.value = cabinRows.value
    .filter((row) => row.status === '已损坏' || row.status === '待巡检' || row.status === '巡检中')
    .map((row) => Number(row.id))
}

function clearPick() {
  pickedIds.value = []
}

function toggleAll(event: Event) {
  pickedIds.value = (event.target as HTMLInputElement).checked
    ? cabinRows.value.map((row) => Number(row.id))
    : []
}

function runCheck() {
  errorMessage.value = ''
  const result = precheckBatch(uniquePicked.value)
  issues.value = result.issues
  if (result.issues.length === 0) {
    checkNote.value = `核对通过：去重后 ${result.uniqueCount} 盏，无重号、灯具类型与安装位置全部相符，可以整批落库（批内重复圈选 ${result.duplicatedPicks} 盏次已合并）。`
  } else {
    checkNote.value = ''
  }
}

function dropFromPick(id: number) {
  pickedIds.value = pickedIds.value.filter((item) => item !== id)
  issues.value = issues.value.filter((item) => item.灯具id !== id)
  if (issues.value.length === 0) {
    checkNote.value = '问题灯具已全部剔出本批，可重新核对后提交；数据本身的问题仍在待补清单里跟踪。'
  }
}

function renumber(id: number) {
  const code = renumberFixture(id)
  errorMessage.value = ''
  runCheck()
  emit('changed')
  checkNote.value = `已按补号规则换发编号 ${code}（编号来源标记为「规则补号（重号纠正）」），请重新核对。`
}

function submit() {
  errorMessage.value = ''
  checkNote.value = ''
  issues.value = []
  const result = submitBatch(uniquePicked.value, cabin.value, {
    operator: store.operator,
    unit: store.unit,
    post: store.post,
  }, remark.value)

  if (!result.ok) {
    issues.value = result.issues ?? []
    errorMessage.value = result.message
    return
  }

  lastReceipts.value = result.receipts ?? []
  cabins.value = cabinSummaries()
  pickedIds.value = []
  remark.value = ''
  emit('changed')
}

function resultTag(result: string) {
  if (result === '成功') {
    return 'tag-green'
  }
  if (result === '跳过') {
    return 'tag-amber'
  }
  return 'tag-red'
}
</script>
