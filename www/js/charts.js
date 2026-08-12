/**
 * charts.js — إعداد رسوم Chart.js لصفحة التقدم
 */

let wordsChartInstance = null;
let pronunciationChartInstance = null;

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: getCssVar('--text-primary'),
        titleColor: getCssVar('--bg'),
        bodyColor: getCssVar('--bg'),
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: 'IBM Plex Sans Arabic' },
        bodyFont: { family: 'IBM Plex Sans Arabic' },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: getCssVar('--text-tertiary'), font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: getCssVar('--border') },
        ticks: { color: getCssVar('--text-tertiary'), font: { size: 11 } },
      },
    },
  };
}

function renderWordsChart(canvasEl, progressDaily) {
  const sorted = [...progressDaily].sort((a, b) => (a.date > b.date ? 1 : -1)).slice(-14);
  const labels = sorted.map((p) => formatShortDate(p.date));
  const data = sorted.map((p) => p.newWordsLearned || 0);

  if (wordsChartInstance) wordsChartInstance.destroy();

  wordsChartInstance = new Chart(canvasEl, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: getCssVar('--accent'),
          borderRadius: 6,
          maxBarThickness: 22,
        },
      ],
    },
    options: chartBaseOptions(),
  });
}

function renderPronunciationChart(canvasEl, progressDaily) {
  const sorted = [...progressDaily].sort((a, b) => (a.date > b.date ? 1 : -1)).slice(-14);
  const labels = sorted.map((p) => formatShortDate(p.date));
  const data = sorted.map((p) => (p.avgPronunciationScore != null ? Math.round(p.avgPronunciationScore * 100) : null));

  if (pronunciationChartInstance) pronunciationChartInstance.destroy();

  pronunciationChartInstance = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data,
          borderColor: getCssVar('--success'),
          backgroundColor: getCssVar('--success'),
          tension: 0.35,
          pointRadius: 3,
          spanGaps: true,
        },
      ],
    },
    options: {
      ...chartBaseOptions(),
      scales: {
        ...chartBaseOptions().scales,
        y: { ...chartBaseOptions().scales.y, max: 100, ticks: { ...chartBaseOptions().scales.y.ticks, callback: (v) => v + '%' } },
      },
    },
  });
}

function formatShortDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('ar', { day: 'numeric', month: 'short' });
}

window.AppCharts = { renderWordsChart, renderPronunciationChart };
