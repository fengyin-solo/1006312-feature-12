<template>
  <div class="panel">
    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>灯具编号</span>
        <input v-model="filters['灯具编号']" placeholder="按灯具编号检索" />
      </label>
      <label class="filter-item">
        <span>所属舱室</span>
        <input v-model="filters['所属舱室']" placeholder="按所属舱室检索" />
      </label>
      <label class="filter-item">
        <span>灯具类型</span>
        <input v-model="filters['灯具类型']" placeholder="按灯具类型检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>单灯动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的照明灯具</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 盏灯具</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { filterRows, runAction as applyAction } from '@/api/local-service'
import { ensureBackfilled } from '@/data/lighting'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const emit = defineEmits<{ (event: 'changed'): void }>()

const columns = [
  '灯具编号', '所属舱室', '灯具类型', '安装位置', '额定功率',
  '权属单位', '投运日期', '巡检日期', '巡检人员', '编号来源', '照明状态',
]
const actions = ['提交巡检', '判定正常', '登记损坏']
const statuses = ['待巡检', '巡检中', '照明正常', '已损坏', '已更换']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const stats = computed(() => [
  { label: '待巡检灯具', value: rows.value.filter((row) => row.status === '待巡检').length },
  { label: '照明正常灯具', value: rows.value.filter((row) => row.status === '照明正常').length },
  { label: '已损坏灯具', value: rows.value.filter((row) => row.status === '已损坏').length },
  { label: '已更换灯具', value: rows.value.filter((row) => row.status === '已更换').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('lighting', Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  emit('changed')
}

function reload() {
  errorMessage.value = ''
  ensureBackfilled()
  rows.value = filterRows(listRows('lighting'), filters.value)
  total.value = rows.value.length
}

reload()
</script>
