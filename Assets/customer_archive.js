/* Customer archive module. Does not touch pricing formulas or quote_std_db. */
(function () {
  "use strict";

  var DB_NAME = "customer_archive_db";
  var DB_VER = 1;
  var STORE_CUST = "customers";
  var STORE_REP = "reports";
  var STORE_SET = "settings";
  var ROOT_ID = "pwCustomerRoot";

  var BRAND_MAP = {
    shentong: "申通", yuantong: "圆通", debangkuaidi: "德邦快递", jtexpress: "极兔",
    yunda: "韵达", ems: "EMS", jd: "京东", kuayue: "跨越", shunfeng: "顺丰",
    shunfengkuaiyun: "顺丰快运", sxjdfreight: "顺心捷达", zhongtong: "中通",
    debang: "德邦快递", "德邦": "德邦快递"
  };
  var CANCEL_STATUS = { "用户取消": 1, "订单已取消": 1 };
  var FIELD_DEFS = [
    { key: "customerName", label: "客户名称", aliases: ["客户名称", "客户名", "客户"] },
    { key: "createdAt", label: "创建时间", aliases: ["创建时间", "下单时间", "订单时间"] },
    { key: "orderId", label: "订单ID", aliases: ["订单ID", "订单号", "订单编号"] },
    { key: "company", label: "快递公司", aliases: ["快递公司", "快递商", "承运商", "运力"] },
    { key: "orderStatus", label: "订单状态", aliases: ["订单状态"] },
    { key: "logisticsStatus", label: "物流状态", aliases: ["物流状态"] },
    { key: "settled", label: "是否结算", aliases: ["是否结算"] },
    { key: "weight", label: "计费重量", aliases: ["计费重量", "结算重量"] },
    { key: "sp", label: "发件省份", aliases: ["发件省份", "始发省份", "始发省", "寄件省份"] },
    { key: "sc", label: "发件城市", aliases: ["发件城市", "始发城市", "始发市", "寄件城市"] },
    { key: "rp", label: "收件省份", aliases: ["收件省份", "目的省份", "目的省", "收货省份"] },
    { key: "rc", label: "收件城市", aliases: ["收件城市", "目的城市", "目的市", "收货城市"] },
    { key: "weightBand", label: "重量档位", aliases: ["重量档位"] },
    { key: "cityClass", label: "同城分类", aliases: ["同城分类"] },
    { key: "senderAddr", label: "寄件地址", aliases: ["寄件地址", "发件地址", "发件详细地址", "寄件人地址", "寄件详细地址", "发货地址"] },
    { key: "receiverAddr", label: "收件地址", aliases: ["收件地址", "收货地址", "收件详细地址", "收件人地址", "收件人详细地址"] }
  ];

  var ui = { view: "list", customerId: "", reportId: "", search: "", importState: null, pending: null };
  var cache = { customers: [], reports: [], settings: null };
  var rawAddressHold = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function nowIso() { return new Date().toISOString(); }
  function pct(n, d) { if (!d) return 0; return Math.round((n * 1000) / d) / 10; }
  function fmtPct(n, d) { return pct(n, d).toFixed(1) + "%"; }
  function fmtN(n) { return Number(n || 0).toLocaleString("zh-CN"); }

  function openCaDb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains(STORE_CUST)) db.createObjectStore(STORE_CUST, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_REP)) {
          var st = db.createObjectStore(STORE_REP, { keyPath: "id" });
          st.createIndex("byCustomer", "customerId", { unique: false });
          st.createIndex("byCustomerMonth", ["customerId", "month"], { unique: true });
        }
        if (!db.objectStoreNames.contains(STORE_SET)) db.createObjectStore(STORE_SET, { keyPath: "key" });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }
  function getAll(store) {
    return openCaDb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(store, "readonly").objectStore(store).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function putOne(store, rec) {
    return openCaDb().then(function (db) {
      var tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(rec);
      return txDone(tx);
    });
  }
  function delOne(store, id) {
    return openCaDb().then(function (db) {
      var tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      return txDone(tx);
    });
  }

  function defaultSettings() {
    return {
      key: "thresholds",
      pickupGood: 92,
      pickupWarn: 88,
      pickupBad: 80,
      bulkyRecommendPct: 10,
      sameCityRecommendPct: 10,
      smallSample: 30,
      smartRecommendPickup: 90,
      starCuts: [80, 88, 92, 96]
    };
  }
  function loadSettings() {
    return openCaDb().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction(STORE_SET, "readonly").objectStore(STORE_SET).get("thresholds");
        rq.onsuccess = function () { cache.settings = rq.result || defaultSettings(); res(cache.settings); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function refreshCache() {
    return Promise.all([getAll(STORE_CUST), getAll(STORE_REP), loadSettings()]).then(function (xs) {
      cache.customers = xs[0].sort(function (a, b) { return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); });
      cache.reports = xs[1].sort(function (a, b) { return String(b.month || "").localeCompare(String(a.month || "")); });
    });
  }

  function brandName(code) {
    var raw = String(code || "").trim();
    if (!raw) return "未知";
    var mapped = BRAND_MAP[raw.toLowerCase()] || BRAND_MAP[raw];
    return mapped || raw;
  }
  function parseWeight(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && isFinite(v)) return v;
    var s = String(v).replace(/kg|KG|千克/g, "").trim();
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function parseTime(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === "number" && isFinite(v)) {
      var excel = new Date(Math.round((v - 25569) * 86400 * 1000));
      if (!isNaN(excel.getTime())) return excel;
    }
    var s = String(v || "").trim();
    if (!s) return null;
    var d = new Date(s.replace(/-/g, "/"));
    return isNaN(d.getTime()) ? null : d;
  }
  function monthOf(d) {
    if (!d) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }
  function weightBucket(w) {
    if (w == null || !isFinite(w)) return "unknown";
    if (w <= 5) return "0-5";
    if (w <= 15) return "5-15";
    if (w <= 30) return "15-30";
    return "30+";
  }
  function expectedBand(w) {
    var b = weightBucket(w);
    return { "0-5": "0-5kg", "5-15": "5-15kg", "15-30": "15-30kg", "30+": "30kg以上" }[b] || "";
  }
  function settledYes(v) {
    var s = String(v == null ? "" : v).trim();
    return s === "是" || s === "Y" || s === "y" || s === "1" || s === "true" || s === "TRUE";
  }
  function headerIndex(header) {
    var map = {};
    (header || []).forEach(function (h, i) { map[String(h || "").replace(/^\uFEFF/, "").trim()] = i; });
    return map;
  }
  function matchField(headerMap, aliases) {
    var i, name;
    for (i = 0; i < aliases.length; i++) {
      name = aliases[i];
      if (Object.prototype.hasOwnProperty.call(headerMap, name)) return headerMap[name];
    }
    var keys = Object.keys(headerMap);
    for (i = 0; i < aliases.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].replace(/\s/g, "") === aliases[i].replace(/\s/g, "")) return headerMap[keys[k]];
      }
    }
    return -1;
  }
  function autoMap(header) {
    var hm = headerIndex(header);
    var mapping = {};
    FIELD_DEFS.forEach(function (f) { mapping[f.key] = matchField(hm, f.aliases); });
    return mapping;
  }
  function isOrderSheet(name, rows) {
    if (!rows || !rows.length) return false;
    if (/^sheet1$/i.test(String(name || "").trim()) && !/(寄件|对账|订单|明细)/.test(name)) {
      var h = (rows[0] || []).join(",");
      if (h.indexOf("订单ID") < 0) return false;
    }
    return (rows[0] || []).some(function (c) { return String(c || "").trim() === "订单ID" || String(c || "").trim() === "订单号"; });
  }
  function pickDefaultSheet(sheets) {
    var i, s;
    for (i = 0; i < sheets.length; i++) if (/寄件对账/.test(sheets[i].name)) return i;
    for (i = 0; i < sheets.length; i++) if (isOrderSheet(sheets[i].name, sheets[i].rows)) return i;
    return 0;
  }
  function cell(row, idx) { return idx >= 0 && idx < row.length ? row[idx] : ""; }

  function buildWorkingRows(sheet, mapping) {
    var rows = sheet.rows || [];
    var header = rows[0] || [];
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i] || [];
      out.push({
        _i: i,
        orderId: String(cell(r, mapping.orderId) || "").trim(),
        customerName: String(cell(r, mapping.customerName) || "").trim(),
        createdAt: cell(r, mapping.createdAt),
        company: String(cell(r, mapping.company) || "").trim(),
        orderStatus: String(cell(r, mapping.orderStatus) || "").trim(),
        logisticsStatus: String(cell(r, mapping.logisticsStatus) || "").trim(),
        settled: cell(r, mapping.settled),
        weight: cell(r, mapping.weight),
        existedSp: String(cell(r, mapping.sp) || "").trim(),
        existedSc: String(cell(r, mapping.sc) || "").trim(),
        existedRp: String(cell(r, mapping.rp) || "").trim(),
        existedRc: String(cell(r, mapping.rc) || "").trim(),
        weightBand: String(cell(r, mapping.weightBand) || "").trim(),
        cityClass: String(cell(r, mapping.cityClass) || "").trim(),
        _sender: mapping.senderAddr >= 0 ? cell(r, mapping.senderAddr) : "",
        _receiver: mapping.receiverAddr >= 0 ? cell(r, mapping.receiverAddr) : ""
      });
    }
    return { header: header, rows: out };
  }

  function runAddressParse(working) {
    var addr = window.__pwAddress;
    var originParsed = 0, destParsed = 0, need = 0, mismatch = 0;
    working.rows.forEach(function (row) {
      var sp = addr.parseAddress(row._sender);
      var dp = addr.parseAddress(row._receiver);
      row.origin = addr.mergeSide(sp, row.existedSp, row.existedSc, "始发");
      row.dest = addr.mergeSide(dp, row.existedRp, row.existedRc, "目的");
      if (row.origin.source === "parsed" || row.origin.source === "crossChecked") originParsed++;
      if (row.dest.source === "parsed" || row.dest.source === "crossChecked") destParsed++;
      if (row.origin.mismatch || row.dest.mismatch) mismatch++;
      var unresolved = function (side) {
        return side.mismatch || ((side.parseStatus === "needConfirm" || side.parseStatus === "ambiguous") && !(side.province && side.city));
      };
      if (unresolved(row.origin) || unresolved(row.dest)) need++;
    });
    working.addressStats = {
      total: working.rows.length,
      originParsed: originParsed,
      destParsed: destParsed,
      needConfirm: need,
      mismatch: mismatch
    };
    return working;
  }

  function desensitize(working) {
    rawAddressHold = null;
    working.rows.forEach(function (row) {
      delete row._sender;
      delete row._receiver;
      row.originProvince = row.origin ? row.origin.province : "";
      row.originCity = row.origin ? row.origin.city : "";
      row.destProvince = row.dest ? row.dest.province : "";
      row.destCity = row.dest ? row.dest.city : "";
      row.addressUnknown = !(row.originProvince && row.originCity && row.destProvince && row.destCity) ||
        row.origin.parseStatus === "unknown" || row.dest.parseStatus === "unknown";
    });
    working.desensitized = true;
    working.header = (working.header || []).filter(function (h) {
      var n = String(h || "");
      return ["寄件地址", "发件地址", "发件详细地址", "寄件人地址", "寄件详细地址", "发货地址",
        "收件地址", "收货地址", "收件详细地址", "收件人地址", "收件人详细地址"].indexOf(n) < 0;
    });
  }

  function deriveCityClass(row, w) {
    if (row.addressUnknown) return "地址未知";
    if (window.__pwAddress.isSameCity(row.origin, row.dest)) return (w != null && w <= 5) ? "同城轻件" : "同城重件";
    return "跨城常规件";
  }

  function computeStats(working, customer, fileName, sheetName, settings) {
    var rows = working.rows;
    var ids = {};
    var dups = [];
    var emptyId = 0, badWeight = 0, unknownStatus = 0, nameMismatch = [];
    var weights = { "0-5": 0, "5-15": 0, "15-30": 0, "30+": 0, unknown: 0 };
    var brands = {};
    var success = 0, cancel = 0;
    var sameLight = 0, sameHeavy = 0, cross = 0, addrUnknown = 0;
    var bandMismatch = 0, classMismatch = 0;
    var months = {};
    var names = {};
    var knownStatus = { "已签收": 1, "运输中": 1, "已结算": 1, "用户取消": 1, "订单已取消": 1, "待取件": 1, "已揽收": 1, "派送中": 1 };
    rows.forEach(function (row) {
      if (!row.orderId) { emptyId++; return; }
      if (ids[row.orderId]) dups.push(row.orderId); else ids[row.orderId] = 1;
      names[row.customerName || "(空)"] = (names[row.customerName || "(空)"] || 0) + 1;
      var dt = parseTime(row.createdAt);
      var m = monthOf(dt);
      if (m) months[m] = (months[m] || 0) + 1;
      var w = parseWeight(row.weight);
      if (w == null || w < 0) badWeight++;
      var b = weightBucket(w);
      weights[b] = (weights[b] || 0) + 1;
      if (row.weightBand && expectedBand(w) && row.weightBand.replace(/\s/g, "") !== expectedBand(w) &&
          !(b === "30+" && /30/.test(row.weightBand) && /以上|\+/.test(row.weightBand))) {
        bandMismatch++;
      }
      var bn = brandName(row.company);
      if (!brands[bn]) brands[bn] = { name: bn, orders: 0, success: 0 };
      brands[bn].orders++;
      if (settledYes(row.settled)) { success++; brands[bn].success++; }
      if (CANCEL_STATUS[row.orderStatus]) cancel++;
      if (row.orderStatus && !knownStatus[row.orderStatus]) unknownStatus++;
      var cls = deriveCityClass(row, w);
      if (cls === "地址未知") addrUnknown++;
      else if (cls === "同城轻件") sameLight++;
      else if (cls === "同城重件") sameHeavy++;
      else cross++;
      if (row.cityClass && cls !== "地址未知" && row.cityClass !== cls) classMismatch++;
      if (customer && customer.name && row.customerName && row.customerName !== customer.name) nameMismatch.push(row.customerName);
    });
    var total = Object.keys(ids).length;
    var month = Object.keys(months).sort(function (a, b) { return months[b] - months[a]; })[0] || "";
    var fileCust = Object.keys(names).sort(function (a, b) { return names[b] - names[a]; })[0] || "";
    var brandList = Object.keys(brands).map(function (k) {
      var x = brands[k];
      return {
        name: x.name, orders: x.orders, success: x.success,
        successRate: pct(x.success, x.orders),
        smallSample: x.orders < (settings.smallSample || 30)
      };
    }).sort(function (a, b) { return b.orders - a.orders; });
    var bulky = (weights["15-30"] || 0) + (weights["30+"] || 0);
    var sameTotal = sameLight + sameHeavy;
    var covered = total - addrUnknown;
    var quality = {
      emptyId: emptyId, duplicateIds: dups.length, abnormalWeight: badWeight, unknownStatus: unknownStatus,
      weightBandMismatch: bandMismatch, cityClassMismatch: classMismatch,
      nameMismatchCount: nameMismatch.length, addressUnknown: addrUnknown, addressCoverage: pct(covered, total)
    };
    var suggestions = buildSuggestions({
      total: total, success: success, cancel: cancel, bulky: bulky, sameTotal: sameTotal,
      brandList: brandList, settings: settings, weights: weights, sameLight: sameLight, sameHeavy: sameHeavy
    });
    return {
      customerNameInFile: fileCust,
      month: month,
      fileName: fileName,
      sheetName: sheetName,
      stats: {
        total: total, success: success, successRate: pct(success, total),
        cancel: cancel, cancelRate: pct(cancel, total),
        bulky: bulky, bulkyRate: pct(bulky, total),
        sameCity: sameTotal, sameCityRate: pct(sameTotal, total),
        sameCityLight: sameLight, sameCityHeavy: sameHeavy, cross: cross, addressUnknown: addrUnknown
      },
      brands: brandList,
      weights: { b05: weights["0-5"] || 0, b515: weights["5-15"] || 0, b1530: weights["15-30"] || 0, b30: weights["30+"] || 0, over15: bulky, over30: weights["30+"] || 0, unknown: weights.unknown || 0 },
      city: { sameLight: sameLight, sameHeavy: sameHeavy, sameTotal: sameTotal, cross: cross, unknown: addrUnknown },
      quality: quality,
      suggestions: suggestions,
      thresholdsUsed: settings
    };
  }

  function stars(rate, cuts) {
    var n = 1;
    (cuts || [80, 88, 92, 96]).forEach(function (c) { if (rate >= c) n++; });
    return n;
  }
  function pickupLabel(rate, s) {
    if (rate >= s.pickupGood) return "达到良好阈值（≥" + s.pickupGood + "%）";
    if (rate >= s.pickupWarn) return "介于关注与良好之间";
    if (rate >= s.pickupBad) return "低于关注阈值";
    return "低于偏低阈值（<" + s.pickupBad + "%）";
  }
  function starText(n) {
    var i, s = "";
    for (i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
    return s;
  }

  function buildSuggestions(p) {
    var s = p.settings, list = [], rate = pct(p.success, p.total), bulkyRate = pct(p.bulky, p.total), cityRate = pct(p.sameTotal, p.total);
    if (bulkyRate >= s.bulkyRecommendPct) {
      list.push({ type: "bulky", title: "大件需求达到推荐阈值", body: "＞15kg订单共" + p.bulky + "单，占全部订单约" + bulkyRate.toFixed(1) + "%。建议接入寄大件API，参考运力：壹米滴答、跨越速运、中通快运。" });
    }
    if (cityRate >= s.sameCityRecommendPct) {
      list.push({ type: "city", title: "同城需求达到推荐阈值", body: "同城订单共" + p.sameTotal + "单（轻件" + p.sameLight + "、重件" + p.sameHeavy + "），占比约" + cityRate.toFixed(1) + "%。可推荐同城急送API、同城并呼模式。" });
    }
    if (rate < s.smartRecommendPickup) {
      list.push({ type: "smart", title: "取件表现低于智选运力阈值", body: "综合取件率" + rate.toFixed(1) + "%，低于配置阈值" + s.smartRecommendPickup + "%，可推荐智选运力作为兜底。" });
    }
    p.brandList.forEach(function (b) {
      if (!b.smallSample && b.successRate < s.pickupWarn) {
        list.push({ type: "brand", title: b.name + "取件率低于关注阈值", body: b.name + "订单" + b.orders + "单，成功" + b.success + "单，成功率" + b.successRate.toFixed(1) + "%。" });
      }
    });
    return list;
  }

  function injectCss() {
    if ($("#pwCustomerCss")) return;
    var st = document.createElement("style");
    st.id = "pwCustomerCss";
    st.textContent = [
      ".pw-customer-root{position:fixed;inset:0;z-index:40;overflow:auto;background:var(--pw-page-bg,#F5F7FA);color:var(--pw-text-primary,#1F2937);font-family:var(--pw-font-family,Inter,'Microsoft YaHei UI','Segoe UI',sans-serif);}",
      ".pw-ca{max-width:1180px;margin:0 auto;padding:24px 16px 32px;}",
      ".pw-ca h1{font-size:22px;margin:0 0 8px;font-weight:700;}",
      ".pw-muted{color:var(--pw-text-secondary,#64748B);font-size:13px;}",
      ".pw-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0;}",
      ".pw-card{background:var(--pw-surface,#fff);border:1px solid var(--pw-border,#E5EAF1);border-radius:var(--pw-radius-lg,8px);padding:16px;margin:8px 0;box-shadow:none;}",
      ".pw-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:var(--pw-control-md,32px);padding:0 12px;border:1px solid transparent;border-radius:var(--pw-radius-md,6px);background:transparent;color:var(--pw-text-primary,#1F2937);font-size:13px;font-weight:600;line-height:1.2;cursor:pointer;}",
      ".pw-btn:disabled{opacity:.45;cursor:default;}",
      ".pw-btn-p{background:var(--pw-primary,#0082FB);border-color:var(--pw-primary,#0082FB);color:#fff;}",
      ".pw-btn-p:hover{background:var(--pw-primary-hover,#006FE0);border-color:var(--pw-primary-hover,#006FE0);}",
      ".pw-btn-l{background:var(--pw-surface,#fff);color:var(--pw-text-primary,#1F2937);border:1px solid var(--pw-border,#E5EAF1);}",
      ".pw-btn-l:hover{background:var(--pw-surface-secondary,#F8FAFC);border-color:var(--pw-primary,#0082FB);}",
      ".pw-btn-d{background:var(--pw-surface,#fff);color:var(--pw-danger,#DC4C4C);border:1px solid var(--pw-danger,#DC4C4C);}",
      ".pw-btn-d:hover{background:#FDECEC;}",
      ".pw-input,.pw-select{box-sizing:border-box;min-height:var(--pw-control-md,32px);padding:0 8px;border:1px solid var(--pw-border,#E5EAF1);border-radius:var(--pw-radius-md,6px);min-width:180px;background:var(--pw-surface,#fff);color:var(--pw-text-primary,#1F2937);font-size:13px;font-family:inherit;}",
      ".pw-input:focus,.pw-select:focus{border-color:var(--pw-primary,#0082FB);outline:none;}",
      ".pw-table{width:100%;border-collapse:collapse;background:var(--pw-surface,#fff);color:var(--pw-text-primary,#1F2937);font-size:13px;font-variant-numeric:tabular-nums;}",
      ".pw-table th{background:var(--pw-surface-secondary,#F8FAFC);color:var(--pw-text-secondary,#64748B);padding:8px;font-size:12px;font-weight:600;text-align:left;border-bottom:1px solid var(--pw-border,#E5EAF1);}",
      ".pw-table td{padding:8px;border-bottom:1px solid var(--pw-border,#E5EAF1);}",
      ".pw-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;}",
      ".pw-metric{background:var(--pw-surface-secondary,#F8FAFC);border:1px solid var(--pw-border,#E5EAF1);border-radius:var(--pw-radius-lg,8px);padding:12px;text-align:center;}",
      ".pw-metric b{display:block;font-size:22px;margin-top:4px;font-variant-numeric:tabular-nums;}",
      ".pw-toast{position:fixed;right:24px;bottom:24px;background:var(--pw-text-primary,#1F2937);color:#fff;padding:8px 12px;border-radius:var(--pw-radius-md,6px);z-index:60;}",
      ".pw-hidden{display:none !important;}",
      ".pw-tag{display:inline-block;padding:2px 8px;border-radius:var(--pw-radius-sm,4px);font-size:12px;font-weight:600;}",
      ".pw-ok{background:#E8F6F0;color:var(--pw-success,#16A36A);}.pw-warn{background:#FDF4E8;color:var(--pw-warning,#D97706);}.pw-bad{background:#FDECEC;color:var(--pw-danger,#DC4C4C);}",
      ".pw-report .header{background:var(--pw-primary,#0082FB);color:#fff;border-radius:var(--pw-radius-lg,8px);padding:24px;text-align:center;margin-bottom:16px;}",
      ".pw-bar{height:8px;background:var(--pw-surface-secondary,#F8FAFC);border:1px solid var(--pw-border,#E5EAF1);border-radius:var(--pw-radius-sm,4px);overflow:hidden;}",
      ".pw-bar>i{display:block;height:100%;background:var(--pw-primary,#0082FB);}",
      ".pw-chart{display:flex;gap:16px;align-items:center;flex-wrap:wrap;}",
      ".pw-legend{font-size:12px;color:var(--pw-text-secondary,#64748B);}"
    ].join("");
    document.head.appendChild(st);
  }

  function ensureRoot() {
    var el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ROOT_ID;
      el.className = "pw-customer-root";
      el.hidden = true;
      document.body.appendChild(el);
    }
    injectCss();
    return el;
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "pw-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function reportsOf(cid) {
    return cache.reports.filter(function (r) { return r.customerId === cid; });
  }
  function latestReport(cid) {
    return reportsOf(cid)[0] || null;
  }

  function render() {
    var root = ensureRoot();
    if (ui.view === "list") root.innerHTML = viewList();
    else if (ui.view === "detail") root.innerHTML = viewDetail();
    else if (ui.view === "import") root.innerHTML = viewImport();
    else if (ui.view === "address") root.innerHTML = viewAddress();
    else if (ui.view === "report") root.innerHTML = viewReport();
    else if (ui.view === "settings") root.innerHTML = viewSettings();
    bind();
  }

  function viewList() {
    var q = (ui.search || "").trim();
    var items = cache.customers.filter(function (c) { return !q || (c.name || "").indexOf(q) >= 0; });
    var cards = items.map(function (c) {
      var last = latestReport(c.id);
      return '<div class="pw-card" data-open="' + esc(c.id) + '"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><div>' +
        "<b>" + esc(c.name) + "</b><div class=\"pw-muted\">最近月报 " + esc((last && last.month) || "暂无") +
        " · 订单 " + fmtN(last && last.stats ? last.stats.total : 0) +
        " · 取件成功率 " + (last && last.stats ? last.stats.successRate.toFixed(1) + "%" : "—") + "</div></div>" +
        '<div><button class="pw-btn pw-btn-p" data-open="' + esc(c.id) + '">打开</button> ' +
        '<button class="pw-btn pw-btn-d" data-delc="' + esc(c.id) + '">删除</button></div></div></div>';
    }).join("");
    return '<div class="pw-ca"><h1>客户档案</h1><p class="pw-muted">独立模块，数据保存在 customer_archive_db，不影响报价项目档案。</p>' +
      '<div class="pw-row"><input class="pw-input" id="caSearch" placeholder="搜索客户" value="' + esc(ui.search) + '"/>' +
      '<button class="pw-btn pw-btn-p" id="caAdd">新增客户</button>' +
      '<button class="pw-btn pw-btn-l" id="caSet">阈值设置</button>' +
      '<button class="pw-btn pw-btn-l" id="caRefresh">刷新</button></div>' +
      (items.length ? cards : '<div class="pw-card pw-muted">暂无客户。请先新增客户，再导入月度明细。</div>') + "</div>";
  }

  function viewDetail() {
    var c = cache.customers.filter(function (x) { return x.id === ui.customerId; })[0];
    if (!c) return '<div class="pw-ca"><button class="pw-btn pw-btn-l" id="caBack">返回</button><p>未找到客户</p></div>';
    var reps = reportsOf(c.id);
    var rows = reps.map(function (r) {
      return "<tr><td>" + esc(r.month) + "</td><td>" + fmtN(r.stats.total) + "</td><td>" + r.stats.successRate.toFixed(1) + "%</td><td>" + esc(r.fileName || "") + "</td><td>" +
        '<button class="pw-btn pw-btn-p" data-openr="' + esc(r.id) + '">查看</button> ' +
        '<button class="pw-btn pw-btn-l" data-expr="' + esc(r.id) + '">导出</button> ' +
        '<button class="pw-btn pw-btn-d" data-delr="' + esc(r.id) + '">删除</button></td></tr>';
    }).join("");
    return '<div class="pw-ca"><div class="pw-row"><button class="pw-btn pw-btn-l" id="caBack">返回列表</button></div>' +
      '<div class="pw-card"><h2 style="margin:0 0 8px;">' + esc(c.name) + '</h2><div class="pw-muted">创建于 ' + esc((c.createdAt || "").slice(0, 19).replace("T", " ")) + '</div>' +
      '<div class="pw-row"><button class="pw-btn pw-btn-p" id="caImport">导入月度数据</button>' +
      '<button class="pw-btn pw-btn-l" id="caRename">编辑名称</button></div></div>' +
      '<div class="pw-card"><b>历史月报</b>' + (reps.length ? '<table class="pw-table" style="margin-top:10px;"><thead><tr><th>月份</th><th>订单</th><th>取件成功率</th><th>来源文件</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" : '<p class="pw-muted">尚无月报。</p>') + "</div></div>";
  }

  function viewImport() {
    var st = ui.importState || {};
    var sheets = st.sheets || [];
    var opts = sheets.map(function (s, i) {
      var mark = isOrderSheet(s.name, s.rows) ? "明细" : "可能非明细";
      return '<option value="' + i + '"' + (i === st.sheetIndex ? " selected" : "") + ">" + esc(s.name) + "（" + mark + "，" + Math.max(0, (s.rows.length || 1) - 1) + "行）</option>";
    }).join("");
    var header = (sheets[st.sheetIndex] && sheets[st.sheetIndex].rows[0]) || [];
    var mapping = st.mapping || {};
    var fields = FIELD_DEFS.map(function (f) {
      var cur = mapping[f.key];
      var options = ['<option value="-1">未映射</option>'].concat(header.map(function (h, i) {
        return '<option value="' + i + '"' + (cur === i ? " selected" : "") + ">" + esc(h || ("列" + (i + 1))) + "</option>";
      }));
      return '<label class="pw-muted">' + esc(f.label) + '<select class="pw-select" data-map="' + f.key + '">' + options.join("") + "</select></label>";
    }).join("");
    var preview = "";
    if (sheets[st.sheetIndex]) {
      preview = "<table class=\"pw-table\"><thead><tr>" + header.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        sheets[st.sheetIndex].rows.slice(1, 6).map(function (r) {
          return "<tr>" + header.map(function (_, i) { return "<td>" + esc(r[i] == null ? "" : String(r[i]).slice(0, 24)) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }
    return '<div class="pw-ca"><div class="pw-row"><button class="pw-btn pw-btn-l" id="caBackDetail">返回客户</button></div>' +
      '<div class="pw-card"><b>月度数据导入</b><p class="pw-muted">支持 xlsx / xls / csv。默认优先「寄件对账」，Sheet1 透视表不会作为订单明细。</p>' +
      '<input type="file" id="caFile" accept=".xlsx,.xls,.csv"/>' +
      (sheets.length ? '<div class="pw-row"><label>工作表 <select class="pw-select" id="caSheet">' + opts + "</select></label></div>" : "") +
      (header.length ? '<div class="pw-row" style="align-items:flex-start;">' + fields + "</div><div style=\"overflow:auto;\">" + preview + "</div>" +
        '<div class="pw-row"><button class="pw-btn pw-btn-p" id="caToAddr">识别地址并进入脱敏</button></div>' : "") +
      "</div></div>";
  }

  function viewAddress() {
    var w = ui.pending;
    if (!w) return '<div class="pw-ca">没有待处理数据</div>';
    var filter = ui.addrFilter || "all";
    var rows = w.rows.filter(function (r) {
      if (filter === "issue") return r.origin.mismatch || r.dest.mismatch || ((r.origin.parseStatus === "needConfirm" || r.origin.parseStatus === "ambiguous") && !(r.origin.province && r.origin.city)) || ((r.dest.parseStatus === "needConfirm" || r.dest.parseStatus === "ambiguous") && !(r.dest.province && r.dest.city));
      if (filter === "mismatch") return r.origin.mismatch || r.dest.mismatch;
      if (filter === "unknown") return r.origin.parseStatus === "unknown" || r.dest.parseStatus === "unknown";
      return true;
    });
    var parsed = w.rows.filter(function (r) { return r.origin.source === "parsed" || r.origin.source === "crossChecked" || r.dest.source === "parsed" || r.dest.source === "crossChecked"; }).length;
    var issue = w.addressStats.needConfirm;
    var body = rows.slice(0, 80).map(function (r) {
      var st = (r.origin.mismatch || r.dest.mismatch) ? "差异" : ((r.origin.parseStatus === "needConfirm" || r.dest.parseStatus === "needConfirm") ? "待确认" : "已解析");
      return "<tr><td>" + esc(r.orderId) + "</td><td>" + esc(r.origin.province) + "</td><td>" + esc(r.origin.city) + "</td><td>" + esc(r.dest.province) + "</td><td>" + esc(r.dest.city) + "</td><td>" + st + "</td><td>" +
        esc(r.origin.parseReason || r.dest.parseReason || "") + "</td><td>" +
        '<button class="pw-btn pw-btn-l" data-peek="' + r._i + '">查看原文</button> ' +
        '<button class="pw-btn pw-btn-l" data-fix="' + r._i + '">修正</button> ' +
        '<button class="pw-btn pw-btn-l" data-unk="' + r._i + '">地址未知</button></td></tr>';
    }).join("");
    return '<div class="pw-ca"><h1>地址解析与脱敏</h1>' +
      '<div class="pw-kpi">' +
      metric("原始订单", w.rows.length) + metric("涉及地址解析", parsed) + metric("待人工确认", issue) + metric("解析相关占比", fmtPct(parsed, w.rows.length)) + "</div>" +
      '<p class="pw-muted">默认不展示完整原始地址。确认后将删除寄件/收件详细地址列，月报只使用始发/目的省市。</p>' +
      '<div class="pw-row"><select class="pw-select" id="caAddrFilter"><option value="all"' + (filter === "all" ? " selected" : "") + '>全部</option><option value="issue"' + (filter === "issue" ? " selected" : "") + '>待确认/差异</option><option value="mismatch"' + (filter === "mismatch" ? " selected" : "") + '>字段不一致</option></select>' +
      '<button class="pw-btn pw-btn-p" id="caConfirmMask">确认脱敏并继续</button></div>' +
      '<div class="pw-card" style="overflow:auto;"><table class="pw-table"><thead><tr><th>订单ID</th><th>始发省份</th><th>始发城市</th><th>目的省份</th><th>目的城市</th><th>状态</th><th>原因</th><th></th></tr></thead><tbody>' + body + "</tbody></table>" +
      (w.rows.length > 80 ? '<p class="pw-muted">仅预览前 80 条，确认时处理全部 ' + w.rows.length + " 条。</p>" : "") + "</div></div>";
  }

  function metric(label, val) { return '<div class="pw-metric"><div class="pw-muted">' + esc(label) + "</div><b>" + val + "</b></div>"; }

  function viewReport() {
    var r = cache.reports.filter(function (x) { return x.id === ui.reportId; })[0];
    var c = cache.customers.filter(function (x) { return x.id === (r && r.customerId); })[0];
    if (!r) return "<div class=\"pw-ca\">月报不存在</div>";
    return '<div class="pw-ca pw-report"><div class="pw-row"><button class="pw-btn pw-btn-l" id="caBackDetail">返回客户</button><button class="pw-btn pw-btn-p" id="caExportHtml">导出HTML</button><button class="pw-btn pw-btn-l" id="caPrint">打印/PDF</button></div>' + reportHtml(r, c, false) + "</div>";
  }

  function viewSettings() {
    var s = cache.settings || defaultSettings();
    return '<div class="pw-ca"><div class="pw-row"><button class="pw-btn pw-btn-l" id="caBack">返回</button></div><div class="pw-card"><b>健康评分与建议阈值</b><p class="pw-muted">星级和建议均按这些阈值计算，不会写死评价。</p>' +
      numField("pickupGood", "取件率良好阈值%", s.pickupGood) +
      numField("pickupWarn", "取件率关注阈值%", s.pickupWarn) +
      numField("pickupBad", "取件率偏低阈值%", s.pickupBad) +
      numField("bulkyRecommendPct", "大件推荐阈值%（＞15kg占比）", s.bulkyRecommendPct) +
      numField("sameCityRecommendPct", "同城推荐阈值%", s.sameCityRecommendPct) +
      numField("smartRecommendPickup", "智选运力推荐阈值%（取件率低于此值）", s.smartRecommendPickup) +
      numField("smallSample", "品牌小样本订单数", s.smallSample) +
      '<div class="pw-row"><button class="pw-btn pw-btn-p" id="caSaveSet">保存阈值</button></div></div></div>';
  }
  function numField(k, label, v) {
    return '<label class="pw-muted" style="display:block;margin:8px 0;">' + esc(label) + '<input class="pw-input" data-set="' + k + '" type="number" value="' + esc(v) + '"/></label>';
  }

  function donut(items) {
    var total = items.reduce(function (a, x) { return a + x.value; }, 0) || 1;
    var acc = 0;
    var segs = items.map(function (x) {
      var a0 = acc / total * 2 * Math.PI - Math.PI / 2;
      acc += x.value;
      var a1 = acc / total * 2 * Math.PI - Math.PI / 2;
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var x0 = 80 + 54 * Math.cos(a0), y0 = 80 + 54 * Math.sin(a0);
      var x1 = 80 + 54 * Math.cos(a1), y1 = 80 + 54 * Math.sin(a1);
      return '<path d="M80,80 L' + x0 + "," + y0 + " A54,54 0 " + large + " 1 " + x1 + "," + y1 + ' Z" fill="' + x.color + '"/>';
    }).join("");
    var legend = items.map(function (x) { return '<div class="pw-legend"><span style="display:inline-block;width:10px;height:10px;background:' + x.color + ';border-radius:2px;"></span> ' + esc(x.name) + " " + x.value + "（" + fmtPct(x.value, total) + "）</div>"; }).join("");
    return '<div class="pw-chart"><svg width="160" height="160" viewBox="0 0 160 160">' + segs + '<circle cx="80" cy="80" r="28" fill="#fff"/></svg><div>' + legend + "</div></div>";
  }
  function bars(items) {
    return items.map(function (x) {
      return '<div style="margin:8px 0;"><div class="pw-muted">' + esc(x.name) + " " + x.value + (x.suffix || "") + "</div><div class=\"pw-bar\"><i style=\"width:" + Math.max(2, x.pct) + '%;background:' + (x.color || "#0082FB") + ';"></i></div></div>';
    }).join("");
  }

  function reportHtml(r, c, standalone, themeCss) {
    var s = r.stats, w = r.weights, city = r.city, th = r.thresholdsUsed || defaultSettings();
    var name = (c && c.name) || r.customerNameInFile || "客户";
    var pickupTxt = pickupLabel(s.successRate, th);
    var findings = (r.suggestions || []).map(function (x, i) {
      return '<div class="pw-card"><b>' + (i + 1) + ". " + esc(x.title) + "</b><p class=\"pw-muted\">" + esc(x.body) + "</p></div>";
    }).join("") || '<div class="pw-card pw-muted">当前数据未触发任何已配置的建议阈值。</div>';
    var brandRows = (r.brands || []).map(function (b) {
      var tag = b.smallSample ? '<span class="pw-tag pw-warn">小样本</span>' : (b.successRate >= th.pickupGood ? '<span class="pw-tag pw-ok">达良好阈值</span>' : (b.successRate < th.pickupWarn ? '<span class="pw-tag pw-bad">低于关注阈值</span>' : '<span class="pw-tag pw-warn">关注</span>'));
      return "<tr><td>" + esc(b.name) + "</td><td>" + b.orders + "</td><td>" + b.success + "</td><td>" + b.successRate.toFixed(1) + "%</td><td>" + tag + "</td></tr>";
    }).join("");
    var starP = stars(s.successRate, th.starCuts);
    var html = '<div class="header"><h1>' + esc(name) + " · 寄件健康与业务洞察月报</h1><p>统计月份：" + esc(r.month) + " · 数据文件：" + esc(r.fileName || "") + "</p></div>" +
      '<div class="pw-card"><div class="pw-muted">01 月度核心经营指标</div><div class="pw-kpi">' +
      metric("订单总量", fmtN(s.total)) + metric("取件成功量", fmtN(s.success)) + metric("取件成功率", s.successRate.toFixed(1) + "%") + metric("取消量 / 取消率", fmtN(s.cancel) + " / " + s.cancelRate.toFixed(1) + "%") + "</div>" +
      '<p class="pw-muted">取件成功按是否结算=是统计。分母均为订单总量 ' + fmtN(s.total) + "。</p></div>" +
      '<div class="pw-card"><div class="pw-muted">02 客户寄递健康诊断</div><div class="pw-kpi">' +
      metric("取件表现", s.successRate.toFixed(1) + "%") + metric("大件订单占比", s.bulkyRate.toFixed(1) + "%") + metric("同城订单占比", s.sameCityRate.toFixed(1) + "%") + metric("地址解析覆盖率", (r.quality && r.quality.addressCoverage != null ? r.quality.addressCoverage.toFixed(1) : "100.0") + "%") + "</div>" +
      "<p>" + esc(pickupTxt) + "。大件阈值 " + th.bulkyRecommendPct + "%，同城阈值 " + th.sameCityRecommendPct + "%。</p>" + findings + "</div>" +
      '<div class="pw-card"><div class="pw-muted">03 重量结构分析</div><div class="pw-kpi">' +
      metric("0-5kg", w.b05 + " / " + fmtPct(w.b05, s.total)) + metric("5-15kg", w.b515 + " / " + fmtPct(w.b515, s.total)) + metric("15-30kg", w.b1530 + " / " + fmtPct(w.b1530, s.total)) + metric("30kg以上", w.b30 + " / " + fmtPct(w.b30, s.total)) + "</div>" +
      "<p>15kg以上 " + w.over15 + " 单，占比 " + s.bulkyRate.toFixed(1) + "%；30kg以上 " + w.over30 + " 单。分档合计 " + (w.b05 + w.b515 + w.b1530 + w.b30) + "。</p>" +
      donut([{ name: "0-5kg", value: w.b05, color: "#0082FB" }, { name: "5-15kg", value: w.b515, color: "#94A3B8" }, { name: "15-30kg", value: w.b1530, color: "#D97706" }, { name: "30kg以上", value: w.b30, color: "#DC4C4C" }]) + "</div>" +
      '<div class="pw-card"><div class="pw-muted">04 同城业务分析</div><div class="pw-kpi">' +
      metric("同城轻件", city.sameLight + " / " + fmtPct(city.sameLight, s.total)) + metric("同城重件", city.sameHeavy + " / " + fmtPct(city.sameHeavy, s.total)) + metric("同城总量", city.sameTotal + " / " + fmtPct(city.sameTotal, s.total)) + metric("跨城订单", city.cross + " / " + fmtPct(city.cross, s.total)) + "</div>" +
      (city.unknown ? '<p class="pw-muted">地址未知 ' + city.unknown + " 单不计入同城/跨城，但仍计入总订单。</p>" : "") +
      donut([{ name: "跨城常规件", value: city.cross, color: "#94A3B8" }, { name: "同城轻件", value: city.sameLight, color: "#0082FB" }, { name: "同城重件", value: city.sameHeavy, color: "#D97706" }]) + "</div>" +
      '<div class="pw-card"><div class="pw-muted">05 快递品牌取件表现</div><table class="pw-table"><thead><tr><th>品牌</th><th>订单量</th><th>成功量</th><th>成功率</th><th></th></tr></thead><tbody>' + brandRows + "</tbody></table>" +
      bars((r.brands || []).map(function (b) { return { name: b.name + " 成功率", value: b.successRate.toFixed(1) + "%", pct: b.successRate, color: b.successRate < th.pickupWarn ? "#DC4C4C" : "#16A36A" }; })) +
      "<p class=\"pw-muted\">各品牌订单量合计 " + (r.brands || []).reduce(function (a, b) { return a + b.orders; }, 0) + "。</p></div>" +
      '<div class="pw-card"><div class="pw-muted">06 综合评估与业务建议</div><p>取件率星级 ' + starText(starP) + "（按阈值 " + (th.starCuts || []).join("/") + " 计算）。</p>" + findings +
      '<p class="pw-muted">本报告数字全部由本次导入数据生成。不含寄件地址、电话或快递员等明细。</p></div>';
    if (standalone) {
      return "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"/><title>" + esc(name) + "月报 " + esc(r.month) + "</title><style>" + (themeCss || "") + ($("#pwCustomerCss") ? $("#pwCustomerCss").textContent : "") + "body{margin:0;padding:16px;background:var(--pw-page-bg,#F5F7FA);}</style></head><body class=\"pw-report pw-ca\">" + html + "</body></html>";
    }
    return html;
  }

  function bind() {
    var root = ensureRoot();
    function on(id, fn) { var el = $("#" + id, root); if (el) el.addEventListener("click", fn); }
    on("caAdd", function () {
      var name = prompt("客户名称");
      if (!name) return;
      var rec = { id: "cust_" + Date.now(), name: name.trim(), createdAt: nowIso(), updatedAt: nowIso() };
      putOne(STORE_CUST, rec).then(refreshCache).then(function () { ui.customerId = rec.id; ui.view = "detail"; render(); });
    });
    on("caRefresh", function () { refreshCache().then(render); });
    on("caSet", function () { ui.view = "settings"; render(); });
    on("caBack", function () { ui.view = "list"; render(); });
    on("caBackDetail", function () { ui.view = "detail"; render(); });
    on("caRename", function () {
      var c = cache.customers.filter(function (x) { return x.id === ui.customerId; })[0];
      var name = prompt("客户名称", c ? c.name : "");
      if (!name || !c) return;
      c.name = name.trim(); c.updatedAt = nowIso();
      putOne(STORE_CUST, c).then(refreshCache).then(render);
    });
    on("caImport", function () { ui.importState = { sheets: [], sheetIndex: 0, mapping: {}, fileName: "" }; ui.view = "import"; render(); });
    on("caSaveSet", function () {
      var s = Object.assign(defaultSettings(), cache.settings || {});
      root.querySelectorAll("[data-set]").forEach(function (inp) { s[inp.getAttribute("data-set")] = Number(inp.value); });
      putOne(STORE_SET, s).then(loadSettings).then(function () { toast("阈值已保存"); ui.view = "list"; render(); });
    });
    var search = $("#caSearch", root);
    if (search) search.addEventListener("input", function () { ui.search = search.value; });
    root.querySelectorAll("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () { ui.customerId = b.getAttribute("data-open"); ui.view = "detail"; render(); });
    });
    root.querySelectorAll("[data-delc]").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = b.getAttribute("data-delc");
        var c = cache.customers.filter(function (x) { return x.id === id; })[0];
        if (!confirm("确定删除客户「" + (c && c.name) + "」及其月报？")) return;
        var ops = reportsOf(id).map(function (r) { return delOne(STORE_REP, r.id); });
        Promise.all(ops.concat([delOne(STORE_CUST, id)])).then(refreshCache).then(function () { ui.view = "list"; render(); });
      });
    });
    root.querySelectorAll("[data-openr]").forEach(function (b) {
      b.addEventListener("click", function () { ui.reportId = b.getAttribute("data-openr"); ui.view = "report"; render(); });
    });
    root.querySelectorAll("[data-delr]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-delr");
        if (!confirm("确定删除该月份月报？")) return;
        delOne(STORE_REP, id).then(refreshCache).then(render);
      });
    });
    root.querySelectorAll("[data-expr]").forEach(function (b) {
      b.addEventListener("click", function () { exportReport(b.getAttribute("data-expr")); });
    });
    on("caExportHtml", function () { exportReport(ui.reportId); });
    on("caPrint", function () { window.print(); });
    var file = $("#caFile", root);
    if (file) file.addEventListener("change", onFile);
    var sheet = $("#caSheet", root);
    if (sheet) sheet.addEventListener("change", function () {
      ui.importState.sheetIndex = Number(sheet.value);
      ui.importState.mapping = autoMap((ui.importState.sheets[ui.importState.sheetIndex].rows[0]) || []);
      render();
    });
    root.querySelectorAll("[data-map]").forEach(function (sel) {
      sel.addEventListener("change", function () { ui.importState.mapping[sel.getAttribute("data-map")] = Number(sel.value); });
    });
    on("caToAddr", goAddress);
    on("caConfirmMask", confirmMask);
    var flt = $("#caAddrFilter", root);
    if (flt) flt.addEventListener("change", function () { ui.addrFilter = flt.value; render(); });
    root.querySelectorAll("[data-peek]").forEach(function (b) {
      b.addEventListener("click", function () {
        var row = findPending(Number(b.getAttribute("data-peek")));
        alert("仅本次查看，不会写入档案。\n寄件：" + String((row && row._sender) || "（无）").slice(0, 180) + "\n收件：" + String((row && row._receiver) || "（无）").slice(0, 180));
      });
    });
    root.querySelectorAll("[data-unk]").forEach(function (b) {
      b.addEventListener("click", function () {
        var row = findPending(Number(b.getAttribute("data-unk")));
        if (!row) return;
        row.origin.parseStatus = "unknown"; row.dest.parseStatus = "unknown";
        row.origin.province = ""; row.origin.city = ""; row.dest.province = ""; row.dest.city = "";
        toast("已标记为地址未知"); render();
      });
    });
    root.querySelectorAll("[data-fix]").forEach(function (b) {
      b.addEventListener("click", function () {
        var row = findPending(Number(b.getAttribute("data-fix")));
        if (!row) return;
        var sp = prompt("始发省份", row.origin.province || "");
        var sc = prompt("始发城市", row.origin.city || "");
        var dp = prompt("目的省份", row.dest.province || "");
        var dc = prompt("目的城市", row.dest.city || "");
        if (sp == null) return;
        row.origin.province = sp.trim(); row.origin.city = (sc || "").trim();
        row.dest.province = (dp || "").trim(); row.dest.city = (dc || "").trim();
        row.origin.parseStatus = "manual"; row.dest.parseStatus = "manual";
        row.origin.mismatch = false; row.dest.mismatch = false;
        render();
      });
    });
  }

  function findPending(i) {
    return ui.pending ? ui.pending.rows.filter(function (r) { return r._i === i; })[0] : null;
  }

  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var sheets = readWorkbook(f.name, reader.result);
        var idx = pickDefaultSheet(sheets);
        ui.importState = { fileName: f.name, sheets: sheets, sheetIndex: idx, mapping: autoMap((sheets[idx].rows[0]) || []) };
        render();
      } catch (err) { toast("读取失败：" + (err.message || err)); }
    };
    if (/\.csv$/i.test(f.name)) reader.readAsText(f); else reader.readAsArrayBuffer(f);
  }

  function readWorkbook(name, data) {
    if (/\.csv$/i.test(name)) {
      var text = typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);
      return [{ name: name, rows: parseCsv(text) }];
    }
    if (typeof XLSX === "undefined") throw new Error("本地 SheetJS 尚未加载");
    var wb = XLSX.read(data, { type: "array", cellDates: true, raw: false });
    return wb.SheetNames.map(function (n) {
      return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: false }) };
    });
  }
  function parseCsv(text) {
    var lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (l) { return l !== ""; });
    return lines.map(function (line) {
      var out = [], cur = "", q = false, i, ch;
      for (i = 0; i < line.length; i++) {
        ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });
  }

  function goAddress() {
    var st = ui.importState;
    if (!st || !st.sheets.length) return toast("请先选择文件");
    var sheet = st.sheets[st.sheetIndex];
    if (!isOrderSheet(sheet.name, sheet.rows) && !confirm("当前工作表可能不是订单明细（例如透视表）。仍要继续？")) return;
    if (st.mapping.orderId < 0) return toast("必须映射订单ID");
    var cust = cache.customers.filter(function (x) { return x.id === ui.customerId; })[0];
    var working = buildWorkingRows(sheet, st.mapping);
    var names = {};
    working.rows.forEach(function (r) { if (r.customerName) names[r.customerName] = (names[r.customerName] || 0) + 1; });
    var topName = Object.keys(names).sort(function (a, b) { return names[b] - names[a]; })[0];
    if (cust && topName && topName !== cust.name) {
      if (!confirm("文件中的客户名称是「" + topName + "」，当前客户是「" + cust.name + "」。不得直接导入。是否仍要作为该客户继续？")) return;
    }
    Promise.resolve(window.__pwAddress.load()).then(function () {
      rawAddressHold = working;
      runAddressParse(working);
      ui.pending = working;
      ui.pending.fileName = st.fileName;
      ui.pending.sheetName = sheet.name;
      ui.view = "address";
      render();
    }).catch(function (err) { toast("地址字典加载失败：" + (err.message || err)); });
  }

  function confirmMask() {
    var w = ui.pending;
    if (!w) return;
    var blocking = w.rows.filter(function (r) {
      var oBad = r.origin.mismatch || ((r.origin.parseStatus === "needConfirm" || r.origin.parseStatus === "ambiguous") && !(r.origin.province && r.origin.city));
      var dBad = r.dest.mismatch || ((r.dest.parseStatus === "needConfirm" || r.dest.parseStatus === "ambiguous") && !(r.dest.province && r.dest.city));
      return oBad || dBad;
    });
    if (blocking.length) {
      if (!confirm("仍有 " + blocking.length + " 条待确认或字段不一致。不能假装全部解析成功。可逐条修正或标记地址未知。是否仅将未解决问题保留为地址未知并继续？")) return;
      blocking.forEach(function (r) {
        if (r.origin.mismatch || r.origin.parseStatus === "needConfirm" || r.origin.parseStatus === "ambiguous") {
          if (!(r.origin.province && r.origin.city)) { r.origin.parseStatus = "unknown"; r.origin.province = ""; r.origin.city = ""; }
        }
        if (r.dest.mismatch || r.dest.parseStatus === "needConfirm" || r.dest.parseStatus === "ambiguous") {
          if (!(r.dest.province && r.dest.city)) { r.dest.parseStatus = "unknown"; r.dest.province = ""; r.dest.city = ""; }
        }
      });
    }
    desensitize(w);
    var cust = cache.customers.filter(function (x) { return x.id === ui.customerId; })[0];
    var settings = cache.settings || defaultSettings();
    var computed = computeStats(w, cust, w.fileName, w.sheetName, settings);
    if (cust && computed.customerNameInFile && computed.customerNameInFile !== cust.name && computed.customerNameInFile !== "(空)") {
      if (!confirm("统计到的客户名称为「" + computed.customerNameInFile + "」，与当前客户不一致。取消则不保存。")) return;
    }
    saveReport(cust, computed, w);
  }

  function saveReport(cust, computed, working) {
    var month = computed.month;
    if (!month) return toast("无法从创建时间识别统计月份");
    var existing = cache.reports.filter(function (r) { return r.customerId === cust.id && r.month === month; })[0];
    if (existing && !confirm("该客户已有 " + month + " 月报。继续将覆盖，不会静默重复保存。是否覆盖？")) return;
    var rec = {
      id: existing ? existing.id : ("rep_" + cust.id + "_" + month),
      customerId: cust.id,
      month: month,
      importedAt: nowIso(),
      fileName: computed.fileName,
      sheetName: computed.sheetName,
      customerNameInFile: computed.customerNameInFile,
      stats: computed.stats,
      brands: computed.brands,
      weights: computed.weights,
      city: computed.city,
      suggestions: computed.suggestions,
      quality: computed.quality,
      thresholdsUsed: computed.thresholdsUsed
    };
    if (JSON.stringify(rec).indexOf("寄件地址") >= 0 || (working.rows[0] && working.rows[0]._sender)) {
      toast("拒绝保存：工作数据仍含原始地址");
      return;
    }
    putOne(STORE_REP, rec).then(function () {
      cust.updatedAt = nowIso();
      return putOne(STORE_CUST, cust);
    }).then(refreshCache).then(function () {
      ui.pending = null;
      rawAddressHold = null;
      ui.reportId = rec.id;
      ui.view = "report";
      render();
      toast("已生成 " + month + " 月报");
    });
  }

  function readLoadedThemeCss() {
    var node = document.getElementById("pw-theme-css");
    if (!node || !node.sheet) return "";
    try {
      var text = "";
      var rules = node.sheet.cssRules;
      for (var i = 0; i < rules.length; i++) text += rules[i].cssText + "\n";
      return text.indexOf("--pw-primary") >= 0 ? text : "";
    } catch (e) {
      return "";
    }
  }
  function downloadReportHtml(html, fileName) {
    if (/寄件地址|收件地址|快递员/.test(html)) { toast("导出已拦截：检测到详细地址痕迹"); return; }
    if (html.indexOf("--pw-primary") < 0) { toast("主题变量未能写入导出文件"); return; }
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportReport(id) {
    var r = cache.reports.filter(function (x) { return x.id === id; })[0];
    var c = cache.customers.filter(function (x) { return x.id === (r && r.customerId); })[0];
    if (!r) return;
    var fileName = (c ? c.name : "客户") + "_寄件健康月报_" + r.month + ".html";
    var inline = readLoadedThemeCss();
    if (inline) {
      downloadReportHtml(reportHtml(r, c, true, inline), fileName);
      return;
    }
    fetch("./theme/pw-theme.css").then(function (resp) {
      if (!resp.ok) throw new Error("无法读取主题文件");
      return resp.text();
    }).then(function (css) {
      downloadReportHtml(reportHtml(r, c, true, css), fileName);
    }).catch(function (err) {
      toast(String(err && err.message || err));
    });
  }

  function show() {
    var wrap = document.querySelector(".wrap");
    if (wrap) wrap.style.display = "none";
    ensureRoot().hidden = false;
    Promise.all([window.__pwAddress ? window.__pwAddress.load() : Promise.resolve(), refreshCache()]).then(render);
  }
  function hide() {
    var root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    var wrap = document.querySelector(".wrap");
    if (wrap) wrap.style.display = "";
  }

  window.__pwCustomer = { show: show, hide: hide, handle: function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "customer.show") show();
    if (msg.type === "customer.hide") hide();
  } };
})();
