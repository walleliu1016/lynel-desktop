// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import TimeoutPicker from './TimeoutPicker.vue'

const byText = (w: ReturnType<typeof mount>, t: string) =>
  w.findAll('.radio').find((b) => b.text() === t)!

describe('TimeoutPicker', () => {
  it('选预设档写回对应毫秒值', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '1h').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([3600000])
    expect(w.emitted('update:valid')!.at(-1)).toEqual([true])
  })

  it('allowDefault 时多一档「默认」，点击写回 null', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000, allowDefault: true } })
    expect(byText(w, '默认').exists()).toBe(true)
    await byText(w, '默认').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([null])
  })

  it('不允许默认时没有「默认」档', () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    expect(w.findAll('.radio').some((b) => b.text() === '默认')).toBe(false)
  })

  it('自定义回填：整小时用「小时」，非整小时用「分钟」', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 7200000 } }) // 2h，非预设
    await nextTick() // onMounted 的 sync 要等一拍才渲染自定义输入框
    expect((w.find('input').element as HTMLInputElement).value).toBe('2')
    const w2 = mount(TimeoutPicker, { props: { modelValue: 2700000 } }) // 45min，非预设
    await nextTick()
    expect((w2.find('input').element as HTMLInputElement).value).toBe('45')
    expect((w2.find('select').element as HTMLSelectElement).value).toBe('minute')
  })

  it('预设值命中预设档而不是自定义', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 86400000 } })
    await nextTick()
    expect(w.find('input').exists()).toBe(false)
  })

  it('自定义越界：update:valid=false、就地报错、不写回值', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '自定义').trigger('click')
    await w.find('input').setValue(0) // 0 分钟越界
    expect(w.emitted('update:valid')!.at(-1)).toEqual([false])
    expect(w.find('.tp-warn').exists()).toBe(true)
    const vals = w.emitted('update:modelValue')!
    expect(vals.at(-1)).not.toEqual([0])
  })

  it('自定义合法值写回毫秒（小时单位）', async () => {
    const w = mount(TimeoutPicker, { props: { modelValue: 1800000 } })
    await byText(w, '自定义').trigger('click')
    await w.find('select').setValue('hour')
    await w.find('input').setValue(2)
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([7200000])
  })
})
