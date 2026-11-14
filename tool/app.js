/* GraphZen — client-side statistical analysis tool. Data never leaves the browser. */
(function () {
  'use strict';

  var PALETTE = ["#4F6BED", "#D4AF37", "#0A1128", "#6889B0", "#C05746", "#3D8B7D", "#8B6BB1", "#B0A15A"];
  var POINT_COLOR = "#C05746";

  var SAMPLE_CSV = "Control,Treatment_A,Treatment_B\n22.81,23.85,25.17\n23.56,27.49,22.79\n25.55,28.35,26.02\n24.23,27.85,24.11\n25.10,27.41,23.49\n24.69,26.32,23.53\n23.24,28.04,24.23\n24.65,27.79,23.83\n23.62,26.97,27.05\n23.61,26.51,23.44\n24.12,26.07,24.34\n22.17,25.02,24.33\n25.43,27.97,24.33\n23.19,23.89,24.37\n25.20,26.06,23.72\n24.16,26.70,23.60\n25.84,27.53,23.27\n23.21,28.61,22.51\n23.63,27.69,24.56\n24.41,26.15,25.48";

  var S = GraphZenStats;
  var state = { datasets: [] };

  var el = function (id) { return document.getElementById(id); };

  function stripExt(name) { return String(name).replace(/\.[^.]+$/, ''); }

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

  function buildDataset(rows, fileName) {
    if (!rows || !rows.length) return { name: fileName, columns: [] };
    var names = Object.keys(rows[0]);
    var columns = [];
    names.forEach(function (name) {
      if (name === undefined || name === '') return;
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
    return { name: fileName, columns: columns };
  }

  function parseCSVText(text, fileName) {
    var res = Papa.parse(text, { header: true, skipEmptyLines: true });
    return buildDataset(res.data, fileName);
  }

  function parseExcelBuffer(buffer, fileName) {
    try {
      var wb = XLSX.read(buffer, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows.length) return { name: fileName, columns: [] };
      var header = rows[0].map(function (h) { return String(h); });
      var objs = rows.slice(1).map(function (r) {
        var o = {};
        header.forEach(function (h, i) { o[h] = r[i]; });
        return o;
      });
      return buildDataset(objs, fileName);
    } catch (e) {
      return null;
    }
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    el('fileError').style.display = 'none';
    var pending = files.length;
    var parsed = new Array(files.length);
    files.forEach(function (file, idx) {
      var isExcel = /\.xlsx?$/i.test(file.name);
      var reader = new FileReader();
      reader.onload = function (e) {
        var ds = isExcel
          ? parseExcelBuffer(e.target.result, file.name)
          : parseCSVText(e.target.result, file.name);
        parsed[idx] = ds;
        if (--pending === 0) {
          var good = parsed.filter(function (d) { return d && d.columns && d.columns.length; });
          if (!good.length) {
            el('fileError').style.display = 'block';
            el('fileError').textContent = 'No numeric columns were found in the uploaded file(s). Make sure the first row contains column headers.';
            return;
          }
          state.datasets = state.datasets.concat(good);
          renderFileUI();
        }
      };
      reader.onerror = function () {
        if (--pending === 0) renderFileUI();
      };
      if (isExcel) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  function renderFileUI() {
    var box = el('columnsBox');
    box.innerHTML = '';
    el('clearRow').style.display = state.datasets.length ? 'block' : 'none';

    if (!state.datasets.length) {
      box.innerHTML = '<p class="hint">Upload a file first — numeric columns will appear here.</p>';
      el('fileStatus').style.display = 'none';
      updateGenerateState();
      return;
    }

    el('fileStatus').style.display = 'block';
    if (state.datasets.length === 1) {
      var ds = state.datasets[0];
      el('fileStatus').textContent = 'Loaded "' + ds.name + '" — ' + ds.columns.length + ' numeric columns, ' + ds.columns[0].values.length + ' rows each.';
      el('columnsLabel').innerHTML = 'Select Numeric Columns to Compare <span style="color:#9CA3AF;font-weight:400;">(choose 2 or more)</span>';
      ds.columns.forEach(function (col) {
        box.appendChild(makeCheckbox(String(col.name), col.name + '  (' + col.values.length + ' values)', true));
      });
    } else {
      var total = 0;
      state.datasets.forEach(function (d) { total += d.columns[0].values.length; });
      el('fileStatus').textContent = 'Loaded ' + state.datasets.length + ' files — comparing across files (each file is one group).';
      el('columnsLabel').innerHTML = 'Select Files to Compare <span style="color:#9CA3AF;font-weight:400;">(each file is one group)</span>';
      state.datasets.forEach(function (d, i) {
        var n = 0;
        d.columns.forEach(function (c) { n += c.values.length; });
        box.appendChild(makeCheckbox(String(i), stripExt(d.name) + '  (' + n + ' values)', true));
      });
    }
    updateGenerateState();
  }

  function makeCheckbox(value, label, checked) {
    var row = document.createElement('div');
    row.className = 'checkbox-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = value;
    cb.checked = checked;
    cb.addEventListener('change', updateGenerateState);
    var span = document.createElement('span');
    span.textContent = label;
    row.appendChild(cb);
    row.appendChild(span);
    return row;
  }

  /* ---------- generate ---------- */

  function getSelectedGroups() {
    var checks = el('columnsBox').querySelectorAll('input[type="checkbox"]:checked');
    var groups = [];
    if (state.datasets.length === 1) {
      checks.forEach(function (cb) {
        var col = state.datasets[0].columns.find(function (c) { return String(c.name) === cb.value; });
        if (col) groups.push({ name: col.name, values: col.values.slice() });
      });
    } else if (state.datasets.length > 1) {
      checks.forEach(function (cb) {
        var ds = state.datasets[parseInt(cb.value, 10)];
        if (ds) {
          var vals = [];
          ds.columns.forEach(function (c) { vals = vals.concat(c.values); });
          groups.push({ name: stripExt(ds.name), values: vals });
        }
      });
    }
    return groups;
  }

  function updateGenerateState() {
    var groups = getSelectedGroups();
    var type = el('graphType').value;
    var test = el('testType').value;
    el('generateBtn').disabled = groups.length < 2;
    var warn = el('testWarn');
    warn.style.display = 'none';
    if (groups.length < 2) {
      warn.style.display = 'block';
      warn.textContent = 'Select at least 2 numeric columns (or files) to compare.';
    } else if (type === 'scatter' && groups.length !== 2) {
      warn.style.display = 'block';
      warn.textContent = 'Scatter plots compare exactly two groups (X vs Y). Select exactly 2.';
    } else if ((test === 'student' || test === 'welch' || test === 'mannwhitney') && groups.length !== 2) {
      var target = test === 'mannwhitney' ? 'Kruskal-Wallis' : 'one-way ANOVA';
      warn.style.display = 'block';
      warn.textContent = (test === 'mannwhitney' ? 'Mann-Whitney U compares exactly 2 groups' : 't-tests compare exactly 2 groups') +
        '. With ' + groups.length + ' groups selected, ' + target + ' will be used instead.';
    }
  }

  function fmtP(p) {
    if (!isFinite(p)) return '—';
    if (p < 0.0001) return 'p < 0.0001';
    return 'p = ' + p.toFixed(3);
  }

  function fmtNum(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function generate() {
    var groups = getSelectedGroups();
    var graphType = el('graphType').value;
    el('genError').style.display = 'none';

    if (groups.length < 2) {
      el('genError').style.display = 'block';
      el('genError').textContent = 'Select at least 2 numeric columns (or files) to compare.';
      return;
    }
    if (graphType === 'scatter' && groups.length !== 2) {
      el('genError').style.display = 'block';
      el('genError').textContent = 'Scatter plots compare exactly two groups (X vs Y). Select exactly 2.';
      return;
    }

    var test = el('testType').value;
    var note = '';
    if ((test === 'student' || test === 'welch' || test === 'mannwhitney') && groups.length !== 2) {
      var changed = test === 'mannwhitney' ? 'kruskal' : 'anova';
      note = (test === 'mannwhitney' ? 'Mann-Whitney U compares exactly 2 groups' : 't-tests compare exactly 2 groups') +
        ' — ' + (changed === 'kruskal' ? 'Kruskal-Wallis' : 'one-way ANOVA') + ' was used because ' + groups.length + ' groups were selected.';
      test = changed;
    }

    var showPoints = el('showPoints').checked;
    var xLabel = el('xLabel').value || 'Groups';
    var yLabel = el('yLabel').value || 'Value';

    renderChart(groups, graphType, showPoints, xLabel, yLabel);
    el('chartCard').style.display = 'block';
    el('adMid').style.display = 'block';

    var showDist = (graphType === 'box' || graphType === 'violin');
    var resultsBody = el('resultsBody');
    resultsBody.innerHTML = '';
    var showCard = false;

    if (test !== 'none') {
      if (test === 'mannwhitney') {
        var resMw = S.mannWhitneyU(groups[0].values, groups[1].values);
        var sigMw = resMw.p < 0.05;
        var med1 = S.median(groups[0].values), med2 = S.median(groups[1].values);
        var dirMw = med1 > med2 ? 'higher' : 'lower';
        var interpretationMw =
          'A Mann-Whitney U test compared the distributions of "' + groups[0].name + '" (n = ' + resMw.n1 + ', median = ' + fmtNum(med1) + ') and "' +
          groups[1].name + '" (n = ' + resMw.n2 + ', median = ' + fmtNum(med2) + '). ' +
          'The difference between the distributions was ' + (sigMw ? '' : 'not ') + 'statistically significant, ' + fmtP(resMw.p) + '. ' +
          (sigMw
            ? 'Values in "' + groups[0].name + '" tended to be ' + dirMw + ' than values in "' + groups[1].name + '".'
            : 'The observed difference could reflect sampling variability.') +
          (resMw.exact ? '' : ' (Normal approximation with tie correction.)');
        renderMwuResults(resMw, groups, sigMw, note);
        resultsBody.appendChild(buildInterpretation(interpretationMw));
        showCard = true;
      } else if (test === 'kruskal') {
        var resKw = S.kruskalWallis(groups.map(function (g) { return g.values; }));
        var sigKw = resKw.p < 0.05;
        var interpretationKw =
          'A Kruskal-Wallis test compared the distributions of ' + groups.length + ' groups (N = ' + resKw.N + '): ' +
          groups.map(function (g) { return '"' + g.name + '"'; }).join(', ') + '. ' +
          (sigKw
            ? 'There was a statistically significant difference between at least two of the group distributions, ' + fmtP(resKw.p) + '.'
            : 'There was no statistically significant difference between the group distributions, ' + fmtP(resKw.p) + '.') +
          (sigKw ? ' Post-hoc pairwise comparisons are recommended to identify which groups differ.' : '');
        renderKruskalResults(resKw, groups, sigKw, note);
        resultsBody.appendChild(buildInterpretation(interpretationKw));
        showCard = true;
      } else if (test === 'anova') {
        var resA = S.anovaOneWay(groups.map(function (g) { return g.values; }));
        var sigA = resA.p < 0.05;
        var interpretationA =
          'A one-way ANOVA compared the means of ' + groups.length + ' groups (N = ' + resA.N + '): ' +
          groups.map(function (g) { return '"' + g.name + '"'; }).join(', ') + '. ' +
          (sigA
            ? 'There was a statistically significant difference between at least two of the group means, ' + fmtP(resA.p) + '. '
            : 'There was no statistically significant difference between the group means, ' + fmtP(resA.p) + '. ') +
          (sigA
            ? 'Post-hoc pairwise comparisons are recommended to identify exactly which groups differ.'
            : 'The observed differences between group means could reflect sampling variability.');
        renderAnovaResults(resA, groups, sigA, note);
        resultsBody.appendChild(buildInterpretation(interpretationA));
        showCard = true;
      } else {
        var resT = S.tTestIndependent(groups[0].values, groups[1].values, test === 'welch');
        var sigT = resT.p < 0.05;
        var dirT = resT.mean1 > resT.mean2 ? 'higher' : 'lower';
        var interpretationT =
          'A ' + resT.test + ' compared "' + groups[0].name + '" (n = ' + resT.n1 + ', M = ' + fmtNum(resT.mean1) + ', SD = ' + fmtNum(resT.sd1) + ') and "' +
          groups[1].name + '" (n = ' + resT.n2 + ', M = ' + fmtNum(resT.mean2) + ', SD = ' + fmtNum(resT.sd2) + '). ' +
          'The difference between the group means was ' + (sigT ? '' : 'not ') + 'statistically significant, ' + fmtP(resT.p) + '. ' +
          (sigT
            ? 'The mean of "' + groups[0].name + '" was ' + dirT + ' than the mean of "' + groups[1].name + '" (difference = ' + fmtNum(Math.abs(resT.mean1 - resT.mean2)) + ').'
            : 'The observed difference could reflect sampling variability.');
        renderTTestResults(resT, groups, sigT, note);
        resultsBody.appendChild(buildInterpretation(interpretationT));
        showCard = true;
      }
    }

    if (showDist) {
      renderDistSummary(groups, resultsBody);
      showCard = true;
    }

    el('resultsCard').style.display = showCard ? 'block' : 'none';
    el('chartCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- chart ---------- */

  function renderChart(groups, type, showPoints, xLabel, yLabel) {
    var traces = [];
    var idx = groups.map(function (_, i) { return i; });
    var layoutExtra = {};

    if (type === 'bar') {
      var means = groups.map(function (g) { return S.mean(g.values); });
      var sds = groups.map(function (g) { return Math.sqrt(S.sampleVar(g.values)); });
      traces.push({
        type: 'bar', x: idx, y: means,
        error_y: { type: 'data', array: sds, visible: true },
        marker: { color: groups.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) },
        name: 'Mean ± SD',
        hovertemplate: '%{x}: mean %{y:.3f}<extra></extra>'
      });
      if (showPoints) {
        groups.forEach(function (g, i) {
          var xs = g.values.map(function () { return i + (Math.random() - 0.5) * 0.36; });
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
    } else if (type === 'violin') {
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
    } else if (type === 'scatter') {
      var n = Math.min(groups[0].values.length, groups[1].values.length);
      traces.push({
        type: 'scatter', mode: 'markers',
        x: groups[0].values.slice(0, n), y: groups[1].values.slice(0, n),
        name: groups[0].name + ' vs ' + groups[1].name,
        marker: { color: '#4F6BED', size: 8, opacity: 0.7 }
      });
      layoutExtra.xaxisTitle = groups[0].name;
      layoutExtra.yaxisTitle = groups[1].name;
    } else if (type === 'line') {
      groups.forEach(function (g, i) {
        traces.push({
          type: 'scatter',
          mode: showPoints ? 'lines+markers' : 'lines',
          x: g.values.map(function (_, k) { return k + 1; }),
          y: g.values,
          name: g.name,
          line: { width: 2, color: PALETTE[i % PALETTE.length] }
        });
      });
      layoutExtra.xaxisTitle = 'Index';
      layoutExtra.showLegend = true;
    } else if (type === 'histogram') {
      groups.forEach(function (g, i) {
        traces.push({
          type: 'histogram', x: g.values, name: g.name,
          opacity: 0.7, nbinsx: 30,
          marker: { color: PALETTE[i % PALETTE.length] }
        });
      });
      layoutExtra.xaxisTitle = yLabel;
      layoutExtra.yaxisTitle = 'Count';
      layoutExtra.barmode = 'overlay';
      layoutExtra.showLegend = true;
    } else if (type === 'heatmap') {
      var common = Math.min.apply(null, groups.map(function (g) { return g.values.length; }));
      var k2 = groups.length;
      var z = [], text = [];
      for (var i2 = 0; i2 < k2; i2++) {
        var zrow = [], trow = [];
        for (var j2 = 0; j2 < k2; j2++) {
          var r2 = S.pearson(groups[i2].values.slice(0, common), groups[j2].values.slice(0, common));
          zrow.push(r2);
          trow.push(r2.toFixed(2));
        }
        z.push(zrow);
        text.push(trow);
      }
      traces.push({
        type: 'heatmap', z: z,
        x: groups.map(function (g) { return g.name; }),
        y: groups.map(function (g) { return g.name; }),
        colorscale: [[0, '#C05746'], [0.5, '#FFFFFF'], [1, '#0A1128']],
        zmin: -1, zmax: 1,
        text: text, texttemplate: '%{text}',
        hovertemplate: '%{x} vs %{y}: r = %{z:.3f}<extra></extra>'
      });
      layoutExtra.noTitles = true;
    }

    var xaxis, yaxis;
    if (type === 'bar') {
      xaxis = { title: { text: xLabel }, tickvals: idx, ticktext: groups.map(function (g) { return g.name; }), gridcolor: '#E5E7EB' };
      yaxis = { title: { text: yLabel }, gridcolor: '#E5E7EB', zeroline: true, zerolinecolor: '#D1D5DB' };
    } else if (type === 'scatter') {
      xaxis = { title: { text: xLabel && xLabel !== 'Groups' ? xLabel : layoutExtra.xaxisTitle }, gridcolor: '#E5E7EB' };
      yaxis = { title: { text: yLabel && yLabel !== 'Value' ? yLabel : layoutExtra.yaxisTitle }, gridcolor: '#E5E7EB' };
    } else if (type === 'heatmap') {
      xaxis = { gridcolor: '#E5E7EB' };
      yaxis = { gridcolor: '#E5E7EB', autorange: 'reversed' };
    } else {
      xaxis = { title: { text: layoutExtra.xaxisTitle || xLabel }, gridcolor: '#E5E7EB' };
      yaxis = { title: { text: layoutExtra.yaxisTitle || yLabel }, gridcolor: '#E5E7EB', zeroline: true, zerolinecolor: '#D1D5DB' };
    }

    var layout = {
      template: 'none',
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      font: { family: 'Inter, -apple-system, sans-serif', size: 13, color: '#0A1128' },
      xaxis: xaxis,
      yaxis: yaxis,
      margin: { l: 60, r: 30, t: 20, b: 50 },
      showlegend: !!layoutExtra.showLegend
    };
    if (layoutExtra.barmode) layout.barmode = layoutExtra.barmode;

    Plotly.newPlot('chart', traces, layout, { responsive: true, displayModeBar: false });
  }

  /* ---------- result tables ---------- */

  function noteBlock(note) {
    if (!note) return null;
    var n = document.createElement('p');
    n.style.cssText = 'font-size:.8rem;color:#B45309;background:#FEF3C7;border-radius:8px;padding:.5rem .7rem;';
    n.textContent = note;
    return n;
  }

  function sigBadge(sig, text) {
    var badge = document.createElement('div');
    badge.style.margin = '0.75rem 0';
    badge.innerHTML = '<span class="sig-badge ' + (sig ? 'sig-yes' : 'sig-no') + '">' + text + '</span>';
    return badge;
  }

  function groupSummaryTable(groups, useMedian) {
    var rows = groups.map(function (g) {
      var v = g.values.slice().sort(function (x, y) { return x - y; });
      var center = useMedian ? S.median(v) : S.mean(v);
      var spread = useMedian
        ? (fmtNum(S.quantile(v, 0.25)) + ' – ' + fmtNum(S.quantile(v, 0.75)))
        : fmtNum(Math.sqrt(S.sampleVar(v)));
      return '<tr><td>' + g.name + '</td><td>' + v.length + '</td><td>' + fmtNum(center) + '</td><td>' + spread + '</td></tr>';
    }).join('');
    var table = document.createElement('table');
    table.className = 'res-table';
    table.style.marginTop = '1rem';
    table.innerHTML = '<thead><tr><th>Group</th><th>n</th><th>' + (useMedian ? 'Median' : 'Mean') + '</th><th>' + (useMedian ? 'IQR' : 'SD') + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    return table;
  }

  function statsTable(headers, values) {
    var table = document.createElement('table');
    table.className = 'res-table';
    table.innerHTML = '<thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody><tr>' +
      values.map(function (v) { return '<td>' + v + '</td>'; }).join('') + '</tr></tbody>';
    return table;
  }

  function renderTTestResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    var n = noteBlock(note); if (n) body.appendChild(n);
    body.appendChild(sigBadge(sig, sig ? 'Statistically significant difference found' : 'No statistically significant difference found'));
    body.appendChild(statsTable(['Test', res.statLabel, 'df', 'p-value'], [res.test, fmtNum(res.statistic), fmtNum(res.df), fmtP(res.p)]));
    body.appendChild(groupSummaryTable(groups, false));
  }

  function renderAnovaResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    var n = noteBlock(note); if (n) body.appendChild(n);
    body.appendChild(sigBadge(sig, sig ? 'Statistically significant difference found between group means' : 'No statistically significant difference found between group means'));
    body.appendChild(statsTable(['Test', 'F', 'df (between)', 'df (within)', 'p-value'], ['One-way ANOVA', fmtNum(res.statistic), res.df1, res.df2, fmtP(res.p)]));
    body.appendChild(groupSummaryTable(groups, false));
  }

  function renderMwuResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    var n = noteBlock(note); if (n) body.appendChild(n);
    body.appendChild(sigBadge(sig, sig ? 'Statistically significant difference found between distributions' : 'No statistically significant difference found between distributions'));
    body.appendChild(statsTable(['Test', 'U', 'p-value', 'Method'], ['Mann-Whitney U', fmtNum(res.statistic), fmtP(res.p), res.exact ? 'Exact' : 'Normal approximation']));
    body.appendChild(groupSummaryTable(groups, true));
  }

  function renderKruskalResults(res, groups, sig, note) {
    var body = el('resultsBody');
    body.innerHTML = '';
    var n = noteBlock(note); if (n) body.appendChild(n);
    body.appendChild(sigBadge(sig, sig ? 'Statistically significant difference found between group distributions' : 'No statistically significant difference found between group distributions'));
    body.appendChild(statsTable(['Test', 'H', 'df', 'p-value'], ['Kruskal-Wallis', fmtNum(res.statistic), res.df, fmtP(res.p)]));
    body.appendChild(groupSummaryTable(groups, true));
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

  function renderDistSummary(groups, container) {
    var h = document.createElement('div');
    h.className = 'section-header';
    h.style.marginTop = '1.25rem';
    h.textContent = 'Distribution Summary';
    container.appendChild(h);

    var rows = groups.map(function (g) {
      var v = g.values.slice().sort(function (x, y) { return x - y; });
      var med = S.median(v);
      var q1 = S.quantile(v, 0.25), q3 = S.quantile(v, 0.75);
      return '<tr><td>' + g.name + '</td><td>' + v.length + '</td><td>' + fmtNum(med) + '</td><td>' + fmtNum(q1) + ' – ' + fmtNum(q3) + '</td><td>' + fmtNum(v[0]) + '</td><td>' + fmtNum(v[v.length - 1]) + '</td></tr>';
    }).join('');

    var table = document.createElement('table');
    table.className = 'res-table';
    table.innerHTML = '<thead><tr><th>Group</th><th>n</th><th>Median</th><th>IQR (Q1 – Q3)</th><th>Min</th><th>Max</th></tr></thead><tbody>' + rows + '</tbody></table>';
    container.appendChild(table);

    var note = document.createElement('p');
    note.style.cssText = 'font-size:.78rem;color:#9CA3AF;margin-top:.6rem;';
    note.textContent = 'Median and IQR describe the middle of each distribution — unlike mean ± SD, they are not affected by outliers. The box and violin plots visualize exactly these values.';
    container.appendChild(note);
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

  el('fileInput').addEventListener('change', function (e) { handleFiles(e.target.files); });
  var dz = el('dropZone');
  dz.addEventListener('click', function () { el('fileInput').click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault();
    dz.classList.remove('drag');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  el('loadSample').addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    state.datasets = [parseCSVText(SAMPLE_CSV, 'sample_data.csv')];
    renderFileUI();
  });
  el('clearFiles').addEventListener('click', function (e) {
    e.preventDefault();
    state.datasets = [];
    el('fileInput').value = '';
    renderFileUI();
  });
  el('columnsBox').addEventListener('change', updateGenerateState);
  el('testType').addEventListener('change', updateGenerateState);
  el('graphType').addEventListener('change', updateGenerateState);
  el('generateBtn').addEventListener('click', generate);
  el('dlPng').addEventListener('click', function () { downloadImage('png'); });
  el('dlSvg').addEventListener('click', function () { downloadImage('svg'); });

  /* cookie banner */
  var banner = el('cookieBanner');
  var accepted = false;
  try { accepted = !!localStorage.getItem('cookieConsent'); } catch (e2) { accepted = false; }
  if (!accepted) banner.classList.add('show');
  el('cookieAccept').addEventListener('click', function () {
    try { localStorage.setItem('cookieConsent', 'accepted'); } catch (e3) {}
    banner.classList.remove('show');
  });

  updateGenerateState();
})();
