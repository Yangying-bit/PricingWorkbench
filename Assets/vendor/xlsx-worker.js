var SHEETJS_URL = "./xlsx.full.min.js";
var sheetJsLoadError = null;

try {
  importScripts(SHEETJS_URL);
} catch (loadErr) {
  sheetJsLoadError = String(loadErr && loadErr.message || loadErr);
}

self.onmessage = function (e) {
  try {
    if (sheetJsLoadError) {
      throw new Error("SheetJS worker importScripts failed: " + sheetJsLoadError);
    }
    if (typeof XLSX === "undefined" || typeof XLSX.read !== "function") {
      throw new Error("SheetJS not initialized from " + SHEETJS_URL);
    }

    var wb = XLSX.read(new Uint8Array(e.data.buf), { type: "array" });
    var sheets = wb.SheetNames.map(function (n) {
      return {
        name: n,
        data: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", blankrows: false })
      };
    });

    self.postMessage({ ok: true, sheets: sheets, version: XLSX.version || "", url: SHEETJS_URL });
  } catch (err) {
    self.postMessage({
      ok: false,
      stage: sheetJsLoadError ? "load" : "parse",
      url: SHEETJS_URL,
      error: String(err && err.message || err)
    });
  }
};
