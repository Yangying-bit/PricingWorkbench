/* Customer-archive address parser. Independent of pricing formulas. Offline only. */
(function (global) {
  "use strict";

  var MUNICIPALITIES = { "北京": 1, "天津": 1, "上海": 1, "重庆": 1 };
  var SUFFIXES = ["维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治州", "自治区", "地区", "盟", "省", "市", "县", "区", "旗"];

  function text(v) {
    return v == null ? "" : String(v).replace(/\s+/g, "").trim();
  }

  function stripPhone(s) {
    return String(s || "").replace(/1[3-9]\d{9}/g, " ").replace(/[0-9]{3,}-[0-9]{7,}/g, " ");
  }

  function normKey(s) {
    var t = text(s);
    if (!t) return "";
    t = t.replace(/维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省/g, "");
    if (t === "北京市" || t === "天津市" || t === "上海市" || t === "重庆市") {
      t = t.replace("市", "");
    }
    if (t.endsWith("市") && t.length > 2 && !MUNICIPALITIES[t.replace("市", "")]) {
      t = t.slice(0, -1);
    }
    return t;
  }

  function sameRegion(a, b) {
    var x = normKey(a), y = normKey(b);
    return !!(x && y && x === y);
  }

  function Index(admin) {
    this.admin = admin || {};
    this.provinces = [];
    this.cities = [];
    this.counties = [];
    this.cityByAlias = {};
    this.provByAlias = {};
    this.countyByAlias = {};
    this.ambiguous = {};
    (admin.ambiguous || []).forEach(function (n) { this.ambiguous[n] = 1; }, this);
    (admin.provinces || []).forEach(function (p) {
      this.provinces.push(p);
      (p.aliases || []).concat([p.short, p.full]).forEach(function (a) {
        if (a) this.provByAlias[a] = p;
      }, this);
    }, this);
    (admin.cities || []).forEach(function (c) {
      this.cities.push(c);
      (c.aliases || []).concat([c.short, c.full]).forEach(function (a) {
        if (!a) return;
        if (!this.cityByAlias[a]) this.cityByAlias[a] = [];
        this.cityByAlias[a].push(c);
      }, this);
    }, this);
    (admin.counties || []).forEach(function (c) {
      this.counties.push(c);
      (c.aliases || []).forEach(function (a) {
        if (!a || this.ambiguous[a]) return;
        if (!this.countyByAlias[a]) this.countyByAlias[a] = [];
        this.countyByAlias[a].push(c);
      }, this);
    }, this);
    this.provNames = Object.keys(this.provByAlias).sort(function (a, b) { return b.length - a.length; });
    this.cityNames = Object.keys(this.cityByAlias).sort(function (a, b) { return b.length - a.length; });
    this.countyNames = Object.keys(this.countyByAlias).sort(function (a, b) { return b.length - a.length; });
  }

  Index.prototype.findProv = function (s) {
    var i, name;
    for (i = 0; i < this.provNames.length; i++) {
      name = this.provNames[i];
      if (name.length >= 2 && s.indexOf(name) >= 0) return { alias: name, rec: this.provByAlias[name] };
    }
    return null;
  };

  Index.prototype.findCity = function (s, provShort) {
    var i, name, list, unique, j;
    for (i = 0; i < this.cityNames.length; i++) {
      name = this.cityNames[i];
      if (name.length < 2 || s.indexOf(name) < 0) continue;
      list = this.cityByAlias[name] || [];
      if (provShort) {
        list = list.filter(function (c) { return c.province === provShort; });
      }
      if (!list.length) continue;
      unique = [list[0]];
      for (j = 1; j < list.length; j++) {
        if (list[j].province !== unique[0].province || list[j].full !== unique[0].full) unique.push(list[j]);
      }
      if (unique.length === 1) return { alias: name, rec: unique[0], ambiguous: false };
      return { alias: name, rec: null, ambiguous: true, candidates: unique };
    }
    return null;
  };

  Index.prototype.findCounty = function (s, provShort) {
    var i, name, list, unique, j;
    for (i = 0; i < this.countyNames.length; i++) {
      name = this.countyNames[i];
      if (name.length < 2 || this.ambiguous[name] || s.indexOf(name) < 0) continue;
      list = this.countyByAlias[name] || [];
      if (provShort) list = list.filter(function (c) { return c.province === provShort; });
      if (!list.length) continue;
      unique = [list[0]];
      for (j = 1; j < list.length; j++) {
        if (list[j].province !== unique[0].province || list[j].city !== unique[0].city) unique.push(list[j]);
      }
      if (unique.length === 1) return { alias: name, rec: unique[0] };
      return { alias: name, rec: null, ambiguous: true };
    }
    return null;
  };

  function municipalityPair(prov) {
    var full = prov.full || (prov.short + "市");
    return { province: full, city: full, provinceShort: prov.short, cityShort: prov.short };
  }

  function cityPair(city) {
    var muni = MUNICIPALITIES[city.province];
    if (muni) return { province: city.provinceFull, city: city.provinceFull, provinceShort: city.province, cityShort: city.province };
    return { province: city.provinceFull, city: city.full, provinceShort: city.province, cityShort: city.short };
  }

  function parseOne(idx, raw) {
    var original = raw == null ? "" : String(raw);
    var s = stripPhone(original).replace(/[()（）\[\]【】]/g, " ");
    s = s.replace(/\s+/g, "");
    if (!s) return { ok: false, status: "empty", reason: "地址为空", province: "", city: "" };

    var provHit = idx.findProv(s);
    var cityHit = idx.findCity(s, provHit ? provHit.rec.short : "");
    if (cityHit && cityHit.ambiguous) {
      return { ok: false, status: "ambiguous", reason: "城市名称存在歧义，无法唯一确定所属省份", province: "", city: "" };
    }
    if (!cityHit && provHit && MUNICIPALITIES[provHit.rec.short]) {
      var pair = municipalityPair(provHit.rec);
      return { ok: true, status: "parsed", reason: "", province: pair.province, city: pair.city, via: "municipality" };
    }
    if (cityHit && cityHit.rec) {
      pair = cityPair(cityHit.rec);
      return { ok: true, status: "parsed", reason: "", province: pair.province, city: pair.city, via: "city" };
    }
    var countyHit = idx.findCounty(s, provHit ? provHit.rec.short : "");
    if (countyHit && countyHit.ambiguous) {
      return { ok: false, status: "ambiguous", reason: "区县名称存在歧义，未猜测", province: "", city: "" };
    }
    if (countyHit && countyHit.rec) {
      var cityRecs = (idx.cityByAlias[countyHit.rec.city] || []).filter(function (c) {
        return c.province === countyHit.rec.province || c.full === countyHit.rec.city;
      });
      var rec = cityRecs[0] || {
        province: countyHit.rec.province,
        provinceFull: (idx.provByAlias[countyHit.rec.province] || {}).full || countyHit.rec.province,
        short: countyHit.rec.city.replace(/市$/, ""),
        full: countyHit.rec.city
      };
      pair = cityPair(rec);
      return { ok: true, status: "parsed", reason: "", province: pair.province, city: pair.city, via: "county" };
    }
    if (provHit && !cityHit) {
      return { ok: false, status: "needConfirm", reason: "识别到省份但未能唯一确定城市", province: provHit.rec.full, city: "" };
    }
    return { ok: false, status: "needConfirm", reason: "未能从详细地址识别省市", province: "", city: "" };
  }

  function existingField(row, keys) {
    var i, v;
    for (i = 0; i < keys.length; i++) {
      v = row[keys[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }

  function mergeSide(parsed, existedProv, existedCity, sideLabel) {
    var out = {
      province: "",
      city: "",
      parseStatus: parsed.status,
      parseReason: parsed.reason || "",
      source: "",
      mismatch: false,
      existedProvince: existedProv || "",
      existedCity: existedCity || ""
    };
    var parsedOk = !!(parsed.ok && parsed.province && parsed.city);
    var existedOk = !!(existedProv && existedCity);
    if (parsedOk && existedOk) {
      var sameP = sameRegion(parsed.province, existedProv);
      var sameC = sameRegion(parsed.city, existedCity);
      if (sameP && sameC) {
        out.province = existedProv;
        out.city = existedCity;
        out.source = "crossChecked";
        out.parseStatus = "parsed";
        out.parseReason = "";
        return out;
      }
      out.mismatch = true;
      out.parseStatus = "mismatch";
      out.parseReason = sideLabel + "已有字段与详细地址解析不一致";
      out.province = existedProv;
      out.city = existedCity;
      out.parsedProvince = parsed.province;
      out.parsedCity = parsed.city;
      return out;
    }
    if (parsedOk) {
      out.province = parsed.province;
      out.city = parsed.city;
      out.source = "parsed";
      return out;
    }
    if (existedOk) {
      out.province = existedProv;
      out.city = existedCity;
      out.source = "existing";
      out.parseStatus = "existingOnly";
      out.parseReason = parsed.reason || "详细地址未解析，沿用已有省市字段";
      return out;
    }
    out.parseStatus = parsed.status || "needConfirm";
    out.parseReason = parsed.reason || "省市缺失";
    return out;
  }

  function isSameCity(origin, dest) {
    if (!origin || !dest) return false;
    if (!origin.province || !origin.city || !dest.province || !dest.city) return false;
    if (origin.parseStatus === "unknown" || dest.parseStatus === "unknown") return false;
    return sameRegion(origin.province, dest.province) && sameRegion(origin.city, dest.city);
  }

  var api = {
    load: function () {
      if (global.__pwChinaAdmin) {
        api.index = new Index(global.__pwChinaAdmin);
        return Promise.resolve(api.index);
      }
      return fetch("./geo/china_admin.json").then(function (r) {
        if (!r.ok) throw new Error("无法加载行政区划字典");
        return r.json();
      }).then(function (data) {
        global.__pwChinaAdmin = data;
        api.index = new Index(data);
        return api.index;
      });
    },
    parseAddress: function (raw) {
      if (!api.index) throw new Error("行政区划字典尚未加载");
      return parseOne(api.index, raw);
    },
    mergeSide: mergeSide,
    isSameCity: isSameCity,
    sameRegion: sameRegion,
    provinceOptions: function () {
      return (api.index && api.index.provinces) ? api.index.provinces.slice() : [];
    },
    cityOptions: function (provinceShortOrFull) {
      if (!api.index) return [];
      var key = normKey(provinceShortOrFull);
      return api.index.cities.filter(function (c) {
        return c.province === key || normKey(c.provinceFull) === key;
      });
    },
    ADDRESS_ALIASES: {
      sender: ["寄件地址", "发件地址", "发件详细地址", "寄件人地址", "寄件详细地址", "发货地址", "寄件人详细地址"],
      receiver: ["收件地址", "收货地址", "收件详细地址", "收件人地址", "收件人详细地址", "收货详细地址"],
      originProvince: ["发件省份", "始发省份", "始发省", "寄件省份", "发货省份"],
      originCity: ["发件城市", "始发城市", "始发市", "寄件城市", "发货城市"],
      destProvince: ["收件省份", "目的省份", "目的省", "收货省份"],
      destCity: ["收件城市", "目的城市", "目的市", "收货城市"]
    }
  };

  global.__pwAddress = api;
})(window);
