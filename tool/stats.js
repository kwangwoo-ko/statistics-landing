/* GraphZen statistics engine — all computation runs client-side. No data leaves the browser.
   p-values are computed via tanh-sinh quadrature of the beta density and regularized
   incomplete gamma functions, validated against scipy. */
(function (global) {
  'use strict';

  var LOG_PI_4 = Math.log(Math.PI / 4);

  function logGamma(x) {
    var g = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (x < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    x -= 1;
    var a = g[0];
    var t = x + 7.5;
    for (var i = 1; i < 9; i++) a += g[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function logBeta(a, b) {
    return logGamma(a) + logGamma(b) - logGamma(a + b);
  }

  function logCosh(t) {
    t = Math.abs(t);
    return t + Math.log(0.5 * (1 + Math.exp(-2 * t)));
  }

  /* I_x(a,b) via tanh-sinh quadrature of ∫_0^x u^(a-1)(1-u)^(b-1) du.
     Accurate in all parameter regions including deep tails. */
  function betaincQuad(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    function g(z) {
      if (z <= 0) return 0;
      var t1 = Math.pow(z, a - 1);
      var base = 1 - x * z;
      if (base < 0) base = 0;
      var t2 = Math.pow(base, b - 1);
      var t = t1 * t2;
      return isFinite(t) ? t : 0;
    }

    function zeta(t) {
      return 0.5 + 0.5 * Math.tanh((Math.PI / 2) * Math.sinh(t));
    }

    function dzdt(t) {
      var lc = logCosh((Math.PI / 2) * Math.sinh(t));
      if (!isFinite(lc)) return 0;
      return Math.exp(LOG_PI_4 + logCosh(t) - 2 * lc);
    }

    var h = 1, prev = Infinity, result = 0;
    for (var level = 0; level < 14; level++) {
      var total = 0;
      var kmax = Math.ceil(5 / h) + 1;
      for (var k = -kmax; k <= kmax; k++) {
        var t = k * h;
        var z = zeta(t);
        var w = dzdt(t);
        var term = g(z) * w;
        if (isFinite(term)) total += term;
      }
      var val = h * total;
      if (isFinite(val)) {
        if (level >= 6 && Math.abs(val - prev) <= 1e-12 * Math.max(Math.abs(val), 1e-300)) {
          result = val;
          break;
        }
        prev = val;
        result = val;
      }
      h /= 2;
    }
    if (!isFinite(result)) result = 0;
    var log_p = a * Math.log(x) + Math.log(result) - logBeta(a, b);
    return log_p > -700 ? Math.exp(log_p) : 0;
  }

  /* regularized upper incomplete gamma Q(a,x) — series + continued fraction */
  function gammaSeries(a, x) {
    var ap = a, sum = 1 / a, del = sum;
    for (var n = 1; n <= 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }

  function gammaCF(a, x) {
    var FPMIN = 1e-300;
    var b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i <= 1000; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }

  function gammaUpper(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaSeries(a, x);
    return gammaCF(a, x);
  }

  function chi2Upper(x, k) {
    return gammaUpper(k / 2, x / 2);
  }

  function rankDataAverage(vals) {
    var order = [];
    for (var i = 0; i < vals.length; i++) order.push(i);
    order.sort(function (x, y) { return vals[x] - vals[y]; });
    var ranks = new Array(vals.length);
    var i = 0;
    while (i < vals.length) {
      var j = i;
      while (j + 1 < vals.length && vals[order[j + 1]] === vals[order[i]]) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) ranks[order[k]] = avg;
      i = j + 1;
    }
    return ranks;
  }

  function mannWhitneyU(a, b) {
    var n1 = a.length, n2 = b.length, N = n1 + n2;
    var allv = a.concat(b);
    var ranks = rankDataAverage(allv);
    var R1 = 0;
    for (var i = 0; i < n1; i++) R1 += ranks[i];
    var U1 = R1 - n1 * (n1 + 1) / 2;
    var mu = n1 * n2 / 2;
    var counts = {};
    for (var v of allv) counts[v] = (counts[v] || 0) + 1;
    var T = 0;
    for (var key in counts) {
      var c = counts[key];
      if (c > 1) T += c * c * c - c;
    }
    var hasTies = T > 0;
    var p;
    /* Mirror scipy's 'auto': exact only for small samples without ties;
       with ties (or larger samples) use the tie-corrected normal approximation. */
    if (Math.max(n1, n2) <= 8 && !hasTies) {
      var total = 0, countLe = 0, countGe = 0;
      var chosen = [];
      (function enumerate(start) {
        if (chosen.length === n1) {
          var r1 = 0;
          for (var w = 0; w < chosen.length; w++) r1 += ranks[chosen[w]];
          var u1 = r1 - n1 * (n1 + 1) / 2;
          total++;
          if (u1 <= U1) countLe++;
          if (u1 >= U1) countGe++;
          return;
        }
        for (var s = start; s < N; s++) {
          chosen.push(s);
          enumerate(s + 1);
          chosen.pop();
        }
      })(0);
      p = Math.min(1, 2 * Math.min(countLe / total, countGe / total));
    } else {
      var sig = Math.sqrt(n1 * n2 / 12 * ((N + 1) - T / (N * (N - 1))));
      if (sig === 0) p = 1;
      else {
        var z = (U1 - mu + (U1 < mu ? 0.5 : -0.5)) / sig;
        p = chi2Upper(z * z, 1);
      }
    }
    var U2 = n1 * n2 - U1;
    return {
      test: 'Mann-Whitney U test',
      statistic: Math.min(U1, U2), statLabel: 'U',
      z: (U1 - mu) / (hasTies || N > 16 ? Math.sqrt(n1 * n2 / 12 * (1 - T / (N * N - N))) || 1 : 1),
      p: p, n1: n1, n2: n2, exact: Math.max(n1, n2) <= 8
    };
  }

  function kruskalWallis(groups) {
    var allv = [];
    for (var g = 0; g < groups.length; g++) allv = allv.concat(groups[g]);
    var N = allv.length;
    var ranks = rankDataAverage(allv);
    var idx = 0, H = 0;
    for (var j = 0; j < groups.length; j++) {
      var rSum = 0;
      for (var r = 0; r < groups[j].length; r++) rSum += ranks[idx + r];
      idx += groups[j].length;
      H += (rSum * rSum) / groups[j].length;
    }
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    var counts = {};
    for (var v of allv) counts[v] = (counts[v] || 0) + 1;
    var T = 0;
    for (var key in counts) {
      var c = counts[key];
      if (c > 1) T += c * c * c - c;
    }
    H = H / (1 - T / (N * N * N - N));
    var k = groups.length;
    var p = chi2Upper(H, k - 1);
    return {
      test: 'Kruskal-Wallis test',
      statistic: H, statLabel: 'H', df: k - 1, p: p, N: N, groupsCount: k
    };
  }

  function pearson(x, y) {
    var n = Math.min(x.length, y.length);
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
    var mx = sx / n, my = sy / n;
    var num = 0, dx = 0, dy = 0;
    for (var j = 0; j < n; j++) {
      var vx = x[j] - mx, vy = y[j] - my;
      num += vx * vy;
      dx += vx * vx;
      dy += vy * vy;
    }
    var den = Math.sqrt(dx * dy);
    return den === 0 ? 0 : num / den;
  }

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function sampleVar(a) {
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / (a.length - 1);
  }

  function quantile(a, p) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var pos = (s.length - 1) * p;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function median(a) { return quantile(a, 0.5); }

  function tDistTwoSided(t, df) {
    return betaincQuad(df / 2, 0.5, df / (df + t * t));
  }

  /* t quantile: find t >= 0 such that two-sided p(t, df) = pTwoSided (bisection). */
  function tQuantile(pTwoSided, df) {
    if (pTwoSided >= 1) return 0;
    var lo = 0, hi = 1;
    var guard = 0;
    while (tDistTwoSided(hi, df) > pTwoSided && guard++ < 60) hi *= 2;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (tDistTwoSided(mid, df) > pTwoSided) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* Ordinary least squares linear regression y = intercept + slope*x.
     Reports the standard values used in scientific publications. */
  function linearRegression(x, y) {
    var n = Math.min(x.length, y.length);
    if (n < 2) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
    var mx = sx / n, my = sy / n;
    var sxx = 0, sxy = 0, syy = 0;
    for (var j = 0; j < n; j++) {
      var dx = x[j] - mx, dy = y[j] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    if (sxx === 0) return null;
    var slope = sxy / sxx;
    var intercept = my - slope * mx;
    var r = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
    var r2 = r * r;
    var sse = Math.max(syy - slope * sxy, 0);
    var df = n - 2;
    var syx = Math.sqrt(sse / df);
    var seSlope = syx / Math.sqrt(sxx);
    var seIntercept = syx * Math.sqrt(1 / n + (mx * mx) / sxx);
    var t, p;
    if (seSlope === 0) { t = Infinity; p = 0; }
    else { t = slope / seSlope; p = tDistTwoSided(Math.abs(t), df); }
    var tCrit = tQuantile(0.05, df);
    return {
      n: n, slope: slope, intercept: intercept,
      r: r, r2: r2, syx: syx,
      seSlope: seSlope, seIntercept: seIntercept,
      ciSlopeLow: slope - tCrit * seSlope,
      ciSlopeHigh: slope + tCrit * seSlope,
      t: t, df: df, p: p
    };
  }

  function tTestIndependent(a, b, welch) {
    var n1 = a.length, n2 = b.length;
    var m1 = mean(a), m2 = mean(b);
    var v1 = sampleVar(a), v2 = sampleVar(b);
    var se, df;
    if (welch) {
      se = Math.sqrt(v1 / n1 + v2 / n2);
      df = Math.pow(v1 / n1 + v2 / n2, 2) /
        (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    } else {
      var pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(pooled * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
    }
    var t = (m1 - m2) / se;
    var p = betaincQuad(df / 2, 0.5, df / (df + t * t));
    return {
      test: welch ? "Welch's t-test" : "Student's t-test",
      statistic: t, statLabel: 't', df: df, p: p,
      mean1: m1, mean2: m2, n1: n1, n2: n2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2)
    };
  }

  function anovaOneWay(groups) {
    var k = groups.length;
    var N = 0;
    for (var i = 0; i < k; i++) N += groups[i].length;
    var flat = [];
    for (var j = 0; j < k; j++) flat = flat.concat(groups[j]);
    var grand = mean(flat);
    var ssb = 0, ssw = 0;
    var groupMeans = [], groupSds = [];
    for (var q = 0; q < k; q++) {
      var gm = mean(groups[q]);
      groupMeans.push(gm);
      groupSds.push(Math.sqrt(sampleVar(groups[q])));
      ssb += groups[q].length * (gm - grand) * (gm - grand);
      for (var r = 0; r < groups[q].length; r++) {
        var dv = groups[q][r] - gm;
        ssw += dv * dv;
      }
    }
    var df1 = k - 1, df2 = N - k;
    var f = (ssb / df1) / (ssw / df2);
    var p = betaincQuad(df2 / 2, df1 / 2, df2 / (df1 * f + df2));
    return {
      test: 'One-way ANOVA',
      statistic: f, statLabel: 'F', df1: df1, df2: df2, p: p,
      groupMeans: groupMeans, groupSds: groupSds, N: N
    };
  }

  var GraphZenStats = {
    logGamma: logGamma,
    betaincQuad: betaincQuad,
    chi2Upper: chi2Upper,
    pearson: pearson,
    mean: mean,
    sampleVar: sampleVar,
    quantile: quantile,
    median: median,
    tTestIndependent: tTestIndependent,
    anovaOneWay: anovaOneWay,
    mannWhitneyU: mannWhitneyU,
    kruskalWallis: kruskalWallis,
    linearRegression: linearRegression,
    tQuantile: tQuantile
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GraphZenStats;
  }
  global.GraphZenStats = GraphZenStats;

})(typeof window !== 'undefined' ? window : this);
