<template>
  <div class="panel">
    <div class="panel-head">
      <h3>维保台账（处理结论落账）</h3>
      <p class="hint">
        每盏灯的结论落两笔：原始「巡检损坏判定」留档备查，「更换处理结论 / 更换未办成」对外呈现——
        孰轻孰重取更换结论为准。下面默认只列对外结论，留档那份不删，可单独调阅。
      </p>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账总数</span>
        <strong class="stat-value">{{ ledger.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">对外呈现</span>
        <strong class="stat-value">{{ publicRows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">留档备查（不对外）</span>
        <strong class="stat-value">{{ archivedRows.length }}</strong>
      </article>
    </div>

    <div class="filter-bar">
      <label class="filter-item inline">
        <span>呈现范围</span>
        <select v-model="scope">
          <option value="public">只看对外结论（更换成功/未办成）</option>
          <option value="archived">只看留档备查（原始巡检损坏判定）</option>
          <option value="all">全部调阅</option>
        </select>
      </label>
      <label class="filter-item inline">
        <span>按灯具编号检索</span>
        <input v-model="keyword" placeholder="灯具编号" />
      </label>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>台账编号</th><th>批次号</th><th>灯具编号</th><th>所属舱室</th>
          <th>安装位置</th><th>结论性质</th><th>处理结论</th><th>备注</th><th>经办岗位</th><th>落库时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shownRows" :key="row.台账编号" :class="{ archived: row.结论性质.includes('留档备查') }">
          <td>{{ row.台账编号 }}</td>
          <td>{{ row.批次号 }}</td>
          <td>{{ row.灯具编号 }}</td>
          <td>{{ row.所属舱室 }}</td>
          <td>{{ row.安装位置 || '—' }}</td>
          <td><span class="tag" :class="row.结论性质.includes('留档备查') ? 'tag-amber' : 'tag-green'">{{ row.结论性质 }}</span></td>
          <td>{{ row.处理结论 }}</td>
          <td class="preline muted">{{ row.备注 || '—' }}</td>
          <td>{{ row.经办岗位 }} · {{ row.经办人员 }}（{{ row.权属单位 }}）</td>
          <td>{{ row.落库时间 }}</td>
        </tr>
        <tr v-if="!shownRows.length">
          <td colspan="10" class="empty-state">暂无维保台账记录</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { listLedger } from '@/data/lighting'

const ledger = listLedger()
const scope = ref<'public' | 'archived' | 'all'>('public')
const keyword = ref('')

const publicRows = computed(() => ledger.filter((row) => !row.结论性质.includes('留档备查')))
const archivedRows = computed(() => ledger.filter((row) => row.结论性质.includes('留档备查')))

const shownRows = computed(() => {
  let rows = ledger
  if (scope.value === 'public') {
    rows = publicRows.value
  } else if (scope.value === 'archived') {
    rows = archivedRows.value
  }
  const word = keyword.value.trim()
  if (word) {
    rows = rows.filter((row) => row.灯具编号.includes(word))
  }
  return rows
})
</script>
