# preview/vendor 开源件清单

由 `tools/vendor/build.mjs` 生成（R12-W1 VEN-0）。许可均为 MIT / Apache-2.0 / BSD-3-Clause，无 GPL / AGPL / 商业许可依赖。

| 包 | 版本 | 许可 | 来源 | 产物 | 全局变量 |
|---|---|---|---|---|---|
| hls.js | 1.7.3 | Apache-2.0 | https://github.com/video-dev/hls.js | `hls.min.js` | `Hls` |
| wavesurfer.js（仅核心） | 8.0.2 | BSD-3-Clause | https://github.com/katspaugh/wavesurfer.js | `wavesurfer.min.js` | `WaveSurfer` |
| rrweb-player | 2.1.7 | MIT | https://github.com/rrweb-io/rrweb | `rrweb-player.min.js` + `rrweb-player.css` | `rrwebPlayer` |
| asciinema-player | 3.17.0 | Apache-2.0 | https://github.com/asciinema/asciinema-player | `asciinema-player.min.js` + `asciinema-player.css` | `AsciinemaPlayer` |
| ts-fsrs | 5.4.2 | MIT | https://github.com/open-spaced-repetition/ts-fsrs | `ts-fsrs.min.js` | `FSRS` |

## 被打进产物的传递依赖（均为 MIT，除注明外）

- rrweb-player 产物：rrweb 2.2.0、rrdom 2.2.0、rrweb-snapshot 2.2.0、@rrweb/replay、@rrweb/packer、@rrweb/types、@rrweb/utils（2.2.0）、fflate 0.4.9、mitt 3.0.1、base64-arraybuffer 1.0.2、@xstate/fsm 1.6.5、@babel/runtime 7.29.10、nanoid 3.3.20、postcss 8.5.31、picocolors 1.1.1（ISC）、source-map-js 1.2.2（BSD-3-Clause）
- asciinema-player 产物：solid-js 1.9.17、seroval / seroval-plugins 1.6.12、@solid-primitives/*、solid-transition-group 0.2.3
- 构建工具 esbuild 0.28.2（MIT）只在 devDependencies，不进产物。

版本与完整依赖树以 `tools/vendor/package-lock.json` 为准。打包时 `legalComments: "none"`，本文件是署名与许可声明的集中位置；再分发时请随附本文件。

## R13 VEN-1 追加（2026-10-25，主控）

| 包 | 版本 | 许可 | 全局 | 文件 |
|---|---|---|---|---|
| html-to-image | 1.11.13 | MIT | `htmlToImage` | html-to-image.min.js；另有 html-to-image.src.js，把同一份代码存成字符串 `window.__COMMONS_HTML_TO_IMAGE_SRC`，供注入沙箱 iframe |
| @tiptap/core、starter-kit、extension-placeholder、extension-image、pm | 3.31.4 | MIT | `Tiptap`（Editor、Node、Mark、Extension、mergeAttributes、StarterKit、Placeholder、Image） | tiptap.min.js；内含 prosemirror-*（MIT） |
| livekit-client | 2.22.4 | Apache-2.0 | `LivekitClient` | livekit-client.min.js；依赖 @bufbuild/protobuf（Apache-2.0 AND BSD-3-Clause）、loglevel（MIT）、events（MIT）、sdp（MIT）、tslib（0BSD）等 |

版本都早于 2026-10-11。新依赖树的许可只有 MIT、Apache-2.0、ISC、BSD-3-Clause、0BSD。`preview/vendor` 总量升到约 2.0MB，超过 W1 定的 1.5MB；新增三件都按需加载，交付单文件是否内联由主控另定。
