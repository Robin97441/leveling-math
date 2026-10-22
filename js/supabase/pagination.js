(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LevelingMathPagination = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  async function fetchAllRows(buildQuery, options = {}) {
    if (typeof buildQuery !== "function") throw new TypeError("buildQuery must be a function");
    const pageSize = Math.max(1, Number(options.pageSize) || 1000);
    const label = options.label || "Supabase rows";
    let from = 0;
    let rows = [];
    let expectedCount = null;

    while (true) {
      const response = await buildQuery(from, from + pageSize - 1).range(from, from + pageSize - 1);
      if (response.error) throw response.error;
      const page = response.data || [];
      if (expectedCount == null && Number.isInteger(response.count)) expectedCount = response.count;
      rows = rows.concat(page);
      if (page.length < pageSize) break;
      from += pageSize;
    }

    if (expectedCount != null && rows.length !== expectedCount) {
      throw new Error(`${label}: lecture incomplète (${rows.length}/${expectedCount})`);
    }
    return rows;
  }

  return { fetchAllRows };
});
