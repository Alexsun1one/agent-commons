/* R13 QR-1 · 离线二维码：字节模式、M 级纠错、版本 1–10、自动择优掩码。 */
(function () {
  'use strict';

  var BLOCKS = [
    null,
    [[1, 26, 16]],
    [[1, 44, 28]],
    [[1, 70, 44]],
    [[2, 50, 32]],
    [[2, 67, 43]],
    [[4, 43, 27]],
    [[4, 49, 31]],
    [[2, 60, 38], [2, 61, 39]],
    [[3, 58, 36], [2, 59, 37]],
    [[4, 69, 43], [1, 70, 44]]
  ];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  var EXP = new Array(512);
  var LOG = new Array(256);

  (function makeField() {
    var value = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = value;
      LOG[value] = i;
      value <<= 1;
      if (value & 0x100) value ^= 0x11d;
    }
    for (var j = 255; j < EXP.length; j++) EXP[j] = EXP[j - 255];
  })();

  function utf8(text) {
    var out = [];
    var source = String(text == null ? '' : text);
    for (var i = 0; i < source.length; i++) {
      var point = source.charCodeAt(i);
      if (point >= 0xd800 && point <= 0xdbff && i + 1 < source.length) {
        var low = source.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
          i += 1;
        } else point = 0xfffd;
      } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;
      if (point < 0x80) out.push(point);
      else if (point < 0x800) out.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
      else if (point < 0x10000) out.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
      else out.push(0xf0 | (point >>> 18), 0x80 | ((point >>> 12) & 0x3f), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
    }
    return out;
  }

  function appendBits(bits, value, length) {
    for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  function blockList(version) {
    var out = [];
    BLOCKS[version].forEach(function (spec) {
      for (var i = 0; i < spec[0]; i++) out.push({ total: spec[1], data: spec[2] });
    });
    return out;
  }

  function capacity(version) {
    return blockList(version).reduce(function (sum, block) { return sum + block.data; }, 0);
  }

  function multiply(a, b) {
    return a && b ? EXP[LOG[a] + LOG[b]] : 0;
  }

  function generator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= multiply(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function remainder(data, degree) {
    var gen = generator(degree);
    var result = new Array(degree).fill(0);
    data.forEach(function (byte) {
      var factor = byte ^ result[0];
      result.shift();
      result.push(0);
      for (var i = 0; i < degree; i++) result[i] ^= multiply(gen[i + 1], factor);
    });
    return result;
  }

  function codewords(bytes, version) {
    var blocks = blockList(version);
    var dataCount = capacity(version);
    var bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (byte) { appendBits(bits, byte, 8); });
    if (bits.length > dataCount * 8) return null;
    for (var end = Math.min(bits.length + 4, dataCount * 8); bits.length < end;) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    for (var pad = 0; data.length < dataCount; pad++) data.push(pad % 2 ? 0x11 : 0xec);

    var offset = 0;
    var chunks = blocks.map(function (block) {
      var part = data.slice(offset, offset + block.data);
      offset += block.data;
      return { data: part, ecc: remainder(part, block.total - block.data) };
    });
    var out = [];
    var maxData = Math.max.apply(null, chunks.map(function (block) { return block.data.length; }));
    var maxEcc = Math.max.apply(null, chunks.map(function (block) { return block.ecc.length; }));
    for (var x = 0; x < maxData; x++) chunks.forEach(function (block) { if (x < block.data.length) out.push(block.data[x]); });
    for (var y = 0; y < maxEcc; y++) chunks.forEach(function (block) { if (y < block.ecc.length) out.push(block.ecc[y]); });
    return out;
  }

  function bit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  function maskAt(mask, x, y) {
    if (mask === 0) return (x + y) % 2 === 0;
    if (mask === 1) return y % 2 === 0;
    if (mask === 2) return x % 3 === 0;
    if (mask === 3) return (x + y) % 3 === 0;
    if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    if (mask === 5) return (x * y) % 2 + (x * y) % 3 === 0;
    if (mask === 6) return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }

  function matrix(version, words, mask) {
    var size = version * 4 + 17;
    var cells = Array.from({ length: size }, function () { return new Array(size).fill(false); });
    var fixed = Array.from({ length: size }, function () { return new Array(size).fill(false); });
    var set = function (x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      cells[y][x] = !!dark;
      fixed[y][x] = true;
    };
    var finder = function (cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var distance = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
        }
      }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    ALIGN[version].forEach(function (cy) {
      ALIGN[version].forEach(function (cx) {
        if (fixed[cy][cx]) return;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    for (var t = 8; t < size - 8; t++) {
      if (!fixed[6][t]) set(t, 6, t % 2 === 0);
      if (!fixed[t][6]) set(6, t, t % 2 === 0);
    }

    var drawFormat = function () {
      var data = mask;
      var rest = data;
      for (var i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
      var bits = ((data << 10) | rest) ^ 0x5412;
      for (var a = 0; a <= 5; a++) set(8, a, bit(bits, a));
      set(8, 7, bit(bits, 6));
      set(8, 8, bit(bits, 7));
      set(7, 8, bit(bits, 8));
      for (var b = 9; b < 15; b++) set(14 - b, 8, bit(bits, b));
      for (var c = 0; c < 8; c++) set(size - 1 - c, 8, bit(bits, c));
      for (var d = 8; d < 15; d++) set(8, size - 15 + d, bit(bits, d));
      set(8, size - 8, true);
    };
    drawFormat();

    if (version >= 7) {
      var rem = version;
      for (var v = 0; v < 12; v++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      var versionBits = (version << 12) | rem;
      for (var p = 0; p < 18; p++) {
        var dark = bit(versionBits, p);
        var aa = size - 11 + p % 3;
        var bb = Math.floor(p / 3);
        set(aa, bb, dark);
        set(bb, aa, dark);
      }
    }

    var index = 0;
    var upward = true;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (var vert = 0; vert < size; vert++) {
        var y = upward ? size - 1 - vert : vert;
        for (var side = 0; side < 2; side++) {
          var x = right - side;
          if (fixed[y][x]) continue;
          var value = index < words.length * 8 && bit(words[index >>> 3], 7 - (index & 7));
          cells[y][x] = value !== maskAt(mask, x, y);
          index += 1;
        }
      }
      upward = !upward;
    }
    return cells;
  }

  function penalty(cells) {
    var size = cells.length;
    var score = 0;
    var line = function (get) {
      var run = 1;
      for (var i = 1; i < size; i++) {
        if (get(i) === get(i - 1)) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
      for (var start = 0; start <= size - 11; start++) {
        var first = true;
        var second = true;
        var a = [false, false, false, false, true, false, true, true, true, false, true];
        var b = [true, false, true, true, true, false, true, false, false, false, false];
        for (var k = 0; k < 11; k++) {
          if (get(start + k) !== a[k]) first = false;
          if (get(start + k) !== b[k]) second = false;
        }
        if (first || second) score += 40;
      }
    };
    for (var y = 0; y < size; y++) line(function (x) { return cells[y][x]; });
    for (var x = 0; x < size; x++) line(function (y) { return cells[y][x]; });
    for (var row = 0; row < size - 1; row++) {
      for (var col = 0; col < size - 1; col++) {
        var color = cells[row][col];
        if (cells[row][col + 1] === color && cells[row + 1][col] === color && cells[row + 1][col + 1] === color) score += 3;
      }
    }
    var dark = 0;
    cells.forEach(function (row) { row.forEach(function (cell) { if (cell) dark += 1; }); });
    var balance = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
    score += Math.max(0, balance) * 10;
    return score;
  }

  function encode(text) {
    var bytes = utf8(text);
    var version = 0;
    for (var i = 1; i <= 10; i++) {
      var countBits = i < 10 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= capacity(i) * 8) { version = i; break; }
    }
    if (!version) return null;
    var words = codewords(bytes, version);
    var best = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var cells = matrix(version, words, mask);
      var score = penalty(cells);
      if (score < bestScore) {
        best = cells;
        bestScore = score;
      }
    }
    return best;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  /* safe-fn: 只输出固定 SVG 结构；标签经 esc，路径只由整数模块坐标生成。 */
  function svg(text, opts) {
    var cells = encode(text);
    if (!cells) return '';
    opts = opts || {};
    var quiet = 4;
    var size = cells.length + quiet * 2;
    var path = '';
    cells.forEach(function (row, y) {
      row.forEach(function (dark, x) {
        if (dark) path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      });
    });
    var label = esc(opts.label || '链接二维码');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + label +
      '" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" d="' +
      /* safe: path 只含由模块整数坐标生成的 M/h/v/z 命令 */ path + '"></path></svg>';
  }

  window.CommonsQR = { svg: svg };
})();
