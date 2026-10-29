/* 作品舞台绑定合成案例 id 的步骤配置。只给演示模式读。 */
(function () {
  'use strict';
  window.COMMONS_WORK_STAGE_SAMPLE = {
    fieldwork: {
      'field-production': {
        agents: [0, 1, 2], challenge: 2, proposal: '直接联系潜在客户',
        guides: { 0: ['生产跟单环节', '未展示实现就停'], 1: ['SEO 与自动上品', '发布前由人确认'], 2: ['客户开发草稿', '联系前由人确认'] },
        read: '跟单、站点运营与客户开发所需的已授权资料。',
        confirm: '系统实现、发布、客户联系与效果判断都由我确认。'
      },
      'field-project-log': {
        agents: [1], challenge: 1, proposal: '把全部历史文件写进日志',
        guides: { 1: ['写入项目日志', '不等于主动召回'] },
        read: '当前项目日志与我明确选中的项目文件。',
        confirm: '哪些材料进入日志、日志是否仍可维护，由我确认。'
      },
      'field-spreadsheets': {
        agents: [1], challenge: 1, proposal: '覆盖原始表格并直接发出',
        guides: { 1: ['整理与分析副本', '覆盖源表前停手'] },
        read: '我主动选中的表格副本与任务说明。',
        confirm: '结果是否正确、是否覆盖源表、是否发给别人，由我确认。',
        labels: ['以前', '现在'],
        before: [
          { title: '拿到表格', tag: '本人处理', body: '作者回忆自己拿到财务报表或其他数据表格。' },
          { title: '整理分析', tag: '本人处理', body: '作者回忆这项工作一忙就大半天。' },
          { title: '检查结果', tag: '本人核对', body: '检查仍是任务的一部分。' }
        ]
      },
      'field-requirements': {
        agents: [0, 2], challenge: 2, proposal: '跳过确认，按方案进入实现',
        guides: { 0: ['讨论本次需求', '成文后请人核对'], 2: ['方案头脑风暴', '落地前由人确认'] },
        read: '本次需求说明与我确认的讨论材料。',
        confirm: '需求文档、方案取舍与何时进入实现，由我确认。'
      },
      'field-cover': {
        agents: [0], challenge: 0, proposal: '生成后自动上传并发布',
        guides: { 0: ['生成本次配图', '上传与发布前停手'] },
        read: '本次配图需求、本地文件与我确认的发布位置。',
        confirm: '成图是否采用、是否上传、是否发布到博客，由我确认。'
      }
    },
    works: {
      w1: { agents: [1, 2, 3], challenge: 3, proposal: '没有可靠来源也继续生成答案', guides: { 1: ['固定版本资料', '保留命中片段'], 2: ['判断证据是否够', '无可靠来源就停'], 3: ['生成带引用回答', '发布前由人确认'] } },
      w2: { agents: [1, 3], challenge: 3, proposal: '结果未知时直接重试工具', guides: { 1: ['规划动作与边界', '权限不足就停'], 3: ['按请求标识执行', '结果未知先回读'] } },
      w3: { agents: [], challenge: null, proposal: '', guides: {} }
    }
  };
})();
