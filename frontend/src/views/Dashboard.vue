<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
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

    <h3 class="section-title">廊内照明整组处理</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">灯具总数（＝另存灯具清单）</span>
        <strong class="stat-value">{{ light.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已损坏待办</span>
        <strong class="stat-value stat-danger">{{ light.damaged }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已更换（＝台账对外结论）</span>
        <strong class="stat-value">{{ light.replaced }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待补清单条数</span>
        <strong class="stat-value">{{ light.supplementCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修复验待办</span>
        <strong class="stat-value">{{ light.todoCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">批次 / 重复留档</span>
        <strong class="stat-value">{{ light.batchCount }} / {{ light.duplicateCount }}</strong>
      </article>
    </div>
    <p v-if="light.consistency.length" class="error-text">
      条数核对异常：{{ light.consistency.join('；') }}
    </p>
    <p v-else class="consistency-ok">概览条数与另存的灯具/台账/待补清单完全一致</p>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { lightingSummary, type LightingSummary } from '@/api/lighting-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const light = ref<LightingSummary>(lightingSummary())

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  light.value = lightingSummary()
}

onMounted(refresh)
onActivated(refresh)
</script>
