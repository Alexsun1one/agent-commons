/* R13 VIZ-1 · 数据页合成示例（window.COMMONS_INSIGHTS_SAMPLE）
 * 全部是编的：话题份额、留存、角色人数、成长天数都不来自任何群聊记录。页面读到它时整页挂「示例」。
 * 形状和 DATA-1 的 tools/scan-archive-trends.py 输出（preview/insights-data.js → window.COMMONS_INSIGHTS）完全一致，
 * 另加 synthetic / note 两个字段。null = 单格不足 10 人被抑制，页面要显示成「不展示」，不能画成 0。
 * 周按北京时间自然周（周一开始）；首周和末周不满 7 天（partial）。
 */
window.COMMONS_INSIGHTS_SAMPLE = {
  schemaVersion: 1,
  synthetic: true,
  note: "合成示例：形状和 tools/scan-archive-trends.py 的输出一致，数字是编的，不来自任何群聊记录。",
  source: {"label":"合成示例","snapshotDate":"2026-10-22","generatedAtUtc":"2026-10-25T00:00:00+00:00","localOnly":true},
  topics: [{"key":"coding","label":"编程与开发"},{"key":"models","label":"模型与推理"},{"key":"agents","label":"智能体与工作流"},{"key":"creation","label":"内容与创作"},{"key":"product","label":"产品与商业"},{"key":"learning","label":"学习与教学"},{"key":"practice","label":"项目与实作"},{"key":"office","label":"自动化与办公"},{"key":"design","label":"设计与界面"},{"key":"knowledge","label":"知识与检索"},{"key":"opensource","label":"本地与开源"},{"key":"prompting","label":"提示词"}],
  weeks: [
    {"start":"2026-05-18","partial":true,"textTotal":7488,"topics":{"coding":518,"models":274,"agents":73,"creation":124,"product":77,"learning":54,"practice":73,"office":80,"design":35,"knowledge":null,"opensource":null,"prompting":53}},
    {"start":"2026-05-25","partial":false,"textTotal":15642,"topics":{"coding":1031,"models":721,"agents":154,"creation":272,"product":161,"learning":139,"practice":154,"office":167,"design":70,"knowledge":72,"opensource":62,"prompting":109}},
    {"start":"2026-06-01","partial":false,"textTotal":18279,"topics":{"coding":1381,"models":876,"agents":170,"creation":319,"product":197,"learning":148,"practice":170,"office":179,"design":81,"knowledge":77,"opensource":78,"prompting":131}},
    {"start":"2026-06-08","partial":false,"textTotal":20155,"topics":{"coding":1294,"models":1014,"agents":211,"creation":355,"product":245,"learning":162,"practice":219,"office":189,"design":null,"knowledge":96,"opensource":null,"prompting":152}},
    {"start":"2026-06-15","partial":false,"textTotal":20742,"topics":{"coding":1377,"models":1263,"agents":193,"creation":298,"product":248,"learning":167,"practice":223,"office":204,"design":110,"knowledge":91,"opensource":78,"prompting":142}},
    {"start":"2026-06-22","partial":false,"textTotal":21744,"topics":{"coding":1390,"models":1390,"agents":221,"creation":348,"product":276,"learning":178,"practice":208,"office":236,"design":112,"knowledge":102,"opensource":87,"prompting":170}},
    {"start":"2026-06-29","partial":false,"textTotal":20681,"topics":{"coding":1270,"models":1267,"agents":252,"creation":339,"product":268,"learning":177,"practice":167,"office":183,"design":103,"knowledge":100,"opensource":88,"prompting":154}},
    {"start":"2026-07-06","partial":false,"textTotal":20193,"topics":{"coding":1230,"models":1086,"agents":339,"creation":338,"product":282,"learning":171,"practice":155,"office":210,"design":87,"knowledge":110,"opensource":84,"prompting":140}},
    {"start":"2026-07-13","partial":false,"textTotal":18777,"topics":{"coding":1191,"models":930,"agents":355,"creation":330,"product":227,"learning":155,"practice":132,"office":189,"design":83,"knowledge":96,"opensource":81,"prompting":126}},
    {"start":"2026-07-20","partial":false,"textTotal":17630,"topics":{"coding":1052,"models":727,"agents":523,"creation":339,"product":251,"learning":152,"practice":127,"office":170,"design":86,"knowledge":84,"opensource":61,"prompting":126}},
    {"start":"2026-07-27","partial":false,"textTotal":16915,"topics":{"coding":974,"models":608,"agents":615,"creation":362,"product":232,"learning":147,"practice":136,"office":133,"design":75,"knowledge":90,"opensource":63,"prompting":109}},
    {"start":"2026-08-03","partial":false,"textTotal":16166,"topics":{"coding":843,"models":525,"agents":615,"creation":430,"product":250,"learning":142,"practice":143,"office":141,"design":71,"knowledge":92,"opensource":57,"prompting":77}},
    {"start":"2026-08-10","partial":false,"textTotal":15811,"topics":{"coding":816,"models":459,"agents":665,"creation":505,"product":257,"learning":143,"practice":166,"office":120,"design":83,"knowledge":94,"opensource":46,"prompting":61}},
    {"start":"2026-08-17","partial":false,"textTotal":17364,"topics":{"coding":978,"models":662,"agents":618,"creation":496,"product":269,"learning":159,"practice":166,"office":148,"design":79,"knowledge":107,"opensource":48,"prompting":58}},
    {"start":"2026-08-24","partial":false,"textTotal":18706,"topics":{"coding":1021,"models":668,"agents":818,"creation":446,"product":290,"learning":236,"practice":204,"office":147,"design":86,"knowledge":114,"opensource":53,"prompting":58}},
    {"start":"2026-08-31","partial":false,"textTotal":20130,"topics":{"coding":982,"models":675,"agents":929,"creation":433,"product":350,"learning":362,"practice":192,"office":148,"design":89,"knowledge":128,"opensource":55,"prompting":52}},
    {"start":"2026-09-07","partial":false,"textTotal":22248,"topics":{"coding":1223,"models":661,"agents":1026,"creation":446,"product":357,"learning":472,"practice":190,"office":152,"design":105,"knowledge":119,"opensource":64,"prompting":61}},
    {"start":"2026-09-14","partial":false,"textTotal":23304,"topics":{"coding":1317,"models":678,"agents":1032,"creation":422,"product":353,"learning":393,"practice":205,"office":158,"design":129,"knowledge":154,"opensource":79,"prompting":61}},
    {"start":"2026-09-21","partial":false,"textTotal":23675,"topics":{"coding":1280,"models":673,"agents":1112,"creation":360,"product":386,"learning":318,"practice":183,"office":179,"design":154,"knowledge":154,"opensource":73,"prompting":64}},
    {"start":"2026-09-28","partial":false,"textTotal":23379,"topics":{"coding":1145,"models":602,"agents":1049,"creation":403,"product":362,"learning":197,"practice":185,"office":147,"design":209,"knowledge":131,"opensource":77,"prompting":59}},
    {"start":"2026-10-05","partial":false,"textTotal":22331,"topics":{"coding":1020,"models":591,"agents":1188,"creation":374,"product":404,"learning":199,"practice":175,"office":154,"design":296,"knowledge":142,"opensource":89,"prompting":61}},
    {"start":"2026-10-12","partial":false,"textTotal":22549,"topics":{"coding":1028,"models":538,"agents":1171,"creation":361,"product":408,"learning":165,"practice":180,"office":154,"design":367,"knowledge":151,"opensource":90,"prompting":60}},
    {"start":"2026-10-19","partial":true,"textTotal":12162,"topics":{"coding":547,"models":328,"agents":670,"creation":198,"product":215,"learning":89,"practice":105,"office":68,"design":220,"knowledge":80,"opensource":null,"prompting":null}}
  ],
  turningPoints: [
    {"topic":"coding","week":"2026-08-03","direction":"down","share":0.0521,"baseline":0.0604},
    {"topic":"coding","week":"2026-10-05","direction":"down","share":0.0457,"baseline":0.0536},
    {"topic":"models","week":"2026-06-15","direction":"up","share":0.0609,"baseline":0.0452},
    {"topic":"models","week":"2026-07-20","direction":"down","share":0.0412,"baseline":0.0571},
    {"topic":"models","week":"2026-07-27","direction":"down","share":0.0359,"baseline":0.0515},
    {"topic":"agents","week":"2026-07-20","direction":"up","share":0.0297,"baseline":0.0145},
    {"topic":"agents","week":"2026-07-27","direction":"up","share":0.0364,"baseline":0.0194},
    {"topic":"agents","week":"2026-10-05","direction":"up","share":0.0532,"baseline":0.0456},
    {"topic":"creation","week":"2026-08-03","direction":"up","share":0.0266,"baseline":0.0187},
    {"topic":"creation","week":"2026-08-10","direction":"up","share":0.0319,"baseline":0.0212},
    {"topic":"creation","week":"2026-08-31","direction":"down","share":0.0215,"baseline":0.0277},
    {"topic":"learning","week":"2026-08-31","direction":"up","share":0.018,"baseline":0.0099},
    {"topic":"learning","week":"2026-09-07","direction":"up","share":0.0212,"baseline":0.0122},
    {"topic":"learning","week":"2026-09-28","direction":"down","share":0.0084,"baseline":0.0174},
    {"topic":"design","week":"2026-10-05","direction":"up","share":0.0133,"baseline":0.0064},
    {"topic":"design","week":"2026-10-12","direction":"up","share":0.0163,"baseline":0.0086}
  ],
  people: [
    {"handle":"chen-mo","name":"陈墨","topics":["coding","agents"]},
    {"handle":"lin-qi","name":"林栖","topics":["knowledge","prompting"]},
    {"handle":"yu-lan","name":"余岚","topics":["design","creation"]},
    {"handle":"song-yuan","name":"松原","topics":["learning","practice"]}
  ],
  cohorts: [
    {"cohort":"2026-06","size":410,"weekly":[1,0.71,0.58,0.51,0.47,0.45,0.43,0.42,0.41,0.4,0.39,0.38,0.38,0.37,0.36,0.36,0.35,0.35,0.34,null]},
    {"cohort":"2026-07","size":285,"weekly":[1,0.64,0.52,0.46,0.42,0.4,0.38,0.37,0.36,0.35,0.34,0.33,0.33,0.32,0.31,null]},
    {"cohort":"2026-08","size":190,"weekly":[1,0.6,0.47,0.41,0.37,0.35,0.33,null,0.31,0.3,null]},
    {"cohort":"2026-09","size":240,"weekly":[1,0.68,0.56,0.5,0.46,0.44,null]},
    {"cohort":"2026-10","size":95,"weekly":[1,0.57,null]}
  ],
  roles: [
    {"month":"2026-05","askers":645,"answerers":230,"sharers":150,"active":1650},
    {"month":"2026-06","askers":715,"answerers":400,"sharers":180,"active":2100},
    {"month":"2026-07","askers":705,"answerers":325,"sharers":230,"active":1900},
    {"month":"2026-08","askers":525,"answerers":400,"sharers":185,"active":1700},
    {"month":"2026-09","askers":585,"answerers":370,"sharers":255,"active":1750},
    {"month":"2026-10","askers":390,"answerers":325,"sharers":200,"active":1300}
  ],
  milestones: [
    {"cohort":"2026-06","firstQuestion":{"p25":1,"median":4,"p75":13},"firstAnswer":{"p25":6,"median":17,"p75":39},"firstShare":{"p25":3,"median":11,"p75":30}},
    {"cohort":"2026-07","firstQuestion":{"p25":1,"median":3,"p75":10},"firstAnswer":{"p25":5,"median":14,"p75":33},"firstShare":{"p25":2,"median":9,"p75":24}},
    {"cohort":"2026-08","firstQuestion":{"p25":0,"median":3,"p75":9},"firstAnswer":{"p25":4,"median":12,"p75":27},"firstShare":{"p25":2,"median":8,"p75":21}},
    {"cohort":"2026-09","firstQuestion":{"p25":0,"median":2,"p75":7},"firstAnswer":{"p25":3,"median":9,"p75":19},"firstShare":{"p25":1,"median":6,"p75":15}},
    {"cohort":"2026-10","firstQuestion":{"p25":0,"median":1,"p75":4},"firstAnswer":{"p25":null,"median":null,"p75":null},"firstShare":{"p25":null,"median":null,"p75":null}}
  ],
  suppressed: {"cells":14,"cohortsDropped":0},
  integrity: {"databaseSha256Before":null,"databaseSha256After":null}
};
