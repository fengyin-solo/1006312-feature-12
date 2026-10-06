import { defineStore } from 'pinia'

import { OWNER_UNITS, POSTS_BY_UNIT } from '@/data/lighting-domain'

// 会话：单位 + 岗位。跨单位看到的灯具只读，越权提交一律拒绝，改动记录仍归原岗位。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王巡检',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
    unit: OWNER_UNITS[0] as string,
    post: POSTS_BY_UNIT[OWNER_UNITS[0]][0],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 外单位身份只具备只读权限
    isReadOnly(): boolean {
      return this.unit !== OWNER_UNITS[0]
    },
    posts: (state) => POSTS_BY_UNIT[state.unit] ?? [],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      this.unit = unit
      const posts = POSTS_BY_UNIT[unit] ?? []
      if (!posts.includes(this.post)) {
        this.post = posts[0] ?? ''
      }
    },
    setPost(post: string) {
      this.post = post
    },
  },
})
