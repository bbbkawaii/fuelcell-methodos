'use strict';

const DEFAULT_CONFIG = Object.freeze({
  targetCurrent: 100,
  currentTolerance: 1,
  minPlatformSec: 60,
  minStableSec: 60,
  sampleWindowSec: 120,
  targetH2Pressure: 200,
  h2Tolerance: 1,
  targetAirPressure: 180,
  airTolerance: 1.2,
  targetCoolantTemp: 65,
  coolantTolerance: 0.8,
  cellDeviationLimit: 15,
});

const state = {
  config: { ...DEFAULT_CONFIG },
  methodRevision: 1,
  rows: [],
  schema: null,
  source: null,
  analysis: null,
  reviews: {},
};

const els = {
  loadDemoButton: document.querySelector('#loadDemoButton'),
  downloadMockButton: document.querySelector('#downloadMockButton'),
  csvFile: document.querySelector('#csvFile'),
  rerunButton: document.querySelector('#rerunButton'),
  editMethodButton: document.querySelector('#editMethodButton'),
  closeDialogButton: document.querySelector('#closeDialogButton'),
  cancelMethodButton: document.querySelector('#cancelMethodButton'),
  methodDialog: document.querySelector('#methodDialog'),
  methodForm: document.querySelector('#methodForm'),
  parameterList: document.querySelector('#parameterList'),
  methodVersion: document.querySelector('#methodVersion'),
  sourceName: document.querySelector('#sourceName'),
  sourceMeta: document.querySelector('#sourceMeta'),
  runBadge: document.querySelector('#runBadge'),
  runChart: document.querySelector('#runChart'),
  emptyChart: document.querySelector('#emptyChart'),
  chartMeta: document.querySelector('#chartMeta'),
  analysisStatus: document.querySelector('#analysisStatus'),
  analysisStatusHint: document.querySelector('#analysisStatusHint'),
  windowValue: document.querySelector('#windowValue'),
  windowHint: document.querySelector('#windowHint'),
  findingCount: document.querySelector('#findingCount'),
  findingHint: document.querySelector('#findingHint'),
  qualityValue: document.querySelector('#qualityValue'),
  qualityHint: document.querySelector('#qualityHint'),
  findingList: document.querySelector('#findingList'),
  evidenceToken: document.querySelector('#evidenceToken'),
  evidenceList: document.querySelector('#evidenceList'),
  reportConclusion: document.querySelector('#reportConclusion'),
  reportWindow: document.querySelector('#reportWindow'),
  reviewSummary: document.querySelector('#reviewSummary'),
  exportButton: document.querySelector('#exportButton'),
  copyConclusionButton: document.querySelector('#copyConclusionButton'),
  toast: document.querySelector('#toast'),
};

let toastTimer;

initialize();

function initialize() {
  renderMethod();
  populateMethodForm();

  els.loadDemoButton.addEventListener('click', loadDemoData);
  els.downloadMockButton.addEventListener('click', downloadMockCsv);
  els.csvFile.addEventListener('change', handleCsvImport);
  els.rerunButton.addEventListener('click', () => {
    runAndRender();
    showToast('已按当前 Method 重新完成分析。');
  });
  els.editMethodButton.addEventListener('click', () => {
    populateMethodForm();
    els.methodDialog.showModal();
  });
  els.closeDialogButton.addEventListener('click', () => els.methodDialog.close());
  els.cancelMethodButton.addEventListener('click', () => els.methodDialog.close());
  els.methodForm.addEventListener('submit', saveMethod);
  els.findingList.addEventListener('click', handleFindingReview);
  els.exportButton.addEventListener('click', exportReport);
  els.copyConclusionButton.addEventListener('click', copyConclusion);
  window.addEventListener('resize', () => window.requestAnimationFrame(drawRunChart));
}

function loadDemoData() {
  const demo = createDemoDataset();
  state.rows = demo.rows;
  state.schema = demo.schema;
  state.source = {
    name: 'FC-STACK-2026-0818-MOCK.csv',
    isDemo: true,
    rowCount: demo.rows.length,
  };
  state.reviews = {};
  runAndRender();
  showToast('Mock 数据已载入：规则、证据和报告均可在页面中继续操作。');
}

function downloadMockCsv() {
  const demo = createDemoDataset();
  const headers = [
    'timestamp',
    'current',
    'h2_pressure',
    'air_pressure',
    'coolant_temp',
    'stack_voltage',
    ...demo.schema.cells.map((cell) => cell.header),
  ];
  const rows = demo.rows.map((row) => [
    row.t,
    row.current,
    row.h2Pressure,
    row.airPressure,
    row.coolantTemp,
    row.stackVoltage,
    ...demo.schema.cells.map((cell) => row.cells[cell.key]),
  ]);
  const csv = [headers, ...rows]
    .map((values) => values.map(csvValue).join(','))
    .join('\r\n');

  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    'FC-STACK-2026-0818-MOCK.csv',
  );
  showToast('Mock CSV 已下载，可直接通过“导入 CSV”重新验证完整流程。');
}

async function handleCsvImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    if (file.size > 80 * 1024 * 1024) {
      throw new Error('为保证浏览器演示流畅，请先导入小于 80 MB 的 CSV 文件。');
    }

    const content = await file.text();
    const parsed = parseCsv(content);
    const normalized = normalizeImportedData(parsed.headers, parsed.records);

    state.rows = normalized.rows;
    state.schema = normalized.schema;
    state.source = {
      name: file.name,
      isDemo: false,
      rowCount: normalized.rows.length,
    };
    state.reviews = {};
    runAndRender();
    showToast(`已在本地解析 ${normalized.rows.length.toLocaleString('zh-CN')} 条记录。`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'CSV 读取失败，请检查文件格式。', 'error');
  } finally {
    event.target.value = '';
  }
}

function saveMethod(event) {
  event.preventDefault();

  const nextConfig = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const input = els.methodForm.elements.namedItem(key);
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('请为所有 Method 参数填写大于 0 的数值。', 'error');
      return;
    }
    nextConfig[key] = value;
  }

  if (nextConfig.sampleWindowSec < nextConfig.minStableSec) {
    showToast('正式统计窗口不能短于最短稳定时长。', 'error');
    return;
  }

  state.config = nextConfig;
  state.methodRevision += 1;
  state.reviews = {};
  els.methodDialog.close();

  if (state.rows.length) {
    runAndRender();
    showToast('Method 已保存并重新运行；之前的人工审核标记已清空。');
  } else {
    renderMethod();
    showToast('Method 已保存。载入数据后将按新参数运行。');
  }
}

function populateMethodForm() {
  for (const [key, value] of Object.entries(state.config)) {
    const input = els.methodForm.elements.namedItem(key);
    if (input) input.value = value;
  }
}

function runAndRender() {
  if (!state.rows.length || !state.schema || !state.source) return;
  state.analysis = analyzeRun(state.rows, state.config, state.schema);
  renderAnalysis();
}

function analyzeRun(rows, config, schema) {
  const cadence = estimateCadence(rows);
  const startTime = rows[0].t;
  const endTime = rows[rows.length - 1].t;
  const platformRuns = findRuns(
    rows,
    (row) => isWithin(row.current, config.targetCurrent, config.currentTolerance),
    cadence,
  );
  const qualifiedPlatformRuns = platformRuns.filter((run) => run.duration >= config.minPlatformSec);
  const stableRuns = findRuns(rows, (row) => isStable(row, config), cadence);
  const qualifiedStableRuns = stableRuns.filter((run) => run.duration >= config.minStableSec);
  const bestPlatform = longestRun(qualifiedPlatformRuns);
  const bestStable = longestRun(qualifiedStableRuns);

  let status = 'failed';
  let sampleRows = [];
  if (bestStable) {
    if (bestStable.duration >= config.sampleWindowSec) {
      status = 'formal';
      sampleRows = getTrailingWindow(bestStable.rows, config.sampleWindowSec, cadence);
    } else {
      status = 'warning';
      sampleRows = bestStable.rows;
    }
  }

  const quality = assessDataQuality(rows);
  const cellStats = calculateCellStats(sampleRows, schema.cells);
  const stats = calculateWindowStats(sampleRows);
  const platformRows = bestPlatform ? bestPlatform.rows : [];
  const h2Excursions = findRuns(
    platformRows,
    (row) => !isWithin(row.h2Pressure, config.targetH2Pressure, config.h2Tolerance),
    cadence,
  ).filter((run) => run.duration >= cadence * 1.5);

  const analysis = {
    rows,
    schema,
    config,
    cadence,
    startTime,
    endTime,
    duration: Math.max(cadence, endTime - startTime + cadence),
    platformRuns,
    qualifiedPlatformRuns,
    bestPlatform,
    stableRuns,
    qualifiedStableRuns,
    bestStable,
    sampleRows,
    sampleDuration: sampleRows.length ? runDuration(sampleRows, cadence) : 0,
    status,
    quality,
    cellStats,
    stats,
    h2Excursions,
  };

  analysis.findings = buildFindings(analysis);
  analysis.evidenceToken = buildEvidenceToken(analysis);
  return analysis;
}

function isStable(row, config) {
  return (
    isWithin(row.current, config.targetCurrent, config.currentTolerance) &&
    isWithin(row.h2Pressure, config.targetH2Pressure, config.h2Tolerance) &&
    isWithin(row.airPressure, config.targetAirPressure, config.airTolerance) &&
    isWithin(row.coolantTemp, config.targetCoolantTemp, config.coolantTolerance)
  );
}

function isWithin(value, target, tolerance) {
  return Number.isFinite(value) && Math.abs(value - target) <= tolerance;
}

function findRuns(rows, predicate, cadence) {
  const runs = [];
  let bucket = [];

  const flush = () => {
    if (!bucket.length) return;
    runs.push({
      rows: bucket,
      start: bucket[0],
      end: bucket[bucket.length - 1],
      duration: runDuration(bucket, cadence),
    });
    bucket = [];
  };

  for (const row of rows) {
    const contiguous = !bucket.length || row.t - bucket[bucket.length - 1].t <= cadence * 1.8;
    if (!predicate(row) || !contiguous) {
      flush();
    }
    if (predicate(row)) bucket.push(row);
  }
  flush();
  return runs;
}

function longestRun(runs) {
  return runs.reduce((longest, run) => (!longest || run.duration > longest.duration ? run : longest), null);
}

function runDuration(rows, cadence) {
  if (!rows.length) return 0;
  return Math.max(cadence, rows[rows.length - 1].t - rows[0].t + cadence);
}

function getTrailingWindow(rows, requestedSeconds, cadence) {
  if (!rows.length) return [];
  const end = rows[rows.length - 1].t;
  const start = end - requestedSeconds + cadence * 0.5;
  const selection = rows.filter((row) => row.t >= start);
  return selection.length ? selection : rows.slice(-1);
}

function estimateCadence(rows) {
  if (rows.length < 2) return 1;
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    const gap = rows[index].t - rows[index - 1].t;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 1;
  return Math.max(0.001, median(gaps));
}

function assessDataQuality(rows) {
  const required = ['current', 'h2Pressure', 'airPressure', 'coolantTemp'];
  let missing = 0;
  let duplicates = 0;

  rows.forEach((row, index) => {
    required.forEach((field) => {
      if (!Number.isFinite(row[field])) missing += 1;
    });
    if (index > 0 && row.t <= rows[index - 1].t) duplicates += 1;
  });

  const expected = rows.length * required.length;
  return {
    missing,
    duplicates,
    completeness: expected ? ((expected - missing) / expected) * 100 : 0,
  };
}

function calculateWindowStats(rows) {
  if (!rows.length) return null;
  return {
    current: average(rows.map((row) => row.current)),
    h2Pressure: average(rows.map((row) => row.h2Pressure)),
    airPressure: average(rows.map((row) => row.airPressure)),
    coolantTemp: average(rows.map((row) => row.coolantTemp)),
    stackVoltage: average(rows.map((row) => row.stackVoltage)),
  };
}

function calculateCellStats(rows, cells) {
  if (!rows.length || !cells.length) return null;

  const stats = cells
    .map((cell) => {
      const values = rows.map((row) => row.cells[cell.key]).filter(Number.isFinite);
      if (!values.length) return null;
      return {
        ...cell,
        average: average(values),
        minimum: Math.min(...values),
        maximum: Math.max(...values),
      };
    })
    .filter(Boolean);

  if (!stats.length) return null;
  const groupMedian = median(stats.map((item) => item.average));
  const lowest = stats.reduce((result, item) => (item.average < result.average ? item : result));
  const highest = stats.reduce((result, item) => (item.average > result.average ? item : result));

  return {
    values: stats,
    groupMedian,
    lowest: { ...lowest, deviationMv: (lowest.average - groupMedian) * 1000 },
    highest: { ...highest, deviationMv: (highest.average - groupMedian) * 1000 },
  };
}

function buildFindings(analysis) {
  const findings = [];
  const { cellStats, config, bestStable, status, h2Excursions, quality } = analysis;

  if (cellStats && cellStats.lowest.deviationMv <= -config.cellDeviationLimit) {
    const lowest = cellStats.lowest;
    findings.push({
      id: 'F-01',
      severity: 'high',
      severityLabel: '需复核',
      actionable: true,
      title: `${lowest.label} 电压相对群体偏低`,
      description: `正式统计窗口内，该单体平均值比同组中位数低 ${formatFixed(Math.abs(lowest.deviationMv), 1)} mV。建议核对该单体接触、电压采样与一致性状态。`,
      evidence: [
        { label: '计算窗口', value: formatRunRange(bestStable, analysis) },
        { label: '平均偏差', value: `-${formatFixed(Math.abs(lowest.deviationMv), 1)} mV` },
        { label: '最低电压', value: `${formatFixed(lowest.minimum, 3)} V` },
        { label: '字段', value: lowest.label },
      ],
    });
  }

  if (h2Excursions.length) {
    const longest = longestRun(h2Excursions);
    const maximumDeviation = Math.max(
      ...h2Excursions.flatMap((run) =>
        run.rows.map((row) => Math.abs(row.h2Pressure - config.targetH2Pressure)),
      ),
    );
    findings.push({
      id: `F-${String(findings.length + 1).padStart(2, '0')}`,
      severity: 'medium',
      severityLabel: '观察项',
      actionable: true,
      title: `平台内出现 ${h2Excursions.length} 段氢气压力越界`,
      description: `最长持续 ${formatDuration(longest.duration)}，最大偏离目标 ${formatFixed(maximumDeviation, 1)} kPa。正式统计窗口已避开越界段，仍建议核对供氢调压过程。`,
      evidence: [
        { label: '最长区间', value: formatRunRange(longest, analysis) },
        { label: '最长时长', value: formatDuration(longest.duration) },
        { label: '最大偏离', value: `${formatFixed(maximumDeviation, 1)} kPa` },
        { label: '字段', value: analysis.schema.mapping.h2Pressure || 'h2Pressure' },
      ],
    });
  }

  if (status === 'failed') {
    findings.push({
      id: `F-${String(findings.length + 1).padStart(2, '0')}`,
      severity: 'high',
      severityLabel: '无法统计',
      actionable: true,
      title: '未找到满足最短时长的稳定区间',
      description: `当前 Method 要求连续稳定不少于 ${formatDuration(config.minStableSec)}。请检查测试工况、字段映射或放宽经过审批的阈值。`,
      evidence: [
        { label: '稳定规则', value: '电流 + 压力 + 温度' },
        { label: '最短时长', value: formatDuration(config.minStableSec) },
        { label: '候选区间', value: `${analysis.stableRuns.length} 段` },
        { label: '数据完整度', value: `${formatFixed(quality.completeness, 1)}%` },
      ],
    });
  } else if (status === 'warning') {
    findings.push({
      id: `F-${String(findings.length + 1).padStart(2, '0')}`,
      severity: 'medium',
      severityLabel: '预警',
      actionable: true,
      title: '稳定区间满足判定，但短于正式统计窗口',
      description: `最长稳定区间为 ${formatDuration(bestStable.duration)}，低于 ${formatDuration(config.sampleWindowSec)} 的正式统计窗口要求。本次仅输出预警性统计。`,
      evidence: [
        { label: '稳定区间', value: formatRunRange(bestStable, analysis) },
        { label: '实际时长', value: formatDuration(bestStable.duration) },
        { label: '目标窗口', value: formatDuration(config.sampleWindowSec) },
        { label: '处理方式', value: '预警性统计' },
      ],
    });
  }

  if (quality.completeness < 99.5 || quality.duplicates > 0) {
    findings.push({
      id: `F-${String(findings.length + 1).padStart(2, '0')}`,
      severity: 'medium',
      severityLabel: '数据质量',
      actionable: true,
      title: '必需信号存在缺失或重复时间戳',
      description: `完整度为 ${formatFixed(quality.completeness, 2)}%，检测到 ${quality.missing} 个必需字段缺失值与 ${quality.duplicates} 个重复/倒序时间戳。`,
      evidence: [
        { label: '完整度', value: `${formatFixed(quality.completeness, 2)}%` },
        { label: '缺失值', value: `${quality.missing} 个` },
        { label: '时间戳异常', value: `${quality.duplicates} 个` },
        { label: '字段范围', value: '电流 / 压力 / 温度' },
      ],
    });
  }

  if (!findings.length && status === 'formal') {
    findings.push({
      id: 'F-01',
      severity: 'passed',
      severityLabel: '通过',
      actionable: false,
      title: '正式统计窗口已生成，未发现规则性异常',
      description: '稳定性、数据完整度与已映射单体一致性均通过当前 Method 的阈值检查。工程师仍可在导出报告中补充签核。',
      evidence: [
        { label: '统计窗口', value: formatRunRange(bestStable, analysis) },
        { label: '窗口时长', value: formatDuration(analysis.sampleDuration) },
        { label: '完整度', value: `${formatFixed(quality.completeness, 1)}%` },
        { label: 'Method', value: 'M-PLT-001' },
      ],
    });
  }

  return findings;
}

function renderAnalysis() {
  const analysis = state.analysis;
  if (!analysis || !state.source) return;

  renderMethod();
  renderSource(analysis);
  renderMetrics(analysis);
  renderFindings(analysis);
  renderEvidence(analysis);
  renderReport(analysis);
  els.emptyChart.hidden = true;
  window.requestAnimationFrame(drawRunChart);
}

function renderMethod() {
  const config = state.config;
  const parameters = [
    ['目标电流', `${formatFixed(config.targetCurrent, 1)} A`],
    ['电流容差', `±${formatFixed(config.currentTolerance, 1)} A`],
    ['最短稳定时长', formatDuration(config.minStableSec)],
    ['正式统计窗口', formatDuration(config.sampleWindowSec)],
    ['氢气压力容差', `±${formatFixed(config.h2Tolerance, 1)} kPa`],
    ['冷却液温度容差', `±${formatFixed(config.coolantTolerance, 1)} °C`],
  ];

  els.methodVersion.textContent = `v0.${state.methodRevision} · ${state.methodRevision === 1 ? '演示方法' : '本地修改'}`;
  els.parameterList.innerHTML = parameters
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');
}

function renderSource(analysis) {
  els.sourceName.textContent = state.source.name;
  const endLabel = formatElapsed(analysis.endTime - analysis.startTime);
  const origin = state.source.isDemo ? '合成 Mock 数据' : '浏览器本地处理';
  els.sourceMeta.textContent = `${state.source.rowCount.toLocaleString('zh-CN')} points · 00:00–${endLabel} · ${origin}`;
  els.rerunButton.disabled = false;

  const badgeMap = {
    formal: ['正式统计', 'is-ready'],
    warning: ['预警统计', 'is-warning'],
    failed: ['未通过稳定性门槛', 'is-warning'],
  };
  const [label, className] = badgeMap[analysis.status];
  els.runBadge.textContent = label;
  els.runBadge.className = `run-badge ${className}`;

  const platformText = analysis.bestPlatform
    ? `最长平台 ${formatRunRange(analysis.bestPlatform, analysis)} · ${formatDuration(analysis.bestPlatform.duration)}`
    : '未找到合格平台区间';
  const stableText = analysis.bestStable
    ? `最长稳定 ${formatRunRange(analysis.bestStable, analysis)} · ${formatDuration(analysis.bestStable.duration)}`
    : '未找到合格稳定区间';
  els.chartMeta.innerHTML = `<span>${escapeHtml(platformText)}</span><span>${escapeHtml(stableText)}</span>`;
}

function renderMetrics(analysis) {
  const actionables = analysis.findings.filter((finding) => finding.actionable);
  const statusMap = {
    formal: ['正式统计', '满足 120 s 正式窗口'],
    warning: ['预警统计', '稳定但不足正式窗口'],
    failed: ['需要排查', '未通过稳定性门槛'],
  };
  const [statusLabel, statusHint] = statusMap[analysis.status];

  els.analysisStatus.textContent = statusLabel;
  els.analysisStatusHint.textContent = `${statusHint} · M-PLT-001`;
  els.windowValue.textContent = analysis.sampleRows.length ? formatDuration(analysis.sampleDuration) : '—';
  els.windowHint.textContent = analysis.bestStable
    ? `${formatRunRange(analysis.bestStable, analysis)}${analysis.status === 'formal' ? ' 的尾部窗口' : ''}`
    : '需要满足稳定性条件';
  els.findingCount.textContent = `${actionables.length} 条`;
  els.findingHint.textContent = actionables.length ? '需要工程师确认' : '当前规则未发现异常';
  els.qualityValue.textContent = `${formatFixed(analysis.quality.completeness, 1)}%`;
  els.qualityHint.textContent = analysis.quality.duplicates
    ? `${analysis.quality.duplicates} 个时间戳异常`
    : `${analysis.quality.missing} 个必需字段缺失`;
}

function renderFindings(analysis) {
  els.findingList.innerHTML = analysis.findings
    .map((finding) => {
      const reviewed = Boolean(state.reviews[finding.id]);
      const evidence = finding.evidence
        .map(
          (item) => `
            <div>
              <span>${escapeHtml(item.label)}</span>
              <strong title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</strong>
            </div>`,
        )
        .join('');
      const action = finding.actionable
        ? `<button class="review-button ${reviewed ? 'is-reviewed' : ''}" type="button" data-review-finding="${escapeHtml(finding.id)}" aria-pressed="${reviewed}">${reviewed ? '已复核 · 点击撤销' : '标记为已复核'}</button>`
        : '<span class="review-pill">规则检查通过</span>';

      return `
        <article class="finding-card ${escapeHtml(finding.severity)}">
          <div class="finding-meta">
            <span class="finding-id">${escapeHtml(finding.id)}</span>
            <span class="severity-pill ${escapeHtml(finding.severity)}">${escapeHtml(finding.severityLabel)}</span>
          </div>
          <h3>${escapeHtml(finding.title)}</h3>
          <p>${escapeHtml(finding.description)}</p>
          <div class="finding-evidence">${evidence}</div>
          ${action}
        </article>`;
    })
    .join('');
}

function renderEvidence(analysis) {
  const mapping = analysis.schema.mapping;
  const sourceType = state.source.isDemo ? '合成 Mock 数据' : '用户导入 CSV';
  const windowInfo = analysis.sampleRows.length
    ? `${formatRunRange(analysis.bestStable, analysis)} · ${formatDuration(analysis.sampleDuration)}`
    : '未生成可用统计窗口';
  const entries = [
    {
      label: '数据源',
      value: state.source.name,
      note: `${sourceType} · ${analysis.rows.length.toLocaleString('zh-CN')} 条时序记录`,
    },
    {
      label: '字段映射',
      value: `I: ${mapping.current || '—'} → P: ${mapping.h2Pressure || '—'}`,
      note: `空气：${mapping.airPressure || '—'}；冷却液：${mapping.coolantTemp || '—'}`,
    },
    {
      label: '执行 Method',
      value: `M-PLT-001 v0.${state.methodRevision}`,
      note: `目标 ${formatFixed(state.config.targetCurrent, 1)} A；稳定 ≥ ${formatDuration(state.config.minStableSec)}`,
    },
    {
      label: '统计窗口',
      value: windowInfo,
      note: `${analysis.status === 'formal' ? '正式统计' : analysis.status === 'warning' ? '预警性统计' : '无正式统计'}`,
    },
  ];

  els.evidenceToken.textContent = analysis.evidenceToken;
  els.evidenceList.innerHTML = entries
    .map(
      (entry) => `
        <div class="evidence-item">
          <span>${escapeHtml(entry.label)}</span>
          <strong title="${escapeHtml(entry.value)}">${escapeHtml(entry.value)}</strong>
          <small>${escapeHtml(entry.note)}</small>
        </div>`,
    )
    .join('');
}

function renderReport(analysis) {
  const actionables = analysis.findings.filter((finding) => finding.actionable);
  const reviewed = actionables.filter((finding) => state.reviews[finding.id]).length;
  els.reportConclusion.textContent = buildConclusion(analysis);
  els.reportWindow.textContent = analysis.sampleRows.length
    ? `${formatRunRange(analysis.bestStable, analysis)} · ${formatDuration(analysis.sampleDuration)}`
    : '—';
  els.reviewSummary.textContent = actionables.length ? `${reviewed}/${actionables.length} 已复核` : '无需复核';
  els.exportButton.disabled = false;
  els.copyConclusionButton.disabled = false;
}

function handleFindingReview(event) {
  const button = event.target.closest('[data-review-finding]');
  if (!button || !state.analysis) return;
  const id = button.dataset.reviewFinding;
  state.reviews[id] = !state.reviews[id];
  if (!state.reviews[id]) delete state.reviews[id];
  renderFindings(state.analysis);
  renderReport(state.analysis);
  showToast(state.reviews[id] ? `${id} 已标记为工程师复核。` : `${id} 已撤销复核标记。`);
}

function drawRunChart() {
  const canvas = els.runChart;
  const analysis = state.analysis;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = bounds.width;
  const height = 282;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  if (!analysis || !analysis.rows.length) return;

  const padding = { top: 18, right: 20, bottom: 32, left: 50 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  const values = analysis.rows.map((row) => row.current).filter(Number.isFinite);
  const config = analysis.config;
  const valueMin = Math.min(...values, config.targetCurrent - config.currentTolerance * 2) - 1;
  const valueMax = Math.max(...values, config.targetCurrent + config.currentTolerance * 2) + 1;
  const timeSpan = Math.max(analysis.cadence, analysis.endTime - analysis.startTime);
  const x = (time) => padding.left + ((time - analysis.startTime) / timeSpan) * graphWidth;
  const y = (value) => padding.top + ((valueMax - value) / (valueMax - valueMin)) * graphHeight;

  context.fillStyle = '#fbfcfe';
  context.fillRect(0, 0, width, height);

  for (const run of analysis.qualifiedPlatformRuns) {
    const startX = x(run.start.t);
    const endX = x(run.end.t + analysis.cadence);
    context.fillStyle = 'rgba(37, 99, 235, 0.035)';
    context.fillRect(startX, padding.top, Math.max(2, endX - startX), graphHeight);
  }
  for (const run of analysis.qualifiedStableRuns) {
    const startX = x(run.start.t);
    const endX = x(run.end.t + analysis.cadence);
    context.fillStyle = 'rgba(22, 131, 93, 0.11)';
    context.fillRect(startX, padding.top, Math.max(2, endX - startX), graphHeight);
  }

  context.strokeStyle = '#e1e8f1';
  context.fillStyle = '#8290a3';
  context.font = '10px "Fira Code", monospace';
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const value = valueMax - ((valueMax - valueMin) * index) / 4;
    const lineY = padding.top + (graphHeight * index) / 4;
    context.beginPath();
    context.moveTo(padding.left, lineY + 0.5);
    context.lineTo(width - padding.right, lineY + 0.5);
    context.stroke();
    context.textAlign = 'right';
    context.fillText(formatFixed(value, 1), padding.left - 8, lineY + 3);
  }

  context.save();
  context.setLineDash([5, 4]);
  context.strokeStyle = '#df8a1a';
  context.lineWidth = 1.25;
  context.beginPath();
  context.moveTo(padding.left, y(config.targetCurrent));
  context.lineTo(width - padding.right, y(config.targetCurrent));
  context.stroke();
  context.restore();

  context.strokeStyle = '#2463dd';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  analysis.rows.forEach((row, index) => {
    const positionX = x(row.t);
    const positionY = y(row.current);
    if (index === 0) context.moveTo(positionX, positionY);
    else context.lineTo(positionX, positionY);
  });
  context.stroke();

  context.fillStyle = '#8290a3';
  context.font = '10px "Fira Code", monospace';
  context.textAlign = 'center';
  for (let index = 0; index <= 4; index += 1) {
    const time = analysis.startTime + (timeSpan * index) / 4;
    const positionX = padding.left + (graphWidth * index) / 4;
    context.fillText(formatElapsed(time - analysis.startTime), positionX, height - 11);
  }
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const cleanContent = content.replace(/^\uFEFF/, '');

  for (let index = 0; index < cleanContent.length; index += 1) {
    const character = cleanContent[index];
    const next = cleanContent[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV 至少需要一行字段名和一行数据。');

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('CSV 中存在空字段名，请先补全表头。');
  const records = rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] === undefined ? '' : values[index].trim();
    });
    return record;
  });

  return { headers, records };
}

function normalizeImportedData(headers, records) {
  const mapping = {
    time: findHeader(headers, ['timestamp', 'time', '时间', '时间戳', '采样时间', '采集时间']),
    current: findHeader(headers, ['current', 'stackcurrent', '电流', '堆电流', '总电流', '输出电流']),
    h2Pressure: findHeader(headers, ['h2pressure', 'hydrogenpressure', 'anodepressure', '氢气压力', '阳极压力', '供氢压力']),
    airPressure: findHeader(headers, ['airpressure', 'cathodepressure', '空气压力', '阴极压力', '进气压力']),
    coolantTemp: findHeader(headers, ['coolanttemp', 'coolanttemperature', '水温', '冷却液温度', '冷却水温度', '冷却液入口温度']),
    stackVoltage: findHeader(headers, ['stackvoltage', 'totalvoltage', '堆电压', '总电压', '输出电压']),
  };

  const missingRequired = [
    ['电流', mapping.current],
    ['氢气压力', mapping.h2Pressure],
    ['空气压力', mapping.airPressure],
    ['冷却液温度', mapping.coolantTemp],
  ]
    .filter(([, header]) => !header)
    .map(([label]) => label);

  if (missingRequired.length) {
    throw new Error(`未识别到必需字段：${missingRequired.join('、')}。请使用英文常见字段名或中文业务字段名。`);
  }

  const reservedHeaders = new Set(Object.values(mapping).filter(Boolean));
  const cells = headers
    .filter((header) => !reservedHeaders.has(header) && /(?:cell|单体|电池片|单节)/i.test(normalizeHeader(header)))
    .map((header, index) => ({
      key: `cell_${String(index + 1).padStart(2, '0')}`,
      label: header,
      header,
    }));

  const rows = records
    .map((record, index) => {
      const cellsByKey = {};
      cells.forEach((cell) => {
        cellsByKey[cell.key] = parseNumber(record[cell.header]);
      });
      const parsedTime = mapping.time ? parseTimeValue(record[mapping.time], index) : index;
      return {
        t: Number.isFinite(parsedTime) ? parsedTime : index,
        current: parseNumber(record[mapping.current]),
        h2Pressure: parseNumber(record[mappingsafe(mapping, 'h2Pressure')]),
        airPressure: parseNumber(record[mappingsafe(mapping, 'airPressure')]),
        coolantTemp: parseNumber(record[mappingsafe(mapping, 'coolantTemp')]),
        stackVoltage: mapping.stackVoltage ? parseNumber(record[mapping.stackVoltage]) : null,
        cells: cellsByKey,
      };
    })
    .sort((left, right) => left.t - right.t);

  if (rows.length < 3) throw new Error('至少需要 3 条有效时序记录。');
  return { rows, schema: { mapping, cells } };
}

function mappingsafe(mapping, key) {
  return mapping[key] || '';
}

function findHeader(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const exact = headers.find((header) => normalizedAliases.includes(normalizeHeader(header)));
  if (exact) return exact;
  return headers.find((header) => {
    const normalized = normalizeHeader(header);
    return normalizedAliases.some((alias) => normalized.includes(alias));
  });
}

function normalizeHeader(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\s_\-()[\]{}（）/\\]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function parseTimeValue(value, fallback) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric > 1e11 ? numeric / 1000 : numeric;
  const parsedDate = Date.parse(text);
  if (Number.isFinite(parsedDate)) return parsedDate / 1000;
  const hms = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3] || 0);
  return fallback;
}

function parseNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^0-9eE+-.]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function createDemoDataset() {
  const cells = Array.from({ length: 8 }, (_, index) => ({
    key: `cell_${String(index + 1).padStart(2, '0')}`,
    label: `Cell ${String(index + 1).padStart(2, '0')}`,
    header: `cell_${String(index + 1).padStart(2, '0')}`,
  }));
  const rows = [];

  for (let index = 0; index < 360; index += 1) {
    let current;
    if (index < 30) current = 87 + index * 0.43 + Math.sin(index * 0.4) * 0.16;
    else if (index < 322) current = 100 + Math.sin(index * 0.28) * 0.31 + Math.cos(index * 0.13) * 0.14;
    else current = 99.7 - (index - 322) * 0.31 + Math.sin(index * 0.32) * 0.2;

    let h2Pressure = 200 + Math.sin(index * 0.22) * 0.28 + Math.cos(index * 0.08) * 0.09;
    if (index >= 86 && index <= 104) h2Pressure = 201.85 + Math.sin(index * 0.52) * 0.18;
    if (index >= 231 && index <= 244) h2Pressure = 198.12 + Math.cos(index * 0.38) * 0.14;

    const cellsByKey = {};
    cells.forEach((cell, cellIndex) => {
      let voltage = 0.675 + Math.sin(index * 0.18 + cellIndex) * 0.0022 + Math.cos(index * 0.06 + cellIndex) * 0.0014;
      voltage += (cellIndex - 3.5) * 0.00045;
      if (cellIndex === 6 && index >= 105 && index <= 230) voltage -= 0.0215 + Math.sin(index * 0.21) * 0.001;
      cellsByKey[cell.key] = voltage;
    });

    rows.push({
      t: index,
      current,
      h2Pressure,
      airPressure: 180 + Math.sin(index * 0.19) * 0.42 + Math.cos(index * 0.07) * 0.12,
      coolantTemp: 65 + Math.sin(index * 0.11) * 0.33 + Math.cos(index * 0.05) * 0.1,
      stackVoltage: 50.9 + Math.sin(index * 0.13) * 0.16 - (index >= 105 && index <= 230 ? 0.14 : 0),
      cells: cellsByKey,
    });
  }

  return {
    rows,
    schema: {
      mapping: {
        time: 'timestamp',
        current: 'current',
        h2Pressure: 'h2_pressure',
        airPressure: 'air_pressure',
        coolantTemp: 'coolant_temp',
        stackVoltage: 'stack_voltage',
      },
      cells,
    },
  };
}

function buildEvidenceToken(analysis) {
  const source = state.source ? state.source.name : 'unknown';
  const seed = [source, analysis.rows.length, state.methodRevision, analysis.status, analysis.sampleDuration.toFixed(3)].join('|');
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `EVD-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function buildConclusion(analysis) {
  if (analysis.status === 'formal') {
    const issueCount = analysis.findings.filter((finding) => finding.actionable).length;
    return `已生成 ${formatDuration(analysis.sampleDuration)} 正式统计；${issueCount ? `发现 ${issueCount} 条待复核 Finding` : '当前规则未发现异常'}`;
  }
  if (analysis.status === 'warning') {
    return `仅生成 ${formatDuration(analysis.sampleDuration)} 预警性统计，尚未达到正式窗口`;
  }
  return '未生成统计结果，需要先建立满足 Method 的稳定区间';
}

async function copyConclusion() {
  if (!state.analysis) return;
  const text = [
    `FuelCell MethodOS / ${state.source.name}`,
    buildConclusion(state.analysis),
    `Method: M-PLT-001 v0.${state.methodRevision}`,
    `Evidence: ${state.analysis.evidenceToken}`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    showToast('结论摘要已复制到剪贴板。');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('结论摘要已复制到剪贴板。');
  }
}

function exportReport() {
  if (!state.analysis) return;
  const documentText = buildReportDocument(state.analysis);
  triggerDownload(
    new Blob([documentText], { type: 'text/html;charset=utf-8' }),
    `FuelCell-MethodOS-${safeFilename(state.source.name)}-report.html`,
  );
  showToast('HTML 报告已导出，包含 Method、证据和审核状态。');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildReportDocument(analysis) {
  const findings = analysis.findings;
  const actionables = findings.filter((finding) => finding.actionable);
  const reviewed = actionables.filter((finding) => state.reviews[finding.id]).length;
  const parameterRows = [
    ['目标电流', `${formatFixed(state.config.targetCurrent, 1)} A`],
    ['电流容差', `±${formatFixed(state.config.currentTolerance, 1)} A`],
    ['最短平台时长', formatDuration(state.config.minPlatformSec)],
    ['最短稳定时长', formatDuration(state.config.minStableSec)],
    ['正式统计窗口', formatDuration(state.config.sampleWindowSec)],
    ['氢气压力目标 / 容差', `${formatFixed(state.config.targetH2Pressure, 1)} ± ${formatFixed(state.config.h2Tolerance, 1)} kPa`],
    ['空气压力目标 / 容差', `${formatFixed(state.config.targetAirPressure, 1)} ± ${formatFixed(state.config.airTolerance, 1)} kPa`],
    ['冷却液温度目标 / 容差', `${formatFixed(state.config.targetCoolantTemp, 1)} ± ${formatFixed(state.config.coolantTolerance, 1)} °C`],
  ];
  const statistics = analysis.stats
    ? [
        ['平均堆电流', `${formatFixed(analysis.stats.current, 2)} A`],
        ['平均氢气压力', `${formatFixed(analysis.stats.h2Pressure, 2)} kPa`],
        ['平均空气压力', `${formatFixed(analysis.stats.airPressure, 2)} kPa`],
        ['平均冷却液温度', `${formatFixed(analysis.stats.coolantTemp, 2)} °C`],
        ['平均堆电压', Number.isFinite(analysis.stats.stackVoltage) ? `${formatFixed(analysis.stats.stackVoltage, 3)} V` : '未映射'],
      ]
    : [['统计状态', '未生成正式/预警统计窗口']];
  const reportFindings = findings
    .map(
      (finding) => `
        <tr>
          <td>${escapeHtml(finding.id)}</td>
          <td>${escapeHtml(finding.severityLabel)}</td>
          <td>${escapeHtml(finding.title)}</td>
          <td>${escapeHtml(finding.description)}</td>
          <td>${finding.actionable ? (state.reviews[finding.id] ? '已复核' : '待复核') : '规则通过'}</td>
        </tr>`,
    )
    .join('');
  const rowsToHtml = (rows) => rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
  const windowValue = analysis.sampleRows.length
    ? `${formatRunRange(analysis.bestStable, analysis)} · ${formatDuration(analysis.sampleDuration)}`
    : '—';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>FuelCell MethodOS 报告</title>
<style>
  body{max-width:980px;margin:42px auto;padding:0 28px;color:#19324f;background:#f7f9fc;font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  main{padding:38px;background:#fff;border:1px solid #dbe4ef}.eyebrow{color:#2563eb;font:700 11px monospace;letter-spacing:.08em}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:25px 0}.meta div{padding:12px;background:#f4f7fb;border-left:2px solid #84a8df}.meta span,.meta strong{display:block}.meta span{font-size:12px;color:#61708a}.meta strong{margin-top:4px;color:#183d75;font:600 12px monospace}h1{margin:6px 0;font-size:31px;letter-spacing:-.04em}h2{margin:32px 0 10px;font-size:18px}p{color:#5d6e85}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:10px;border:1px solid #dce5ef;text-align:left;vertical-align:top}th{width:31%;color:#48627f;background:#f7f9fc;font-weight:600}td{color:#304a68}.finding th{width:auto}.footer{margin-top:28px;color:#74869d;font:12px monospace}@media(max-width:640px){.meta{grid-template-columns:1fr}body{margin:0;padding:0}.finding{display:block;overflow:auto}}
</style></head><body><main>
  <p class="eyebrow">FUELCELL METHODOS / AUTO REPORT</p>
  <h1>燃料电池测试分析报告</h1>
  <p>此报告由可配置 Method 生成；计算规则、证据窗口和人工审核状态均已记录。原始时序数据未写入该报告。</p>
  <section class="meta">
    <div><span>数据源</span><strong>${escapeHtml(state.source.name)}</strong></div>
    <div><span>分析结论</span><strong>${escapeHtml(buildConclusion(analysis))}</strong></div>
    <div><span>证据标识</span><strong>${escapeHtml(analysis.evidenceToken)}</strong></div>
  </section>
  <h2>1. 统计摘要</h2>
  <table><tbody>
    <tr><th>统计窗口</th><td>${escapeHtml(windowValue)}</td></tr>
    <tr><th>数据完整度</th><td>${formatFixed(analysis.quality.completeness, 2)}%（必需字段缺失 ${analysis.quality.missing} 个；时间戳异常 ${analysis.quality.duplicates} 个）</td></tr>
    <tr><th>审核状态</th><td>${reviewed}/${actionables.length} 条待复核 Finding 已由工程师标记复核</td></tr>
    ${rowsToHtml(statistics)}
  </tbody></table>
  <h2>2. Method 参数</h2>
  <table><tbody>${rowsToHtml(parameterRows)}</tbody></table>
  <h2>3. Findings 与人工审核</h2>
  <table class="finding"><thead><tr><th>ID</th><th>等级</th><th>结论</th><th>证据说明</th><th>审核</th></tr></thead><tbody>${reportFindings}</tbody></table>
  <p class="footer">Method: M-PLT-001 v0.${state.methodRevision} · Evidence: ${escapeHtml(analysis.evidenceToken)} · 本报告仅包含可复算摘要。</p>
</main></body></html>`;
}

function formatRunRange(run, analysis) {
  if (!run) return '—';
  return `${formatElapsed(run.start.t - analysis.startTime)}–${formatElapsed(run.end.t - analysis.startTime)}`;
}

function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  return `${Math.round(seconds)} s`;
}

function formatFixed(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function median(values) {
  const valid = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!valid.length) return 0;
  const midpoint = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[midpoint] : (valid[midpoint - 1] + valid[midpoint]) / 2;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '') || 'analysis';
}

function csvValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const text = typeof value === 'number'
    ? Number.isInteger(value)
      ? String(value)
      : value.toFixed(6)
    : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function showToast(message, type = 'success') {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast is-visible${type === 'error' ? ' is-error' : ''}`;
  toastTimer = window.setTimeout(() => {
    els.toast.className = 'toast';
  }, 4200);
}
