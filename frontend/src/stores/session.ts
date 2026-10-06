import { defineStore } from 'pinia'

// 演示用岗位身份：灯具按「权属单位」归属，跨单位只看不能办，越权提交在业务层直接拒绝。
export type SessionIdentity = {
  operator: string
  unit: string
  post: string
  shiftLabel: string
}

// 三个身份：本单位照明岗（可办）、本单位检修班（只同步看待办）、跨单位照明岗（只读）。
export const IDENTITY_PRESETS: SessionIdentity[] = [
  { operator: '王岚', unit: '管廊运维一部', post: '照明巡检岗', shiftLabel: '白班 08:00-20:00' },
  { operator: '赵铁山', unit: '管廊运维一部', post: '设施检修班', shiftLabel: '白班 08:00-20:00' },
  { operator: '李远征', unit: '管廊运维二部', post: '照明巡检岗', shiftLabel: '夜班 20:00-08:00' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: IDENTITY_PRESETS[0].operator,
    unit: IDENTITY_PRESETS[0].unit,
    post: IDENTITY_PRESETS[0].post,
    shiftLabel: IDENTITY_PRESETS[0].shiftLabel,
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 照明整组办理只认本单位的照明巡检岗（值班管理员沿用默认身份）。
    canHandleLighting: (state) => state.post === '照明巡检岗',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchIdentity(identity: SessionIdentity) {
      this.operator = identity.operator
      this.unit = identity.unit
      this.post = identity.post
      this.shiftLabel = identity.shiftLabel
    },
  },
})
