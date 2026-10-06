<template>
  <section class="page" data-module="lighting">
    <header class="page-head">
      <div>
        <h2>廊内照明运维管理</h2>
        <p class="page-desc">按舱室整组圈选待处理灯具，核对通过后一次提交损坏与更换，逐台回执；更换同步检修待办，结论落维保台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出灯具清单</button>
      </div>
    </header>

    <div v-if="readonlyReason" class="notice-bar warn">
      {{ readonlyReason }}
    </div>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <span v-if="tab.badge !== undefined" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </div>

    <BatchPanel v-if="activeTab === 'batch'" :key="`batch-${revision}`" @changed="bump" />
    <FixturePanel v-else-if="activeTab === 'fixtures'" :key="`fixtures-${revision}`" @changed="bump" />
    <RecordPanel v-else-if="activeTab === 'records'" :key="`records-${revision}`" />
    <LedgerPanel v-else-if="activeTab === 'ledger'" :key="`ledger-${revision}`" />
    <GapPanel v-else-if="activeTab === 'gaps'" :key="`gaps-${revision}`" @changed="bump" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import { ensureBackfilled, lightingOpsSummary, listGaps } from '@/data/lighting'
import { useSessionStore } from '@/stores/session'

import BatchPanel from './components/BatchPanel.vue'
import FixturePanel from './components/FixturePanel.vue'
import GapPanel from './components/GapPanel.vue'
import LedgerPanel from './components/LedgerPanel.vue'
import RecordPanel from './components/RecordPanel.vue'

const store = useSessionStore()
const meta = moduleMeta('lighting')
const activeTab = ref('batch')
const revision = ref(0)

const readonlyReason = computed(() =>
  store.post === '照明巡检岗'
    ? ''
    : `当前身份 ${store.unit} · ${store.post}（${ store.operator }）：灯具整组办理只接受照明巡检岗提交，本页只读，可在「设施检修管理」查看派出的更换待办；所有改动记录仍归属原办理岗位。`,
)

const tabs = computed(() => {
  const summary = lightingOpsSummary()
  return [
    { key: 'batch', label: '舱室整组办理', badge: undefined },
    { key: 'fixtures', label: '灯具台账', badge: undefined },
    { key: 'records', label: '批次与逐台回执', badge: summary.receiptCount },
    { key: 'ledger', label: '维保台账', badge: summary.ledgerTotal },
    { key: 'gaps', label: '待补清单', badge: listGaps().length },
  ]
})

function bump() {
  revision.value += 1
}

function switchTab(key: string) {
  activeTab.value = key
}

function exportRows() {
  downloadEntries(meta.key)
}

onMounted(() => {
  // 首次进入：存量灯具按巡检日期回填投运日期、早年缺号灯具按规则补号（幂等）。
  ensureBackfilled()
  bump()
})
</script>
