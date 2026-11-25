(() => {
  function weekTrack(group) {
    const { value, stale } = window.Q.read(group, "week");
    const rail = "M1.5 12 C1.5 4.4 1.5 1.45 5.7 1.4 Q40 .8 74.3 1.4 C78.5 1.45 78.5 4.4 78.5 12";
    const path = `pathLength="100" d="${rail}"`;
    const amount = value === null ? null : Math.max(0, Math.min(100, value));
    const fill = amount > 0 ? `<path class="tn-fill" ${path} stroke-dasharray="${amount} 101"/>` : "";
    const marker = amount === null ? "" :
      `<path class="tn-mark" ${path} stroke-dasharray=".25 110" stroke-dashoffset="-${Math.min(99.75, amount)}"/>`;
    return `<svg class="tn-track" aria-hidden="true" viewBox="0 0 80 46" preserveAspectRatio="none">
      <path class="tn-rail" ${path} ${amount === null ? 'stroke-dasharray="1.5 3"' : ""}/>
      <g opacity="${stale ? ".65" : "1"}">${fill}${marker}</g></svg>`;
  }

  function column(group, title) {
    const Q = window.Q;
    const isWeb = group === "web";
    const material = isWeb ? "" :
      `<span class="tn-cavity" aria-hidden="true">${Q.liquid(group, "five")}</span>${weekTrack(group)}`;
    return `<span class="tn-column ${isWeb ? "tn-plate" : "tn-port"}">
      ${material}<b class="tn-source">${title}</b>
      <span class="tn-week">${Q.value(group, "week")}</span>
      <span class="tn-five">${Q.value(group, "five")}</span>
    </span>`;
  }

  window.twinNarrow = () =>
    `<span class="tn-assembly">
      <span class="tn-periods"><span class="tn-week-label">一周</span><span class="tn-five-label">5 小时</span></span>
      ${column("gemini", "AG Gemini")}${column("partner", "AG Claude/GPT")}${column("web", "Web")}
    </span>`;
})();
