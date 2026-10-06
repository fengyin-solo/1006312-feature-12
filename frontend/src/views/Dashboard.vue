<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；廊内照明整组处理的条数与另存清单逐条核对。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section class="lighting-summary">
      <h3>廊内照明整组处理口径</h3>
      <p class="page-desc">下列条数全部直接从另存清单统计，概览是多少、清单里就是多少：</p>
      <div class="stat-row">
        <article class="stat-card"><span class="stat-label">整组批次</span><strong class="stat-value">{{ ops.batchCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">逐台回执</span><strong class="stat-value">{{ ops.receiptCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">更换成功</span><strong class="stat-value">{{ ops.successCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">没办成</span><strong class="stat-value">{{ ops.failedCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">重复跳过</span><strong class="stat-value">{{ ops.skippedCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">维保台账（对外/留档）</span><strong class="stat-value">{{ ops.ledgerTotal }}（{{ ops.ledgerPublic }}/{{ ops.ledgerArchived }}）</strong></article>
        <article class="stat-card"><span class="stat-label">检修待办同步</span><strong class="stat-value">{{ ops.repairSyncedCount }}</strong></article>
        <article class="stat-card"><span class="stat-label">待补清单</span><strong class="stat-value">{{ ops.gapCount }}</strong></article>
      </div>
      <table class="data-table check-table">
        <thead>
          <tr><th>核对项</th><th>是否一致</th><th>明细</th></tr>
        </thead>
        <tbody>
          <tr v-for="check in ops.checks" :key="check.label">
            <td>{{ check.label }}</td>
            <td>
              <span class="tag" :class="check.consistent ? 'tag-green' : 'tag-red'">
                {{ check.consistent ? '条数一致' : '不一致' }}
              </span>
            </td>
            <td class="muted">{{ check.detail }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { ensureBackfilled, lightingOpsSummary, type LightingOpsSummary } from '@/data/lighting'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const ops = ref<LightingOpsSummary>(lightingOpsSummary())

function refresh() {
  ensureBackfilled()
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  ops.value = lightingOpsSummary()
}

onMounted(refresh)
</script>
