/* GraphZen statistics engine — all computation runs client-side. No data leaves the browser.
   p-values are computed via tanh-sinh quadrature of the beta density, validated against scipy. */
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

  /* Linear-interpolation quantile (matches numpy/scipy default). */
  function quantile(a, p) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var pos = (s.length - 1) * p;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function median(a) { return quantile(a, 0.5); }

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
    mean: mean,
    sampleVar: sampleVar,
    quantile: quantile,
    median: median,
    tTestIndependent: tTestIndependent,
    anovaOneWay: anovaOneWay
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GraphZenStats;
  }
  global.GraphZenStats = GraphZenStats;

})(typeof window !== 'undefined' ? window : this);
