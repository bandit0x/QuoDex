(() => {
  const source = document.getElementById('source');
  const scenario = document.getElementById('scenario');
  const dialog = document.getElementById('dialog');
  const dialogBody = document.getElementById('dialog-body');
  const values = {};
  let busy = false;
  let justUpdated = false;
  let timer = 0;
  let dialogView = '';
  const resetHints = {
    gemini: {five:'2 小时后', week:'3 天后'},
    partner: {five:'1 小时后', week:'面板未披露'},
    web: {five:'4 小时后', week:'2 天后'}
  };

  function restoreValues() {
    Q.reset();
    for (const group of Q.groups) values[group] = {five:Q.raw(group,'five'), week:Q.raw(group,'week')};
  }
  function applyExample() {
    Q.reset();
    for (const group of Q.groups) for (const period of Q.periods) Q.edit(group,period,values[group][period]);
    const group = source.value;
    switch (scenario.value) {
      case 'zero': Q.edit(group,'week',0); break;
      case 'missing': Q.setState(group,'missing'); break;
      case 'stale': Q.setState(group,'old'); break;
      case 'failure': Q.setState(group,'empty'); break;
    }
    for (const period of Q.periods) {
      const slider = document.getElementById(period);
      slider.value = Q.raw(group,period);
      const reading = Q.read(group,period);
      slider.disabled = reading.value === null;
      document.getElementById('out-' + period).textContent = reading.value === null ? '—' : reading.value + '%';
    }
  }
  function status() {
    if (busy) return {label:'正在读取…',tone:'normal'};
    switch (scenario.value) {
      case 'failure': return {label:'读取失败 · QGM-204',tone:'error'};
      case 'missing': return {label:'已读 5/6 · 一项未读',tone:'warning'};
      case 'stale': return {label:'含一项上次读数',tone:'warning'};
      default: return {label:justUpdated ? '6/6 已更新' : '6/6 已读取',tone:'normal'};
    }
  }
  function accessibleReadings() {
    return Q.groups.flatMap(group => ['week','five'].map(period => {
      const { value, stale } = Q.read(group,period);
      const amount = value === null ? '未读' : (stale ? '上次剩余 ' : '剩余 ') + value + '%';
      return Q.names[group] + (period === 'five' ? ' 5 小时' : '一周') + amount;
    })).join('，');
  }
  function frame(narrow) {
    if (narrow) return '<button class="surface narrow" type="button" data-action="restore" aria-label="恢复标准浮窗" aria-description="' + accessibleReadings() + '"><span class="face twin-narrow">' + twinNarrow() + '</span></button>';
    const feedback = status();
    const action = scenario.value === 'failure' ? '重试' : '刷新';
    return '<div class="surface standard"><div class="face a twin-standard">' + window.quotaConcepts.a(false) + '</div><div class="shell-footer">' +
      '<button data-action="details" aria-label="查看额度详情"><b>GEMINI</b> · 详情</button>' +
      '<span class="feedback" role="status" data-tone="' + feedback.tone + '">' + feedback.label + '</span>' +
      '<button data-action="refresh"' + (busy ? ' disabled' : '') + '>' + action + '</button></div></div>';
  }
  function details() {
    if (scenario.value === 'failure') return '<p>重新打开额度面板后点击「重试」。QGM-204</p><button data-action="refresh"' + (busy ? ' disabled' : '') + '>重试</button>';
    const rows = Q.groups.flatMap(group => Q.periods.map(period => {
      const item = Q.read(group,period);
      const hint = item.value === null || item.stale ? '—' : resetHints[group][period];
      return '<tr><th scope="row">' + Q.names[group] + '</th><td>' + (period === 'five' ? '5 小时' : '一周') + '</td><td>' + Q.value(group,period) + '</td><td>' + hint + '</td></tr>';
    })).join('');
    return '<table><thead><tr><th>来源</th><th>周期</th><th>剩余</th><th>重置提示</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function updateHost(host, narrow) {
    const lenses = [...host.querySelectorAll('canvas.q-liquid')];
    const activeAction = host.contains(document.activeElement) ? document.activeElement.dataset.action : null;
    host.innerHTML = frame(narrow);
    host.querySelectorAll('canvas.q-liquid').forEach((canvas,index) => {
      const old = lenses[index];
      if (old && old.dataset.source === canvas.dataset.source && old.dataset.period === canvas.dataset.period) canvas.replaceWith(old);
    });
    if (activeAction) host.querySelector('[data-action="' + activeAction + '"]:not(:disabled)')?.focus({preventScroll:true});
  }
  function render() {
    for (const host of document.querySelectorAll('[data-host]')) updateHost(host,host.dataset.host === 'narrow');
    if (dialog.open) {
      if (dialogView === 'standard') updateHost(dialogBody,false);
      else dialogBody.innerHTML = details();
    }
    Q.paint();
  }
  function openView(view) {
    dialogView = view;
    document.getElementById('dialog-title').textContent = view === 'standard' ? '标准浮窗 · 原尺寸' : '额度详情 · 示例';
    if (!dialog.open) dialog.showModal();
    render();
  }
  function selectExample() {
    clearTimeout(timer);
    busy = false;
    justUpdated = false;
    applyExample();
    render();
  }
  function refresh() {
    if (busy) return;
    busy = true;
    justUpdated = false;
    render();
    timer = window.setTimeout(() => {
      busy = false;
      justUpdated = true;
      if (scenario.value !== 'zero') scenario.value = 'ready';
      applyExample();
      render();
    }, 850);
  }
  document.addEventListener('click', event => {
    switch (event.target.closest('button')?.dataset.action) {
      case 'restore': openView('standard'); break;
      case 'refresh': refresh(); break;
      case 'details': openView('details'); break;
    }
  });
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialogView = ''; dialogBody.replaceChildren(); });
  source.addEventListener('change', selectExample);
  scenario.addEventListener('change', selectExample);
  for (const period of Q.periods) {
    const slider = document.getElementById(period);
    slider.addEventListener('input', () => {
      values[source.value][period] = slider.valueAsNumber;
      if (period === 'week' && scenario.value === 'zero') scenario.value = 'ready';
      selectExample();
    });
  }
  document.getElementById('reset').addEventListener('click', () => {
    restoreValues(); source.value = 'gemini'; scenario.value = 'ready'; selectExample();
  });
  window.addEventListener('resize', Q.paint);
  restoreValues();
  selectExample();
})();
