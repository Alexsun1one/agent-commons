/* 作品轮盘里绑定合成作品 id 的对照句和角色预设。只给演示模式读。 */
(function () {
  'use strict';
  window.COMMONS_WORK_HUB_SAMPLE = {
    contrast: {
      'field-production': '先用扣子做跟单，再用 Codex 上品，然后用 WorkBuddy 试客户开发。',
      'field-spreadsheets': '以前整理一张表要大半天；现在说清需求，看工具做完，自己检查。',
      'field-project-log': '立项后写了项目日志，维护好一点；日志会变臃肿，不会被主动找回。',
      'field-requirements': '先跟 GPT 聊成文档，再让 Opus 头脑风暴，然后才动手。',
      'field-cover': '生成之后还要落盘、上传，最后才接到博客封面。',
      w1: '问句要带回处；没有可靠来源就拒答。',
      w2: '结果未知就先停，交给人接管，不盲目重试。',
      w3: '看示范不算会；撤掉辅助后自己做完才算。'
    },
    stationPreset: {
      w1: ['human', 'agent', 'human', 'agent'],
      w2: ['human', 'agent', 'human', 'agent'],
      w3: ['human', 'human', 'human', 'human']
    }
  };
})();
