(function () {
  'use strict';

  const groupMeta = [
    { id: 'knowledge', title: '知识的生命' },
    { id: 'activity', title: '做事的状态' },
    { id: 'community', title: '社群的动作' },
    { id: 'tools', title: '额度与工具' }
  ];

  const icons = [
    { name: 'spark', label: '灵光', group: 'knowledge', meaning: '刚冒出来的想法', animated: true, body: '<path d="M12 3.5 13.4 9l5.1 3-5.1 3L12 20.5 10.6 15l-5.1-3 5.1-3z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M12 3.5 13.4 9l5.1 3-5.1 3L12 20.5 10.6 15l-5.1-3 5.1-3z"/><path d="M18.5 5.5v3m-1.5-1.5h3M5.5 16.5v2m-1-1h2"/>' },
    { name: 'bulb', label: '灯泡', group: 'knowledge', meaning: '想到解法', animated: true, body: '<path d="M12 3.5a6 6 0 0 0-3.8 10.6c.7.6 1.2 1.4 1.3 2.4h5c.1-1 .6-1.8 1.3-2.4A6 6 0 0 0 12 3.5z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M12 3.5a6 6 0 0 0-3.8 10.6c.7.6 1.2 1.4 1.3 2.4h5c.1-1 .6-1.8 1.3-2.4A6 6 0 0 0 12 3.5z"/><path d="M9.7 17h4.6M10.5 19h3"/><path d="M12 2.8v1.2M4.8 6.3l1 .6m12.4 0 1-.6"/>' },
    { name: 'question', label: '疑问', group: 'knowledge', meaning: '还没人答', animated: true, body: '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><path d="M9.7 9.7a2.4 2.4 0 1 1 4.3 1.4c-.8.9-2 1.1-2 2.4"/><circle cx="12" cy="15.7" r=".65" fill="currentColor" stroke="none"/>' },
    { name: 'follow-up', label: '追问', group: 'knowledge', meaning: '问题接着问', animated: false, body: '<path d="M5 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 2.5V13A2 2 0 0 1 4 11V6.5a2 2 0 0 1 1-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M5 4.5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 2.5V13A2 2 0 0 1 4 11V6.5a2 2 0 0 1 1-2z"/><path d="M10 8.5h7a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1v3l-3-3H9"/><path d="M12.5 11.5h3m-1.5-1.5v3"/>' },
    { name: 'verify-pending', label: '待验证', group: 'knowledge', meaning: '需要放大镜核对', animated: false, body: '<circle cx="10.5" cy="10.5" r="6.7" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><circle cx="10.5" cy="10.5" r="6.7"/><path d="m15.4 15.4 5.1 5.1"/><path d="M9.1 9.1a1.6 1.6 0 1 1 2.8 1.1c-.5.6-1.3.8-1.3 1.8"/><circle cx="10.5" cy="13.8" r=".55" fill="currentColor" stroke="none"/>' },
    { name: 'verified', label: '已验证', group: 'knowledge', meaning: '印章确认并打勾', animated: true, body: '<path d="M12 3.5 14.3 5l2.8-.1 1.1 2.6 2.2 1.7-.7 2.7.7 2.7-2.2 1.7-1.1 2.6-2.8-.1L12 20.5 9.7 19l-2.8.1-1.1-2.6-2.2-1.7.7-2.7-.7-2.7 2.2-1.7 1.1-2.6 2.8.1z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M12 3.5 14.3 5l2.8-.1 1.1 2.6 2.2 1.7-.7 2.7.7 2.7-2.2 1.7-1.1 2.6-2.8-.1L12 20.5 9.7 19l-2.8.1-1.1-2.6-2.2-1.7.7-2.7-.7-2.7 2.2-1.7 1.1-2.6 2.8.1z"/><path d="m8 12.2 2.6 2.6 5.4-5.5"/>' },
    { name: 'organized', label: '已整理', group: 'knowledge', meaning: '叠好的知识卡片', animated: false, body: '<rect x="8" y="4" width="12" height="14" rx="1.5"/><rect x="6" y="6" width="12" height="14" rx="1.5"/><rect x="4" y="8" width="12" height="12" rx="1.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><rect x="4" y="8" width="12" height="12" rx="1.5"/><path d="M7 12h5"/>', smallBody: '<rect x="7" y="4.5" width="12" height="14" rx="1.3"/><rect x="4" y="7" width="12" height="13" rx="1.3" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><rect x="4" y="7" width="12" height="13" rx="1.3"/><path d="M7 11h5"/>' },
    { name: 'disputed', label: '有争议', group: 'knowledge', meaning: '两种观点对撞', animated: false, body: '<path d="M5 5.5h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H8l-3 2v-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M5 5.5h6a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H8l-3 2v-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z"/><path d="M14 11.5h4.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H17l-3 2v-2h-.5a2 2 0 0 1-2-2v-1"/><path d="m12.6 8.8-1.5 2.8h1.8l-1 3 2.8-3.9h-1.8l.8-1.9z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/>', smallBody: '<path d="M5 5.5h5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H7l-2 1.5V11a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M5 5.5h5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H7l-2 1.5V11a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z"/><path d="M14 12.5h4a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1l-2 1.5v-1.5h-1a2 2 0 0 1-2-2v-.5"/><path d="m12.8 9.5-1.1 2h1.4l-.8 2.1 2.2-2.7h-1.4l.5-1.4z"/>' },
    { name: 'reversed', label: '被推翻', group: 'knowledge', meaning: '原结论被划掉或翻转', animated: false, body: '<g transform="rotate(-6 12 12)"><rect x="5" y="3.5" width="14" height="17" rx="2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 8h8M8 11h5"/><path d="m7 17 10-10"/></g><path d="M16.5 4.5 19 4l-.5 2.5"/>' },
    { name: 'expired', label: '过期', group: 'knowledge', meaning: '时效已过的沙漏', animated: true, body: '<path d="M6 4h12v3.2a4.7 4.7 0 0 1-2 3.8l-2.6 1.9 2.6 1.9a4.7 4.7 0 0 1 2 3.8V20H6v-1.4a4.7 4.7 0 0 1 2-3.8l2.6-1.9L8 11a4.7 4.7 0 0 1-2-3.8z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M6 4h12v3.2a4.7 4.7 0 0 1-2 3.8l-2.6 1.9 2.6 1.9a4.7 4.7 0 0 1 2 3.8V20H6v-1.4a4.7 4.7 0 0 1 2-3.8l2.6-1.9L8 11a4.7 4.7 0 0 1-2-3.8z"/><path d="M8.5 7h7M8.5 17.5h7m-4.5-4.3v1.8"/><path d="M12 9v1.4m-1.6 2.7 3.2 0"/>' },
    { name: 'candidate', label: '候选', group: 'knowledge', meaning: '尚待选择的虚线圆', animated: false, body: '<circle cx="12" cy="12" r="8.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".12" stroke-dasharray="2.2 2.2"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.2 2.2"/><circle cx="12" cy="12" r="3"/><path d="M12 10v4m-2-2h4"/>' },
    { name: 'resolved', label: '已解决', group: 'knowledge', meaning: '圆圈里的确认勾', animated: false, body: '<circle cx="12" cy="12" r="8.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><circle cx="12" cy="12" r="8.5"/><path d="m7.8 12.2 2.8 2.8 5.7-6"/>' },

    { name: 'in-progress', label: '进行中', group: 'activity', meaning: '持续推进的进度环', animated: true, body: '<circle cx="12" cy="12" r="8.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".1" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2"/><path class="si-progress-arc" d="M12 3.5a8.5 8.5 0 0 1 7.36 4.25" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>' },
    { name: 'blocked', label: '卡住', group: 'activity', meaning: '线团打结后无法前进', animated: false, body: '<path d="M3.5 12h5"/><ellipse cx="12" cy="12" rx="4.5" ry="3.7" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><ellipse cx="12" cy="12" rx="4.5" ry="3.7"/><path d="M15.2 12h5.3"/><path d="M10 10.5l4 3"/>', smallBody: '<path d="M3.5 12h5"/><ellipse cx="12" cy="12" rx="4" ry="3.3" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><ellipse cx="12" cy="12" rx="4" ry="3.3"/><path d="M15.4 12h5.1"/><path d="M10.2 10.5l3.8 3"/>' },
    { name: 'pitfall', label: '踩坑', group: 'activity', meaning: '地面路径遇到坑洞', animated: false, body: '<path d="M3.5 8h5m7 0h5"/><ellipse cx="12" cy="17" rx="4.5" ry="2.4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><ellipse cx="12" cy="17" rx="4.5" ry="2.4"/><path d="M12 3.5v8m-2.5-2.5L12 11.5l2.5-2.5"/>' },
    { name: 'connected', label: '跑通', group: 'activity', meaning: '线路接通并有能量通过', animated: true, body: '<path d="M4 12h5m6 0h5"/><circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path class="si-bolt" d="m13.2 4.5-5 8h3.7l-1.1 7 5-8.2H12z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><path class="si-bolt" d="m13.2 4.5-5 8h3.7l-1.1 7 5-8.2H12z"/>' },
    { name: 'night-run', label: '深夜跑通', group: 'activity', meaning: '月亮与通过确认', animated: false, body: '<path d="M13.5 4.5C9.3 5.6 6.5 8.5 6.5 12s2.8 6.4 7 7.5c-2.8-2.1-4.2-4.6-4.2-7.5s1.4-5.4 4.2-7.5z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M13.5 4.5C9.3 5.6 6.5 8.5 6.5 12s2.8 6.4 7 7.5c-2.8-2.1-4.2-4.6-4.2-7.5s1.4-5.4 4.2-7.5z"/><path d="m15.5 15.5 2 2 3.5-4"/>' },
    { name: 'experiment', label: '实验', group: 'activity', meaning: '烧瓶中的小规模实验', animated: false, body: '<path d="M9 3.5h6M10 3.5v6l-5.4 8.8A1.5 1.5 0 0 0 5.9 20.5h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5v-6" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M9 3.5h6M10 3.5v6l-5.4 8.8A1.5 1.5 0 0 0 5.9 20.5h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5v-6"/><path d="M7.3 16h9.4m-7.4-3h5.4"/><circle cx="10" cy="15" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r=".7" fill="currentColor" stroke="none"/>' },
    { name: 'distilled', label: '蒸馏', group: 'activity', meaning: '漏斗过滤后留下精华', animated: false, body: '<path d="M4 4.5h16l-6.3 7v4.2l-3.4 3V11.5z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M4 4.5h16l-6.3 7v4.2l-3.4 3V11.5z"/><path d="M12 19.8c-1.4-1.2-2-2.1-2-3.1a2 2 0 0 1 4 0c0 1-.6 1.9-2 3.1z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/><path d="M12 19.8c-1.4-1.2-2-2.1-2-3.1a2 2 0 0 1 4 0c0 1-.6 1.9-2 3.1z"/>' },
    { name: 'reproduced', label: '复现', group: 'activity', meaning: '循环回到相同结果', animated: false, body: '<path d="M18.5 8.5A7.2 7.2 0 0 0 6 6.7L4.5 8"/><path d="M4.5 4.5V8h3.5M5.5 15.5A7.2 7.2 0 0 0 18 17.3l1.5-1.3"/><path d="M19.5 19.5V16H16"/><path d="M10 9h4v6h-4z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M10 9h4v6h-4z"/>' },
    { name: 'milestone', label: '里程碑', group: 'activity', meaning: '路径上的小旗标记', animated: false, body: '<path d="M6 20V4"/><path d="M6 4h11l-2 3 2 3H6z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><path d="M6 4h11l-2 3 2 3H6z"/><path d="M4 20h7"/><circle cx="6" cy="4" r="1.4" fill="currentColor"/>' },

    { name: 'clue', label: '线索', group: 'community', meaning: '留下的脚印与线头', animated: false, body: '<path d="M4 19c0-3.8 3.2-4.5 5-6.5s2-5.5 5.5-5.5H17c1.8 0 3 1 3 2.5"/><circle cx="20" cy="9.5" r="1.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/>' },
    { name: 'source', label: '来源', group: 'community', meaning: '引文可以沿链环回溯', animated: false, body: '<rect x="4" y="4.5" width="10" height="8" rx="1.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><rect x="4" y="4.5" width="10" height="8" rx="1.5"/><path d="M6.5 9V7m0 0H5m4.5 2V7m0 0H8"/><path d="M15 17h1.4a2.2 2.2 0 0 0 0-4.4H15m-2 2.4h-1a2.2 2.2 0 0 1 0-4.4h1"/>', smallBody: '<rect x="4" y="4.5" width="9" height="7.5" rx="1.2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><rect x="4" y="4.5" width="9" height="7.5" rx="1.2"/><path d="M6 9V7h2v2H6m3.5 0V7h2v2h-2"/><path d="M15 17h1a2 2 0 0 0 0-4h-1m-2 2h-1a2 2 0 0 1 0-4h1"/>' },
    { name: 'citation', label: '引用', group: 'community', meaning: '书签标住引用位置', animated: false, body: '<path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5v14L12 16l-6.5 3.5v-14A1.5 1.5 0 0 1 7 4z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5v14L12 16l-6.5 3.5v-14A1.5 1.5 0 0 1 7 4z"/><path d="M9 8h6m-6 3h4"/>' },
    { name: 'discussion', label: '讨论中', group: 'community', meaning: '多人围绕同一话题交流', animated: false, body: '<path d="M4.5 5h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4l-3.5 2v-2H4.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M4.5 5h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4l-3.5 2v-2H4.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M10 14h5l3.5 2v-2h1A2 2 0 0 0 21.5 12v-3a2 2 0 0 0-2-2H16"/><path d="M6.5 9h4m-4 2h2"/>' },
    { name: 'consensus', label: '共识', group: 'community', meaning: '不同意见相交形成共同点', animated: false, body: '<circle cx="9.2" cy="12" r="6.3" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><circle cx="9.2" cy="12" r="6.3"/><circle cx="14.8" cy="12" r="6.3"/><path d="m10 12 1.1 1.2 2.9-3"/>' },
    { name: 'help', label: '求助', group: 'community', meaning: '举手发出求助信号', animated: false, body: '<path d="M8 20v-6.5a1.4 1.4 0 0 1 2.8 0V8a1.4 1.4 0 0 1 2.8 0v5.5V7a1.4 1.4 0 0 1 2.8 0v6.5V9a1.4 1.4 0 0 1 2.8 0v7a4 4 0 0 1-4 4H8z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M8 20v-6.5a1.4 1.4 0 0 1 2.8 0V8a1.4 1.4 0 0 1 2.8 0v5.5V7a1.4 1.4 0 0 1 2.8 0v6.5V9a1.4 1.4 0 0 1 2.8 0v7a4 4 0 0 1-4 4H8z"/><path d="m8 16-1.7-1.5a1.4 1.4 0 0 0-2 2L8 20"/>', smallBody: '<path d="M8 20v-6a1.3 1.3 0 0 1 2.6 0V8a1.3 1.3 0 0 1 2.6 0v6V7a1.3 1.3 0 0 1 2.6 0v7V9a1.3 1.3 0 0 1 2.6 0v7a4 4 0 0 1-4 4H8z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M8 20v-6a1.3 1.3 0 0 1 2.6 0V8a1.3 1.3 0 0 1 2.6 0v6V7a1.3 1.3 0 0 1 2.6 0v7V9a1.3 1.3 0 0 1 2.6 0v7a4 4 0 0 1-4 4H8z"/><path d="m8 16-1.6-1.4a1.3 1.3 0 0 0-1.8 1.8L8 20"/>' },
    { name: 'appreciation', label: '捧场', group: 'community', meaning: '竖起大拇指支持', animated: false, body: '<path d="M8 10.5 11.5 4c.4-.8 1.7-.5 1.7.5v4h4.2a2 2 0 0 1 1.9 2.5l-1.7 6.5a2 2 0 0 1-1.9 1.5H8z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M8 10.5 11.5 4c.4-.8 1.7-.5 1.7.5v4h4.2a2 2 0 0 1 1.9 2.5l-1.7 6.5a2 2 0 0 1-1.9 1.5H8z"/><path d="M4 10h4v9H4z"/>' },
    { name: 'newcomer', label: '新人', group: 'community', meaning: '刚发芽的新伙伴', animated: false, body: '<path d="M12 18.5V10"/><path d="M12 14c-4.2 0-6.5-2.2-6.5-5.5C9 8.5 11.3 10.5 12 14z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><path d="M12 14c-4.2 0-6.5-2.2-6.5-5.5C9 8.5 11.3 10.5 12 14z"/><path d="M12 11c0-3.4 2.4-5.5 6.5-5.5C18.5 9 16.2 11.5 12 11z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".28"/><path d="M12 11c0-3.4 2.4-5.5 6.5-5.5C18.5 9 16.2 11.5 12 11z"/><path d="M5 19.5h14M7 17.5l-1 2m11-2 1 2"/>' },
    { name: 'trending', label: '热度', group: 'community', meaning: '三根逐步升高的柱形', animated: false, body: '<path d="M4 19.5h16"/><rect x="5" y="12" width="3.5" height="7.5" rx="1" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><rect x="10.2" y="8" width="3.5" height="11.5" rx="1" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><rect x="15.4" y="4.5" width="3.5" height="15" rx="1" style="fill:var(--icon-tint, currentColor)" fill-opacity=".2"/><rect x="5" y="12" width="3.5" height="7.5" rx="1"/><rect x="10.2" y="8" width="3.5" height="11.5" rx="1"/><rect x="15.4" y="4.5" width="3.5" height="15" rx="1"/>' },
    { name: 'reminder', label: '提醒', group: 'community', meaning: '铃铛提示一项待办', animated: true, body: '<path d="M6 16.5h12l-1.3-1.8a4.8 4.8 0 0 1-.9-2.8V10a3.8 3.8 0 0 0-7.6 0v1.9a4.8 4.8 0 0 1-.9 2.8z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M6 16.5h12l-1.3-1.8a4.8 4.8 0 0 1-.9-2.8V10a3.8 3.8 0 0 0-7.6 0v1.9a4.8 4.8 0 0 1-.9 2.8z"/><path d="M10 19a2.2 2.2 0 0 0 4 0M12 4V3"/><path d="M4 8.5 5.5 7m14.5 1.5L18.5 7"/>' },
    { name: 'favorite', label: '收藏', group: 'community', meaning: '星形收藏书签', animated: false, body: '<path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5v14L12 16l-6.5 3.5v-14A1.5 1.5 0 0 1 7 4z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5v14L12 16l-6.5 3.5v-14A1.5 1.5 0 0 1 7 4z"/><path d="m12 7 1.2 2.5 2.8.4-2 1.9.5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-1.9 2.8-.4z" fill="currentColor" fill-opacity=".22"/><path d="m12 7 1.2 2.5 2.8.4-2 1.9.5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-1.9 2.8-.4z"/>' },

    { name: 'quota', label: '额度', group: 'tools', meaning: '电池表示可用额度', animated: false, body: '<rect x="3.5" y="7" width="16" height="10" rx="2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".12"/><rect x="3.5" y="7" width="16" height="10" rx="2"/><path d="M19.5 10h1v4h-1"/><path d="M6.5 10h3.4v4H6.5z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".4"/><path d="M6.5 10h3.4v4H6.5zM12 10h4"/>' },
    { name: 'quota-reset', label: '额度重置', group: 'tools', meaning: '电池与回环箭头表示额度重置', animated: false, body: '<rect x="11" y="8.5" width="8.5" height="7" rx="1.4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><rect x="11" y="8.5" width="8.5" height="7" rx="1.4"/><path d="M19.5 10.5h1v3h-1"/><rect x="13" y="10.5" width="4.5" height="3" rx=".6" style="fill:var(--icon-tint, currentColor)" fill-opacity=".22"/><path d="M8.5 8.5A4.2 4.2 0 1 0 8.5 16m0-11.5v4h-4"/>' },
    { name: 'context-full', label: '上下文满', group: 'tools', meaning: '盒子内容到达上沿', animated: false, body: '<path d="M4 8.5h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M4 8.5h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 8.5 7 5h10l3 3.5M7 8.5V6m3 2.5V6m3 2.5V6m3 2.5V6"/><path d="M7 12h10m-10 3h10"/>' },
    { name: 'tool', label: '工具', group: 'tools', meaning: '可操作的扳手', animated: false, body: '<path d="M14.5 5.2a5.1 5.1 0 0 0-6.2 6.2l-4.9 4.9a2 2 0 0 0 2.8 2.8l4.9-4.9a5.1 5.1 0 0 0 6.2-6.2l-3.1 3.1-2.7-.6-.6-2.7z" style="fill:var(--icon-tint, currentColor)" fill-opacity=".16"/><path d="M14.5 5.2a5.1 5.1 0 0 0-6.2 6.2l-4.9 4.9a2 2 0 0 0 2.8 2.8l4.9-4.9a5.1 5.1 0 0 0 6.2-6.2l-3.1 3.1-2.7-.6-.6-2.7z"/>' },
    { name: 'connection', label: '连接', group: 'tools', meaning: '两个节点通过一条线连接', animated: false, body: '<path d="M7.5 12h9"/><circle cx="5.5" cy="12" r="2.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".18"/><circle cx="18.5" cy="12" r="2.5" style="fill:var(--icon-tint, currentColor)" fill-opacity=".18"/><circle cx="5.5" cy="12" r="2.5"/><circle cx="18.5" cy="12" r="2.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>' }
  ];

  const scenicNames = ['spark', 'bulb', 'question', 'verified', 'disputed', 'pitfall', 'connected', 'newcomer'];
  const scenicDetails = {
    spark: '<path class="si-scene-detail" d="M36 7v4m-2-2h4M8 35v4m-2-2h4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/><circle cx="35" cy="30" r="1.2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/>',
    bulb: '<path class="si-scene-detail" d="m8 8-2-2m34 0-2 2M7 20H4m40 0h-3" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/><circle cx="38" cy="34" r="1.4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/>',
    question: '<circle cx="38" cy="10" r="2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/><circle cx="9" cy="38" r="1.4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/><path class="si-scene-detail" d="M37 31v4m-2-2h4"/>',
    verified: '<circle cx="24" cy="24" r="20" style="fill:var(--icon-tint, currentColor)" fill-opacity=".06" stroke="currentColor" stroke-opacity=".3" stroke-width="1.5"/><path d="m10 24 2 2m24 0 2-2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/>',
    disputed: '<path class="si-scene-detail" d="m7 35 2-2m32-22 2-2M36 7v4m-2-2h4" style="fill:var(--icon-tint, currentColor)" fill-opacity=".3"/>',
    pitfall: '<circle cx="8" cy="8" r="1.2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/><circle cx="40" cy="8" r="1.2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/><path class="si-scene-detail" d="M7 39h4m26 0h4"/>',
    connected: '<circle cx="7" cy="24" r="2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".25"/><circle cx="41" cy="24" r="2" style="fill:var(--icon-tint, currentColor)" fill-opacity=".25"/><path class="si-scene-detail" d="M5 24h2m34 0h2"/>',
    newcomer: '<circle cx="24" cy="7" r="1.6" style="fill:var(--icon-tint, currentColor)" fill-opacity=".35"/><path class="si-scene-detail" d="M8 40h32m-4-3 2 3m-24-3-2 3"/>'
  };

  function normalizeBody(body) {
    body = body.replace(/(fill="var\(--icon-tint, currentColor\)" fill-opacity=")[^"]+(")/g, '$1.24$2');
    const matches = Array.from(body.matchAll(/<(?:path|circle|rect)\b[^>]*\/>/g));
    const edits = [];
    function geometry(tag) {
      return tag
        .replace(/\s+(?:fill|fill-opacity|stroke|stroke-opacity|stroke-width|class)="[^"]*"/g, '')
        .replace(/\s*\/>$/, '/>');
    }
    function hasFill(tag) {
      return /\sfill="(?:var\(|currentColor)/.test(tag);
    }
    for (let index = 0; index < matches.length - 1; index += 1) {
      const first = matches[index][0];
      const second = matches[index + 1][0];
      if (geometry(first) !== geometry(second)) continue;
      if (hasFill(first) && !hasFill(second)) {
        edits.push({ start: matches[index].index, end: matches[index].index + first.length, value: first.replace(/\s*\/>$/, ' stroke="none"/>') });
        index += 1;
      } else if (!hasFill(first) && !hasFill(second)) {
        edits.push({ start: matches[index + 1].index, end: matches[index + 1].index + second.length, value: '' });
        index += 1;
      }
    }
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      const edit = edits[index];
      body = body.slice(0, edit.start) + edit.value + body.slice(edit.end);
    }
    return body;
  }

  icons.forEach(function (icon) { icon.body = normalizeBody(icon.body); if (icon.smallBody) icon.smallBody = normalizeBody(icon.smallBody); });

  const byName = Object.create(null);
  icons.forEach(function (icon) { byName[icon.name] = icon; });
  scenicNames.forEach(function (name) {
    const base = byName[name];
    byName[name + '-48'] = {
      name: name + '-48',
      label: base.label + ' · 点景',
      group: base.group,
      meaning: base.meaning,
      animated: base.animated,
      variantOf: name,
      viewBox: '0 0 48 48',
      body: '<g transform="scale(2)">' + /* safe: base 来自本文件的图标常量表 */ escapeHtml(base.body) + '</g>' + scenicDetails[name]
    };
  });

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function svg(name, options) {
    const record = byName[name];
    if (!record) {
      const shared = window.Commons && window.Commons.iconPath ? window.Commons.iconPath(name) : '';
      if (!shared) return '';
      const px = Number(options && options.size) > 0 ? Math.min(256, Math.round(Number(options.size))) : 20;
      return '<svg class="si-icon si-icon--shared" viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + escapeHtml(shared) + '"/></svg>';
    }
    const config = options || {};
    const numericSize = Number(config.size);
    const size = Number.isFinite(numericSize) && numericSize > 0 ? Math.min(256, Math.round(numericSize)) : 20;
    const label = typeof config.label === 'string' ? config.label : '';
    const viewBox = record.viewBox || '0 0 24 24';
    const classes = ['si-icon', 'si-icon--' + record.name];
    if (record.variantOf) classes.push('si-icon--' + record.variantOf);
    const accessible = label ? ' role="img"><title>' + escapeHtml(label) + '</title>' : ' aria-hidden="true">';
    const body = size === 16 && record.smallBody ? record.smallBody : record.body;
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + escapeHtml(classes.join(' ')) + '" viewBox="' + escapeHtml(viewBox) + '" width="' + size + '" height="' + size + '" style="width:' + size + 'px;height:' + size + 'px" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false"' + accessible + /* safe: body 取自本文件的图标常量表，accessible 已 escapeHtml */ body + '</svg>';
  }

  function list() {
    return icons.map(function (icon) {
      return { name: icon.name, label: icon.label, group: icon.group, meaning: icon.meaning, animated: icon.animated };
    });
  }

  function groups() {
    return groupMeta.map(function (group) {
      return {
        id: group.id,
        title: group.title,
        icons: list().filter(function (icon) { return icon.group === group.id; })
      };
    });
  }

  function renderTile(icon) {
    const sizes = [16, 20, 24].map(function (size) {
      return '<div class="si-sample" data-si-size="' + size + '"><span class="si-size-label">' + size + '</span><div class="si-preview">' + svg(icon.name, { size: size }) + '</div></div>';
    }).join('');
    const replay = icon.animated
      ? '<button type="button" class="button si-replay" data-si-replay="' + escapeHtml(icon.name) + '" aria-label="重播' + escapeHtml(icon.label) + '动效">重播</button>'
      : '';
    return '<article class="si-item" data-si-icon="' + escapeHtml(icon.name) + '"><h3 class="si-item-title">' + escapeHtml(icon.label) + '</h3><div class="si-samples">' + sizes + '</div>' + replay + '</article>';
  }

  function renderScene(name) {
    const icon = byName[name];
    const base = byName[icon.variantOf];
    return '<figure class="si-scene"><div class="si-scene-preview">' + svg(name, { size: 48 }) + '</div><figcaption>' + escapeHtml(base.label) + '</figcaption></figure>';
  }

  function renderIconsPage() {
    const groupHtml = groups().map(function (group) {
      return '<section class="si-group" aria-labelledby="si-group-' + group.id + '"><header class="si-group-heading"><h2 id="si-group-' + group.id + '">' + escapeHtml(group.title) + '</h2><span>' + group.icons.length + ' 枚</span></header><div class="si-grid">' + group.icons.map(renderTile).join('') + '</div></section>';
    }).join('');
    const sceneHtml = scenicNames.map(function (name) { return renderScene(name + '-48'); }).join('');
    return '<div class="si-page"><header class="si-intro"><div><p class="si-eyebrow">R12 · 组件目录</p><h1>状态图标</h1><p class="si-description">37 枚状态图标 · 每枚提供 16 / 20 / 24 三档。</p></div><span class="si-count">线条 currentColor · 辅面 --icon-tint</span></header><div class="si-groups">' + groupHtml + '</div><section class="si-scene-section" aria-labelledby="si-scene-title"><header class="si-group-heading"><div><p class="si-eyebrow">48 PX</p><h2 id="si-scene-title">点景图标</h2></div><span>8 枚</span></header><div class="si-scene-grid">' + sceneHtml + '</div></section></div>';
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (event) {
      const target = event.target && event.target.closest ? event.target.closest('.si-replay') : null;
      if (!target) return;
      const tile = target.closest('.si-item');
      const icon = tile && tile.querySelector('.si-sample[data-si-size="24"] .si-icon');
      if (!icon) return;
      icon.classList.remove('si-is-entering');
      icon.getBoundingClientRect();
      icon.classList.add('si-is-entering');
    });
    document.addEventListener('animationend', function (event) {
      const target = event.target;
      if (target && target.matches && target.matches('.si-icon.si-is-entering')) target.classList.remove('si-is-entering');
    });
  }

  window.CommonsIcons = {
    svg: svg,
    list: list,
    groups: groups,
    routes: { icons: renderIconsPage }
  };
})();
