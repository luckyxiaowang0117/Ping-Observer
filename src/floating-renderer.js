const $ = id => document.getElementById(id);
let state;
const formatTime = value => value
  ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
  : '尚无更新';

function render(data) {
  if (!data) return;
  state = data;
  const current = data.current;
  $('location').textContent = current?.location || (data.source?.status === 'loading' ? '正在检测…' : '等待检测');
  $('shared').textContent = current?.sharedUsers || '—';
  $('updated').textContent = formatTime(current?.checkedAt);

  const score = current?.riskValue;
  const risk = $('risk');
  $('riskNumber').textContent = score === null || score === undefined ? '—' : String(Number(score));
  $('riskLabel').textContent = current?.riskLabel || (score === null || score === undefined ? '等待评分' : 'ping0.cc 参考值');
  risk.className = 'metric-value';
  if (score !== null && score !== undefined) {
    risk.classList.add(Number(score) <= 25 ? 'risk-low' : Number(score) <= 50 ? 'risk-mid' : 'risk-high');
  }

  const status = $('status');
  const source = data.source || {};
  status.className = 'status';
  if (source.status === 'verification') {
    status.textContent = '需要安全验证';
    status.classList.add('warning');
  } else if (source.status === 'error') {
    status.textContent = '连接失败';
    status.classList.add('error');
  } else if (source.status === 'unavailable') {
    status.textContent = '站点暂未提供完整数据';
    status.classList.add('warning');
  } else if (source.status === 'loading') {
    status.textContent = source.detail?.includes('页面') ? '正在读取查询页面' : '正在更新';
  } else if (source.status === 'ok') {
    status.textContent = '数据来自 ping0.cc';
  } else {
    status.textContent = '等待首次检测';
  }
}

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  $('refresh').textContent = '…';
  try { render(await window.pingApp.refreshNow()); }
  finally { $('refresh').disabled = false; $('refresh').textContent = '↻'; }
});
$('openMain').addEventListener('click', () => window.pingApp.showMainWindow());
$('hide').addEventListener('click', () => window.pingApp.setFloatingVisible(false));
window.pingApp.onState(render);
window.pingApp.getState().then(render);
