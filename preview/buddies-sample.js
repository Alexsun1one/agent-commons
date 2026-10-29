/* 找搭子页的合成需求。只给演示模式读；真实模式不加载这些人。 */
(function () {
  'use strict';
  window.COMMONS_BUDDIES_SAMPLE = {
    examples: [
      { id: 'b1', personId: 'p1', kind: 'project', title: '把知识库做成可复现的小样', skills: ['交互原型', '测试设计'], schedule: '每周 3 小时 · 连续 2 周', outcome: '一个带引用的检索原型，以及 12 道问题的评测记录。', contribution: '一起检查回答与来源，把失败过程留下来。' },
      { id: 'b2', personId: 'p5', kind: 'project', title: '做一个两周内能交付的 Agent 项目', skills: ['工具调用', '工作流'], schedule: '每周 4 小时 · 连续 2 周', outcome: '一条可演示的工作流、一份范围约定和交付清单。', contribution: '从需求中选一个小切片，约定验收方式。' },
      { id: 'b3', personId: 'p3', kind: 'learn', title: '一起练一次移动端交互走查', skills: ['交互原型', '体验记录'], schedule: '每周 2 小时 · 连续 3 周', outcome: '一份可复现的问题清单，以及改前改后的原型。', contribution: '各带一个小界面，轮流操作、记录和修改。' },
      { id: 'b4', personId: 'p6', kind: 'learn', title: '把会做的一件事教给别人', skills: ['内容创作', '教学设计'], schedule: '每周 2 小时 · 连续 2 周', outcome: '一节 20 分钟带做练习和一份学员反馈。', contribution: '互当一次学习者，检查对方能否独立完成。' },
      { id: 'b5', personId: 'p2', kind: 'review', title: '互审一个可接管的 Agent 工作流', skills: ['评测', '工具调用'], schedule: '每周 1 小时 · 先做 1 次', outcome: '各自得到一份失败场景、接管路径与修改建议。', contribution: '各带一个流程和三个失败用例，交换检查。' },
      { id: 'b6', personId: 'p1', kind: 'review', title: '互换一份检索评测集', skills: ['RAG', '检索评测'], schedule: '每周 1–2 小时 · 先做 1 次', outcome: '交叉检查引用、拒答和缺失条件，留下复现结果。', contribution: '带一份可共享的合成资料与评测问题。' }
    ]
  };
})();
