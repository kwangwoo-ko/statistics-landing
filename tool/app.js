/* GraphZen — client-side statistical analysis tool. Data never leaves the browser. */
(function () {
  'use strict';

  var PALETTE = ["#4F6BED", "#D4AF37", "#0A1128", "#6889B0", "#C05746", "#3D8B7D", "#8B6BB1", "#B0A15A"];
  var POINT_COLOR = "#C05746";

  var SAMPLE_CSV = "Control,Treatment_A,Treatment_B\n22.81,23.85,25.17\n23.56,27.49,22.79\n25.55,28.35,26.02\n24.23,27.85,24.11\n25.10,27.41,23.49\n24.69,26.32,23.53\n23.24,28.04,24.23\n24.65,27.79,23.83\n23.62,26.97,27.05\n23.61,26.51,23.44\n24.12,26.07,24.34\n22.17,25.02,24.33\n25.43,27.97,24.33\n23.19,23.89,24.37\n25.20,26.06,23.72\n24.16,26.70,23.60\n25.84,27.53,23.27\n23.21,28.61,22.51\n23.63,27.69,24.56\n24.41,26.15,25.48";

  var S = GraphZenStats;
  var state = { fileName: null, columns: [], numericCols: [] };

  var el = function (id) { return document.getElementById(id); };

  /* ---------- data loading ---------- */

  function isNumericColumn(values) {
    var nonEmpty = 0, numeric = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      nonEmpty++;
      if (isFinite(parseFloat(v))) numeric++;
    }
    return nonEmpty >= 3 && numeric / nonEmpty >= 0.9;
  }

  function setData(columns, fileName) {
    state.columns = columns;
    state.fileName = fileName;
    var box = el('columnsBox');
    box.innerHTML = '';
    if (!columns.length) {
      el('fileError').style.display = 'block';
      el('fileError').textContent = 'No usable columns were found in this file. Make sure the first row contains column headers.';
      return;
    }
    el('fileError').style.display = 'none';
    columns.forEach(function (col) {
      var row = document.createElement('div');
      row.className = 'checkbox-row';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = col.name;
      cb.id = 'col_' + col.name;
      cb.checked = true;
      cb.addEventListener('change', updateGenerateState);
      var span = document.createElement('span');
      span.textContent = col.name + '  (' + col.values.length + ' values)';
      row.appendChild(cb);
      row.appendChild(span);
      box.appendChild(row);
    });
    el('fileStatus').style.display = 'block';
    el('fileStatus').textContent = 'Loaded "' + fileName + '" — ' + columns.length + ' numeric columns, ' + columns[0].values.length + ' rows each.';
    updateGenerateState();
  }

  function parseCSVText(text, fileName) {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        var rows = results.data;
        if (!rows.length) { setData([], fileName); return; }
        var names = Object.keys(rows[0]);
        var columns = [];
        names.forEach(function (name) {
          var values = rows.map(function (r) { return r[name]; });
          if (isNumericColumn(values)) {
            var nums = [];
            values.forEach(function (v) {
              var n = parseFloat(v);
              if (isFinite(n)) nums.push(n);
            });
            columns.push({ name: name, values: nums });
          }
        });
        setData(columns, fileName);
      },
      error: function () {
        el('fileError').style.display = 'block';
        el('fileError').textContent = 'The file could not be parsed as CSV.';
      }
    });
  }

  function handleFile(file) {
    if (!file) return;
    el('fileStatus').style.display = 'none';
    var reader = new FileReader();
    reader.onload = function (e) { parseCSVText(e.target.result, file.name); };
    reader.readAsText(file);
  }

  /* ---------- generate ---------- */

  function getSelectedGroups() {
    var checks = el('columnsBox').querySelectorAll('input[type="checkbox"]:checked');
    var groups = [];
    checks.forEach(function (cb) {
      var col = state.columns.find(function (c) { return c.name === cb.value; });
      if (col) groups.push({ name: col.name, values: col.values.slice() });
    });
    return groups;
  }

  function updateGenerateState() {
    var groups = getSelectedGroups();
    el('generateBtn').disabled = groups.length < 2;
    var warn = el('testWarn');
    var test = el('testType').value;
    warn.style.display = 'none';
    if (groups.length < 2) {
      warn.style.display = 'block';
      warn.textContent = 'Select at least 2 numeric columns to compare.';
    } else if ((test === 'student' || test === 'welch') && groups.length !== 2) {
      warn.style.display = 'block';
      warn.textContent = 't-tests compare exactly 2 groups. With ' + groups.length + ' groups selected, one-way ANOVA will be used instead.';
    }
  }

  function fmtP(p) {
    if (!isFinite(p)) return 'p = —';
    if (p < 0.0001) return 'p < 0.0001';
    return 'p = ' + p.toFixed(3);
  }

  function fmtNum(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function generate() {
    var groups = getSelectedGroups();
    el('genError').style.display = 'none';
    if (groups.length < 2) {
      el('genError').style.display = 'block';
      el('genError').textContent = 'Select at least 2 numeric columns to compare.';
      return;
    }

    var test = el('testType').value;
    var note = '';
    if ((test === 'student' || test === 'welch') && groups.length !== 2) {
      note = 't-tests compare exactly 2 groups — one-way ANOVA was used because ' + groups.length + ' groups were selected.';
      test = 'anova';
    }

    var showPoints = el('showPoints').checked;
    var xLabel = el('xLabel').value || 'Groups';
    var yLabel = el('yLabel').value || 'Value';

    renderChart(groups, el('graphType').value, showPoints, xLabel, yLabel);
    el('chartCard').style.display = 'block';
    el('adMid').style.display = 'block';

    var resultsBody = el('resultsBody');
    if (test === 'none') {
      el('resultsCard').style.display = 'none';
    } else {
      var res, interpretation = '';
      if (test === 'anova' || groups.length > 2) {
        res = S.anovaOneWay(groups.map(function (g) { return g.values; }));
        var sig = res.p < 0.05;
        interpretation =
          'A one-way ANOVA compared the means of ' + groups.length + ' groups (N = ' + res.N + '): ' +
          groups.map(function (g) { return '"' + g.name + '"'; }).join(', ') + '. ' +
          (sig
            ? 'There was a statistically significant difference between at least two of the group means, ' + fmtP(res.p) + '. '
            : 'There was no statistically significant difference between the group means, ' + fmtP(res.p) + '. ') +
          (sig
            ? 'Post-hoc pairwise comparisons are recommended to identify exactly which groups differ.'
            : 'The observed differences between group means could reflect sampling variability.');
        renderAnovaResults(res, groups, sig, note);
      } else {
        res = S.tTestIndependent(groups[0].values, groups[1].values, test === 'welch');
        var sig = res.p < 0.05;
        var dir = res.mean1 > res.mean2 ? 'higher' : 'lower';
        interpretation =
          'A ' + res.test + ' compared "' + groups[0].name + '" (n = ' + res.n1 + ', M = ' + fmtNum(res.mean1) + ', SD = ' + fmtNum(res.sd1) + ') and "' +
          groups[1].name + '" (n = ' + res.n2 + ', M = ' + fmtNum(res.mean2) + ', SD = ' + fmtNum(res.sd2) + '). ' +
          'The difference between the group means was ' + (sig ? '' : 'not ') + 'statistically significant, ' + fmtP(res.p) + '. ' +
          (sig
            ? 'The mean of "' + groups[0].name + '" was ' + dir + ' than the mean of "' + groups[1].name + '" (difference = ' + fmtNum(Math.abs(res.mean1 - res.mean2)) + ').'
            : 'The observed difference could reflect sampling variability.');
        renderTTestResults(res, groups, sig, note);
      }
      resultsBody.appendChild(buildInterpretation(interpretation));
      el('resultsCard').style.display = 'block';
    }

    el('chartCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderChart(groups, type, showPoints, xLabel, yLabel) {
    var traces = [];
    var idx = groups.map(function (_, i) { return i; });

    if (type === 'bar') {
      var means = groups.map(function (g) { return S.mean(g.values); });
      var sds = groups.map(function (g) { return Math.sqrt(S.sampleVar(g.values)); });
      traces.push({
        type: 'bar',
        x: idx, y: means,
        error_y: { type: 'data', array: sds, visible: true },
        marker: { color: groups.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) },
        name: 'Mean ± SD',
        hovertemplate: '%{x}: mean %{y:.3f}<extra></extra>'
      });
      if (showPoints) {
        groups.forEach(function (g, i) {
          var xs = g.values.map(function (_, k) { return i + (Math.random() - 0.5) * 0.36; });
          traces.push({
            type: 'scatter', x: xs, y: g.values, mode: 'markers',
            marker: { color: POINT_COLOR, size: 6, opacity: 0.55 },
            showlegend: false, hoverinfo: 'y'
          });
        });
      }
    } else if (type === 'box') {
      groups.forEach(function (g, i) {
        traces.push({
          type: 'box', y: g.values, x0: g.name, name: g.name,
          boxpoints: showPoints ? 'all' : 'outliers',
          pointpos: 0, jitter: 0.3,
          marker_color: PALETTE[i % PALETTE.length],
          fillcolor: hexToRgba(PALETTE[i % PALETTE.length], 0.35),
          line: { color: '#0A1128', width: 1.5 },
          opacity: 0.9
        });
      });
    } else {
      groups.forEach(function (g, i) {
        traces.push({
          type: 'violin', y: g.values, x0: g.name, name: g.name,
          box_visible: true, meanline_visible: true,
          points: showPoints ? 'all' : 'outliers',
          pointpos: 0, jitter: 0.3,
          marker_color: PALETTE[i % PALETTE.length],
          fillcolor: hexToRgba(PALETTE[i % PALETTE.length], 0.35),
          line: { color: '#0A1128', width: 1.5 },
          opacity: 0.9
        });
      });
    }

    var layout = {
      template: 'none',
      title: { text: '', font: { family: 'Inter' } },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: { family: 'Inter, -apple-system, sans-serif', size: 13, color: '#0A1128' },
      xaxis: type === 'bar'
        ? { title: { text: xLabel }, tickvals: idx, ticktext: groups.map(function (g) { return g.name; }), gridcolor: '#E5E7EB' }
        : { title: { text: xLabel }, gridcolor: '#E5E7EB' },
      yaxis: { title: { text: yLabel }, gridcolor: '#E5E7EB', zeroline: true, zerolinecolor: '#D1D5DB' },
      margin: { l: 60, r: 30, t: 20, b: 50 },
      showlegend: false
    };

    Plotly.newPlot('chart', traces, layout, { responsive: true, displayModeBar: false });
  }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function fmtP(p) {
    if (!isFinite(p)) return '—';
    if (p < 0.0001) return 'p < 0.0001';
    return 'p = ' + p.toFixed(3);
  }

  function fmtNum(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function renderTTestResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    if (note) {
      var n = document.createElement('p');
      n.style.cssText = 'font-size:.8rem;color:#B45309;background:#FEF3C7;border-radius:8px;padding:.5rem .7rem;';
      n.textContent = note;
      body.appendChild(n);
    }
    var badge = document.createElement('div');
    badge.style.margin = '0.75rem 0';
    badge.innerHTML = '<span class="sig-badge ' + (sig ? 'sig-yes' : 'sig-no') + '">' +
      (sig ? 'Statistically significant difference found' : 'No statistically significant difference found') +
      '</span>';
    body.appendChild(badge);

    var table = document.createElement('table');
    table.className = 'res-table';
    var html = '<thead><tr><th>Test</th><th>' + res.statLabel + '</th><th>df</th><th>p-value</th></tr></thead><tbody>' +
      '<tr><td>' + res.test + '</td><td>' + fmtNum(res.statistic) + '</td><td>' + fmtNum(res.df) + '</td><td>' + fmtP(res.p) + '</td></tr>' +
      '</tbody></table>';
    var table2 = '<table class="res-table" style="margin-top:1rem;"><thead><tr><th>Group</th><th>n</th><th>Mean</th><th>SD</th></tr></thead><tbody>' +
      '<tr><td>' + groups[0].name + '</td><td>' + res.n1 + '</td><td>' + fmtNum(res.mean1) + '</td><td>' + fmtNum(res.sd1) + '</td></tr>' +
      '<tr><td>' + groups[1].name + '</td><td>' + res.n2 + '</td><td>' + fmtNum(res.mean2) + '</td><td>' + fmtNum(res.sd2) + '</td></tr>' +
      '</tbody></table>';
    table.innerHTML = html + table2;
    body.appendChild(table);
  }

  function renderAnovaResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    if (note) {
      var n = document.createElement('p');
      n.style.cssText = 'font-size:.8rem;color:#B45309;background:#FEF3C7;border-radius:8px;padding:.5rem .7rem;';
      n.textContent = note;
      body.appendChild(n);
    }
    var badge = document.createElement('div');
    badge.style.margin = '0.75rem 0';
    badge.innerHTML = '<span class="sig-badge ' + (sig ? 'sig-yes' : 'sig-no') + '">' +
      (sig ? 'Statistically significant difference found between group means' : 'No statistically significant difference found between group means') +
      '</span>';
    body.appendChild(badge);

    var table = document.createElement('table');
    table.className = 'res-table';
    var html = '<thead><tr><th>Test</th><th>F</th><th>df (between)</th><th>df (within)</th><th>p-value</th></tr></thead><tbody>' +
      '<tr><td>One-way ANOVA</td><td>' + fmtNum(res.statistic) + '</td><td>' + res.df1 + '</td><td>' + res.df2 + '</td><td>' + fmtP(res.p) + '</td></tr>' +
      '</tbody></table>';
    var rows = groups.map(function (g, i) {
      return '<tr><td>' + g.name + '</td><td>' + g.values.length + '</td><td>' + fmtNum(res.groupMeans[i]) + '</td><td>' + fmtNum(res.groupSds[i]) + '</td></tr>';
    }).join('');
    var table2 = '<table class="res-table" style="margin-top:1rem;"><thead><tr><th>Group</th><th>n</th><th>Mean</th><th>SD</th></tr></thead><tbody>' + rows + '</tbody></table>';
    table.innerHTML = html + table2;
    body.appendChild(table);
  }

  function buildInterpretation(text) {
    var div = document.createElement('div');
    div.className = 'interpretation';
    var h = document.createElement('strong');
    h.textContent = 'Interpretation — ';
    div.appendChild(h);
    div.appendChild(document.createTextNode(text));
    return div;
  }

  /* ---------- export ---------- */

  function downloadImage(format) {
    var gd = document.getElementById('chart');
    Plotly.toImage(gd, { format: format, width: 1400, height: 900, scale: format === 'png' ? 2 : 1 })
      .then(function (dataURL) {
        var a = document.createElement('a');
        a.href = dataURL;
        a.download = 'graphzen-visualization.' + format;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

  /* ---------- wiring ---------- */

  el('fileInput').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
  var dz = el('dropZone');
  dz.addEventListener('click', function () { el('fileInput').click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault();
    dz.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  el('loadSample').addEventListener('click', function () {
    parseCSVText(SAMPLE_CSV, 'sample_data.csv');
  });
  el('columnsBox').addEventListener('change', updateGenerateState);
  el('testType').addEventListener('change', updateGenerateState);
  el('generateBtn').addEventListener('click', generate);
  el('dlPng').addEventListener('click', function () { downloadImage('png'); });
  el('dlSvg').addEventListener('click', function () { downloadImage('svg'); });

  /* cookie banner */
  var banner = el('cookieBanner');
  var accepted = false;
  try { accepted = !!localStorage.getItem('cookieConsent'); } catch (e) { accepted = false; }
  if (!accepted) banner.classList.add('show');
  el('cookieAccept').addEventListener('click', function () {
    try { localStorage.setItem('cookieConsent', 'accepted'); } catch (e) {}
    banner.classList.remove('show');
  });

  updateGenerateState();
})();
