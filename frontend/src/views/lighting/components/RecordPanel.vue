<template>
  <div class="panel">
    <div class="panel-head">
      <h3>整组批次台账</h3>
      <p class="hint">一次提交一个批次，每盏灯单独回执；没办成的在回执里以红色单独列出。重复上报只认第一次，后续差异只记备注。</p>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>批次号</th><th>所属舱室</th><th>权属单位</th><th>圈选/去重后</th>
          <th>成功</th><th>失败</th><th>重复跳过</th><th>提交岗位/人员</th><th>备注</th><th>提交时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in batches" :key="batch.id">
          <td>{{ batch.批次号 }}</td>
          <td>{{ batch.所属舱室 }}</td>
          <td>{{ batch.权属单位 }}</td>
          <td>{{ batch.圈选数量 }} / {{ batch.去重后数量 }}<span v-if="batch.批内重复盏次" class="warn-text">（重复{{ batch.批内重复盏次 }}）</span></td>
          <td><span class="tag tag-green">{{ batch.成功数 }}</span></td>
          <td><span class="tag" :class="batch.失败数 ? 'tag-red' : ''">{{ batch.失败数 }}</span></td>
          <td><span class="tag" :class="batch.跳过数 ? 'tag-amber' : ''">{{ batch.跳过数 }}</span></td>
          <td>{{ batch.提交岗位 }} · {{ batch.提交人员 }}</td>
          <td class="muted">{{ batch.备注 || '—' }}</td>
          <td>{{ batch.提交时间 }}</td>
        </tr>
        <tr v-if="!batches.length">
          <td colspan="10" class="empty-state">还没有整组办理批次，去「舱室整组办理」圈选一批试试</td>
        </tr>
      </tbody>
    </table>

    <div class="panel-head second">
      <h3>逐台回执清单（每盏灯都落库、单独回执）</h3>
      <label class="filter-item inline">
        <span>按批次筛选</span>
        <select v-model="batchFilter">
          <option value="">全部批次</option>
          <option v-for="batch in batches" :key="batch.批次号" :value="batch.批次号">{{ batch.批次号 }}</option>
        </select>
      </label>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>回执编号</th><th>批次号</th><th>灯具编号</th><th>所属舱室</th>
          <th>安装位置</th><th>结果</th><th>回执信息</th><th>检修待办</th><th>经办岗位</th><th>时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="receipt in shownReceipts" :key="receipt.回执编号">
          <td>{{ receipt.回执编号 }}</td>
          <td>{{ receipt.批次号 }}</td>
          <td>{{ receipt.灯具编号 }}</td>
          <td>{{ receipt.所属舱室 }}</td>
          <td>{{ receipt.安装位置 || '—' }}</td>
          <td><span class="tag" :class="tagClass(receipt.结果)">{{ receipt.结果 }}</span></td>
          <td>{{ receipt.回执信息 }}</td>
          <td>{{ receipt.检修编号 || '—' }}</td>
          <td>{{ receipt.经办岗位 }} · {{ receipt.经办人员 }}</td>
          <td>{{ receipt.时间 }}</td>
        </tr>
        <tr v-if="!shownReceipts.length">
          <td colspan="10" class="empty-state">暂无回执</td>
        </tr>
      </tbody>
    </table>

    <div v-if="failedLines.length" class="failed-box">
      <strong>没办成的灯具另起一行：</strong>
      <p v-for="line in failedLines" :key="line" class="failed-item">— {{ line }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { listBatches, listReceipts } from '@/data/lighting'

const batches = listBatches()
const receipts = listReceipts()
const batchFilter = ref('')

const shownReceipts = computed(() =>
  batchFilter.value ? receipts.filter((item) => item.批次号 === batchFilter.value) : receipts,
)

const failedLines = computed(() =>
  shownReceipts.value
    .filter((item) => item.结果 === '失败')
    .map((item) => `${item.批次号} ${item.灯具编号}（${item.所属舱室} ${item.安装位置 || '位置缺失'}）：${item.回执信息}`),
)

function tagClass(result: string) {
  if (result === '成功') {
    return 'tag-green'
  }
  if (result === '跳过') {
    return 'tag-amber'
  }
  return 'tag-red'
}
</script>
