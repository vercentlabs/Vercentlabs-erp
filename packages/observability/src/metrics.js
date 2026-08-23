function labelsKey(labels = {}) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function metricKey(name, labels) {
  if (!/^[a-z][a-z0-9_.-]{1,120}$/.test(String(name || ""))) {
    throw new TypeError("Metric name is invalid.");
  }
  return `${name}|${labelsKey(labels)}`;
}

export function createMetricRegistry() {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();

  return Object.freeze({
    increment(name, value = 1, labels = {}) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new TypeError("Counter increments must be non-negative numbers.");
      }
      const key = metricKey(name, labels);
      const current = counters.get(key) || {
        name,
        labels: { ...labels },
        value: 0,
      };
      current.value += amount;
      counters.set(key, current);
      return current.value;
    },

    gauge(name, value, labels = {}) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new TypeError("Gauge value must be numeric.");
      }
      const key = metricKey(name, labels);
      gauges.set(key, {
        name,
        labels: { ...labels },
        value: numeric,
      });
      return numeric;
    },

    observe(name, value, labels = {}) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new TypeError("Histogram observations must be non-negative numbers.");
      }
      const key = metricKey(name, labels);
      const current = histograms.get(key) || {
        name,
        labels: { ...labels },
        count: 0,
        sum: 0,
        min: null,
        max: null,
      };
      current.count += 1;
      current.sum += numeric;
      current.min = current.min === null ? numeric : Math.min(current.min, numeric);
      current.max = current.max === null ? numeric : Math.max(current.max, numeric);
      histograms.set(key, current);
      return Object.freeze({ ...current });
    },

    snapshot() {
      return Object.freeze({
        counters: [...counters.values()].map((entry) => Object.freeze({ ...entry })),
        gauges: [...gauges.values()].map((entry) => Object.freeze({ ...entry })),
        histograms: [...histograms.values()].map((entry) => Object.freeze({ ...entry })),
      });
    },

    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    },
  });
}
