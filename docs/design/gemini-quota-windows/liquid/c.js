(() => {
  const groups = [
    { id: 'gemini', name: 'AG Gemini', short: 'Gemini' },
    { id: 'partner', name: 'AG Claude/GPT', short: 'Claude/GPT' },
    { id: 'web', name: 'Gemini Web', short: 'Web' }
  ];
  const periods = [ { id: 'five', name: '5 小时' }, { id: 'week', name: '一周' } ];

  window.quotaConcepts.c = function renderFocus(narrow) {
    const { read, value, liquid } = window.Q;
    const readings = groups.flatMap(group => periods.map(period => (
      { group, period, ...read(group.id, period.id) }
    )));
    const fresh = readings.filter(item => Number.isFinite(item.value) && !item.stale);
    const lowest = fresh.reduce((min, item) => !min || item.value < min.value ? item : min, null);
    const scope = !lowest ? '无新读数' : fresh.length < readings.length ? '已读中最低' : '最低剩余';

    function cell(group, period) {
      const selected = lowest?.group === group && lowest.period === period;
      return `<td${selected ? ' class="c-marked"' : ''}>${value(group.id, period.id)}</td>`;
    }

    const rows = narrow
      ? `<thead><tr><td></td>${groups.map(group => `<th scope="col" title="${group.name}"${lowest?.group === group ? ' class="c-axis"' : ''}>${group.short}</th>`).join('')}</tr></thead>
         <tbody>${periods.map(period => `<tr><th scope="row"${lowest?.period === period ? ' class="c-axis"' : ''}>${period.name}</th>${groups.map(group => cell(group, period)).join('')}</tr>`).join('')}</tbody>`
      : `<thead><tr><td></td>${periods.map(period => `<th scope="col">${period.name}</th>`).join('')}</tr></thead>
         <tbody>${groups.map(group => `<tr><th scope="row">${group.name}</th>${periods.map(period => cell(group, period)).join('')}</tr>`).join('')}</tbody>`;

    const label = lowest ? `${lowest.group.name} · ${lowest.period.name}` : '';
    const shortLabel = lowest ? `${lowest.group.short}·${lowest.period.id === 'week' ? '周' : '5h'}` : '';
    return `<div class="c-lens" aria-label="${scope}${lowest ? '，' + label + '，' + lowest.value + '%' : ''}">
      ${lowest ? liquid(lowest.group.id, lowest.period.id) : ''}
      <div class="c-inscription"><span class="c-scope">${scope}</span>
        <span class="c-amount">${lowest ? value(lowest.group.id, lowest.period.id) : '—'}</span>
        ${lowest && (narrow ? `<span class="c-short">${shortLabel}</span>` : `<span class="c-source">${lowest.group.name}</span><span class="c-period">${lowest.period.name}</span>`) || ''}
      </div></div>
      <table class="c-register" aria-label="各组剩余额度"><colgroup>${(narrow ? [0, 1, 2, 3] : [0, 1, 2]).map(() => '<col>').join('')}</colgroup>${rows}</table>`;
  };
})();
