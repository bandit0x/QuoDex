(() => {
  const names = { gemini: "AG Gemini", partner: "AG Claude/GPT" };
  const dialPoint = (fraction, inset = 0) => {
    const angle = Math.PI * (1 - fraction);
    return [
      67 + (61 - inset) * Math.cos(angle),
      51 - (46 - inset) * Math.sin(angle)
    ].map(n => n.toFixed(2)).join(",");
  };

  function scale(value, stale) {
    const ticks = Array.from({ length: 21 }, (_, i) =>
      `M${dialPoint(i / 20, -1.1)} L${dialPoint(i / 20, i % 5 ? 0.9 : 2.6)}`).join(" ");
    const arc = "M6,51 A61,46 0 0 1 128,51";
    let active = "";
    if (value !== null) {
      const fraction = Math.max(0, Math.min(1, value / 100));
      if (fraction > 0) active = `<path class="a-lit" pathLength="100" d="${arc}" stroke-dasharray="${fraction * 100} 100"/>`;
      active += `<path class="a-needle" d="M${dialPoint(fraction, -2)} L${dialPoint(fraction, 5.3)}"/>`;
    }
    return `<svg class="a-scale" aria-hidden="true" viewBox="0 0 134 86" preserveAspectRatio="none">
      <path class="a-rail" d="${arc}" ${value === null ? 'stroke-dasharray="1.4 2.4"' : ""}/>
      <g${stale ? ' opacity=".7"' : ""}>${active}</g><path class="a-ticks" d="${ticks}"/>
    </svg>`;
  }

  function meter(group, narrow) {
    const Q = window.Q;
    const week = Q.read(group, "week");
    return `<div class="a-dial a-${group}">
      <div class="a-cavity">${Q.liquid(group, "five")}</div>
      ${scale(week.value, week.stale)}
      <b class="a-name">${names[group]}</b>
      <span class="a-five"><span class="a-key">${narrow ? "5h" : "5 小时"}</span>${Q.value(group, "five")}</span>
      <span class="a-week"><span class="a-key">${narrow ? "周" : "一周"}</span>${Q.value(group, "week")}</span>
    </div>`;
  }

  function face(narrow) {
    const Q = window.Q;
    return `<div class="a-frame">
      <div class="a-pair">${meter("gemini", narrow)}${meter("partner", narrow)}</div>
      <div class="a-plate">
        <b>Gemini Web</b>
        <span><span class="a-key">5 小时</span>${Q.value("web", "five")}</span>
        <span><span class="a-key">一周</span>${Q.value("web", "week")}</span>
      </div>
    </div>`;
  }

  window.quotaConcepts = window.quotaConcepts || {};
  window.quotaConcepts.a = face;
})();
