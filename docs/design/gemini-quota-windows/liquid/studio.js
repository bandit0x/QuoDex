(() => {
  const designs = [
    {id:'a', name:'双舷窗', caption:'液面读 5 小时，金色弧针读一周。', note:'两组 Antigravity 各用一只仓，Web 的两个数刻在共同底座。'},
    {id:'b', name:'三支量管', caption:'液柱末端读 5 小时，金色游标读一周。', note:'每组各占一行。液柱从左到右增长，周游标独立滑动。'},
    {id:'c', name:'单仓聚焦', caption:'主仓显示当前已读额度中剩余最少的一项。', note:'仓上标出来源和周期，旁边的玻璃刻字同时列出全部六项。'}
  ];
  const gallery = document.getElementById('gallery');
  const dialog = document.getElementById('detail');
  const dialogBody = document.getElementById('detail-body');
  const source = document.getElementById('source');
  const state = document.getElementById('state');
  const busy = new Set();
  let openDesign = null;

  function shell(design, narrow) {
    const face = '<div class="face ' + design.id + '">' + window.quotaConcepts[design.id](narrow) + '</div>';
    if (narrow) {
      const description = Q.groups.flatMap(group => Q.periods.map(period => {
        const {value, stale} = Q.read(group, period);
        const amount = value === null ? '未读' : (stale ? '上次剩余 ' : '剩余 ') + value + '%';
        return Q.names[group] + (period === 'five' ? ' 5 小时' : '一周') + amount;
      })).join('，');
      return '<button type="button" class="surface narrow" data-restore="' + design.id + '" aria-label="恢复' + design.name + '标准浮窗" aria-description="' + description + '">' + face + '</button>';
    }
    const changing = busy.has(design.id);
    const refresh = '<button data-refresh="' + design.id + '"' + (changing ? ' disabled' : '') + '>' + (changing ? '正在读取…' : '刷新') + '</button>';
    return '<div class="surface standard">' + face + '<div class="shell-footer"><button data-details="' + design.id + '"><b>GEMINI</b> · 详情</button>' + refresh + '</div></div>';
  }

  function card(design) {
    return '<article id="design-' + design.id + '"><div class="card-heading"><i>' + design.id.toUpperCase() + '</i><h2>' + design.name + '</h2></div>' +
      '<p class="caption">' + design.caption + '</p><div class="mount"><div class="mount-label">标准浮窗 <small>300 × 130</small></div>' + shell(design, false) +
      '<div class="mount-label narrow-label">窄条 <small>260 × 48</small></div>' + shell(design, true) + '</div><p class="note">' + design.note + '</p></article>';
  }

  function render() {
    const lenses = [...document.querySelectorAll('.face')].map(face => [...face.querySelectorAll('canvas')]);
    gallery.innerHTML = designs.map(card).join('');
    if (dialog.open && openDesign) dialogBody.innerHTML = shell(openDesign, false);
    // Keep a filled vessel intact when only its external pointer or inscription changes.
    document.querySelectorAll('.face').forEach((face, index) => {
      face.querySelectorAll('canvas').forEach((canvas, slot) => {
        const old = lenses[index]?.[slot];
        if (old && old.dataset.source === canvas.dataset.source && old.dataset.period === canvas.dataset.period) {
          canvas.replaceWith(old);
        }
      });
    });
    Q.paint();
  }
  function syncBench() {
    for (const p of Q.periods) {
      const raw = Q.raw(source.value, p);
      document.getElementById(p).value = raw;
      document.getElementById(p + '-label').textContent = raw + '%';
    }
    state.value = Q.state(source.value);
  }
  function open(title, html) {
    document.getElementById('detail-title').textContent = title;
    dialogBody.innerHTML = html;
    if (!dialog.open) dialog.showModal();
    Q.paint();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.restore) {
      openDesign = designs.find(d => d.id === button.dataset.restore);
      open(openDesign.name + ' · 标准浮窗', shell(openDesign, false));
    } else if (button.dataset.details) {
      openDesign = null;
      const rows = Q.groups.map(group => '<tr><th scope="row">' + Q.names[group] + '</th><td>' + Q.value(group,'five') + '</td><td>' + Q.value(group,'week') + '</td></tr>').join('');
      open('额度详情 · 示例数据', '<table><thead><tr><th>来源</th><th>5 小时</th><th>一周</th></tr></thead><tbody>' + rows + '</tbody></table>');
    } else if (button.dataset.refresh) {
      const id = button.dataset.refresh;
      busy.add(id);
      render();
      window.setTimeout(() => { busy.delete(id); render(); }, 450);
    }
  });
  document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { openDesign = null; dialogBody.replaceChildren(); });
  source.addEventListener('change', syncBench);
  for (const period of Q.periods) {
    document.getElementById(period).addEventListener('input', event => {
      Q.edit(source.value, period, event.target.valueAsNumber);
      syncBench(); render();
    });
  }
  state.addEventListener('change', () => { Q.setState(source.value, state.value); render(); });
  document.getElementById('reset').addEventListener('click', () => { Q.reset(); source.value = 'gemini'; syncBench(); render(); });
  window.addEventListener('resize', Q.paint);
  syncBench();
  render();
})();
