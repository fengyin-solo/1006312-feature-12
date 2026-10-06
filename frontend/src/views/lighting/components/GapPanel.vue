<template>
  <div class="panel">
    <div class="panel-head">
      <h3>缺失项待补清单（一张清单集中跟踪）</h3>
      <p class="hint">
        存量灯具已按巡检日期回填投运日期、早年缺号灯具已按
        <code>LIGH-BK-舱段码-NNN</code> 补号；设备按投运日期回填。回填后仍缺、推断不出来的项集中在这里，补登后自动销项。
      </p>
    </div>

    <div class="filter-bar">
      <label class="filter-item inline">
        <span>数据模块</span>
        <select v-model="moduleFilter">
          <option value="">全部</option>
          <option value="lighting">廊内照明</option>
          <option value="device">设备台账</option>
        </select>
      </label>
      <button class="btn ghost" type="button" @click="rescan">重新扫描缺失项</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>数据模块</th><th>编号</th><th>对象</th><th>所属舱室</th>
          <th>缺失项</th><th>补登规则</th><th>状态</th><th>补登</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in shownGaps" :key="`${item.数据模块}-${item.编号}-${item.缺失项.join()}`">
          <td>{{ moduleName(item.数据模块) }}</td>
          <td>{{ item.编号 }}</td>
          <td>{{ item.对象名称 }}</td>
          <td>{{ item.所属舱室 }}</td>
          <td>
            <span v-for="field in item.缺失项" :key="field" class="tag tag-red">{{ field }}</span>
          </td>
          <td class="muted">{{ item.补登规则 }}</td>
          <td><span class="tag tag-amber">{{ item.状态 }}</span></td>
          <td>
            <div v-for="field in item.缺失项" :key="field" class="gap-fill">
              <span>{{ field }}</span>
              <input :value="drafts[draftKey(item, field)] ?? ''" @input="setDraft(item, field, ($event.target as HTMLInputElement).value)" />
              <button class="btn sm" type="button" @click="doFill(item, field)">补登</button>
            </div>
          </td>
        </tr>
        <tr v-if="!shownGaps.length">
          <td colspan="8" class="empty-state">没有待补项，存量数据回填齐整</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { fillGap, listGaps, rescanGaps, type GapItem } from '@/data/lighting'

const emit = defineEmits<{ (event: 'changed'): void }>()

const gaps = ref<GapItem[]>(listGaps())
const moduleFilter = ref('')
const drafts = ref<Record<string, string>>({})

const shownGaps = computed(() =>
  moduleFilter.value ? gaps.value.filter((item) => item.数据模块 === moduleFilter.value) : gaps.value,
)

function moduleName(key: string) {
  return key === 'lighting' ? '廊内照明' : '设备台账'
}

function draftKey(item: GapItem, field: string) {
  return `${item.数据模块}-${item.编号}-${field}`
}

function setDraft(item: GapItem, field: string, value: string) {
  drafts.value[draftKey(item, field)] = value
}

function doFill(item: GapItem, field: string) {
  const value = (drafts.value[draftKey(item, field)] ?? '').trim()
  if (!value) {
    return
  }
  fillGap(item.数据模块, item.编号, field, value)
  gaps.value = listGaps()
  emit('changed')
}

function rescan() {
  gaps.value = rescanGaps()
  emit('changed')
}
</script>
