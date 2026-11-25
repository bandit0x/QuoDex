(() => {
  const groups = [
    { id: "gemini", origin: "AG", name: "Gemini" },
    { id: "partner", origin: "AG", name: "Claude/GPT" },
    { id: "web", origin: "", name: "Web" },
  ];

  function tube(group) {
    const Q = window.Q;
    const week = Q.read(group, "week");
    const cursor = week.value === null ? "" :
      `<i class="b-cursor${week.stale ? " is-old" : ""}" style="left:${week.value}%"></i>`;
    return `<span class="b-tube" aria-hidden="true">
      <span class="b-vial">${Q.liquid(group, "five", "horizontal")}</span>
      <i class="b-glint"></i><span class="b-scale-track"><i class="b-ticks"></i>${cursor}</span>
    </span>`;
  }

  function row({ id, origin, name }) {
    const Q = window.Q;
    return `<div class="b-row">
      <span class="b-group">${origin ? `<small>${origin}</small>` : ""}<b>${name}</b></span>
      ${tube(id)}
      <span class="b-reading b-five">${Q.value(id, "five")}</span>
      <span class="b-reading b-week">${Q.value(id, "week")}</span>
    </div>`;
  }

  function face(narrow) {
    return `<div class="b-manifold">
      <div class="b-legend">
        <span class="b-calibration" aria-hidden="true"><i>0</i><i>50</i><i>100</i></span>
        <b class="b-five-key"><i></i>${narrow ? "5h" : "5 小时"}</b>
        <b class="b-week-key"><i></i>${narrow ? "周" : "一周"}</b>
      </div>
      <div class="b-bank">${groups.map(row).join("")}</div>
    </div>`;
  }

  window.quotaConcepts = window.quotaConcepts || {};
  window.quotaConcepts.b = face;
})();
