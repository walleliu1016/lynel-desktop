// 内置任务模板：新建任务的「起点」。
// 纯数据 + 纯函数，不碰 IPC —— 用户自建模板由主进程 templates.ts 落盘，
// 两者在表单左栏里合并展示（我的模板 / 内置两组）。
//
// prompt 里用 `<项目绝对路径>` 做占位：任务在自己的固定目录里跑，要操作某个仓库必须在
// prompt 里写绝对路径。这里不猜用户的项目，让他自己替换（UI 上没有再引入「项目」概念）。
import type { ScheduleDto } from '../types/tasks';
import { UI_DAYS, uiDayToCron } from './tasks';

export interface BuiltinTemplate {
  id: string;
  /** Icon.vue 已注册的键 */
  icon: string;
  name: string;
  blurb: string;
  prompt: string;
  schedule: ScheduleDto;
}

const ALL_DAYS: number[] = UI_DAYS.map(uiDayToCron);
/** UI 星期（1=周一 … 7=周日）→ cron 约定，省得在每个模板里手写 0/6 的换算 */
const on = (...uiDays: number[]): number[] => uiDays.map(uiDayToCron);

const daily = (hour: number, minute: number, days: number[] = ALL_DAYS): ScheduleDto =>
  ({ type: 'daily', hour, minute, days, startAt: null, endAt: null });

const everyHours = (n: number, days: number[] = ALL_DAYS): ScheduleDto =>
  ({ type: 'interval', n, unit: 'hour', days, hour: 0, minute: 0, dayOfMonth: 1, startAt: null, endAt: null });

/** 每月 N 号的固定时间：unit='month' + n=1 即「每月」 */
const monthly = (day: number, hour: number, minute: number): ScheduleDto =>
  ({ type: 'interval', n: 1, unit: 'month', days: [...ALL_DAYS], hour, minute, dayOfMonth: day, startAt: null, endAt: null });

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'ci',
    icon: 'activity',
    name: 'CI 失败巡检',
    blurb: '查最近的 CI 失败并修复',
    prompt: '检查 <项目绝对路径> 最近的 CI 失败，定位原因并修复，完成后提交并推送。',
    schedule: daily(9, 0),
  },
  {
    id: 'sum',
    icon: 'file-text',
    name: '每日变更摘要',
    blurb: '汇总今天的提交与 PR',
    prompt: '汇总 <项目绝对路径> 今天的提交与 PR，按模块分组写一份简报。',
    schedule: daily(18, 0),
  },
  {
    id: 'sec',
    icon: 'shield-alert',
    name: '依赖安全审计',
    blurb: '扫依赖漏洞并给修复建议',
    prompt: '审计 <项目绝对路径> 的依赖漏洞，列出可升级项与风险等级。',
    schedule: daily(9, 0, on(1)),
  },
  {
    id: 'clean',
    icon: 'trash',
    name: '清理构建产物',
    blurb: '清掉过期的构建产物',
    prompt: '清理 <项目绝对路径> 下超过 7 天的构建产物与缓存，报告释放的空间。',
    schedule: daily(18, 0, on(5)),
  },
  {
    id: 'dep',
    icon: 'rocket',
    name: '发布前自检',
    blurb: '发版前跑一遍检查清单',
    prompt: '对 <项目绝对路径> 执行发布前自检：构建、测试、变更日志、版本号一致性。',
    schedule: daily(9, 0, on(3)),
  },
  {
    id: 'log',
    icon: 'terminal',
    name: '日志巡检',
    blurb: '扫异常日志并归类',
    prompt: '扫描 <项目绝对路径>/logs 最近的异常日志，按类型归类并标出新增的异常。',
    schedule: everyHours(6),
  },
  {
    id: 'doc',
    icon: 'file-text',
    name: '文档同步',
    blurb: '改了接口就更新文档',
    prompt: '检查 <项目绝对路径> 本周改动的公开接口，同步更新 docs/ 下的文档。',
    schedule: daily(11, 0, on(5)),
  },
  {
    id: 'todo',
    icon: 'layers',
    name: 'TODO 归集',
    blurb: '把散落的 TODO 收成清单',
    prompt: '收集 <项目绝对路径> 里新出现的 TODO/FIXME，按模块汇总成一份清单。',
    schedule: daily(10, 0, on(1)),
  },
  {
    id: 'up',
    icon: 'arrow-up',
    name: '依赖升级',
    blurb: '每月 1 日升级依赖并跑测试',
    prompt: '把 <项目绝对路径> 的依赖升级到最新兼容版本，跑通测试后提交。',
    schedule: monthly(1, 10, 0),
  },
];

/** 置顶的「空白任务」：新建任务时的**默认**起点，不参与上面的分组。
 *  它不属于「内置模板」那一类 —— 它不是模板，是「从零开始」。 */
export const BLANK_TEMPLATE: BuiltinTemplate = {
  id: 'blank',
  icon: 'plus',
  name: '空白任务',
  blurb: '从零开始写 prompt',
  prompt: '',
  schedule: daily(9, 0),
};

/** 用户模板在左栏里的图标是固定的，不给自定义（少一个要填的字段） */
export const USER_TEMPLATE_ICON = 'bookmark';
